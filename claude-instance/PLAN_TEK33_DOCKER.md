# Implementation Plan: TEK-33 Docker Setup

**Linear Issue**: TEK-33 - P5.1 Docker Setup - Development and production configs
**Date**: 2026-01-02
**Status**: Ready for Implementation
**Estimated Time**: 7.5 hours

---

## Executive Summary

This plan implements Docker containerization for the Energy Dashboard project, providing both development and production deployment configurations. The implementation follows the spec requirements for a dual-database architecture (MongoDB + QuestDB) with multi-stage builds, health checks, and optional profiles for nginx, backups, and auto-updates.

**Key Deliverables**:
- ✅ Multi-stage Dockerfile (builder + production)
- ✅ docker-compose.yml (development with hot reload)
- ✅ docker-compose.prod.yml (production with profiles)
- ✅ .dockerignore
- ✅ docker/nginx/nginx.conf
- ✅ docker/questdb/server.conf
- ✅ .env.example template

**Dependencies**: None (can be implemented independently of database plugins)

---

## Context Analysis

### Current State (from INVESTIGATION_REPORT.md)
- **Runtime**: Platformatic Watt on Node.js 22
- **Frontend**: React 18 + Vite served at `/dashboard`
- **API**: Fastify service at `/api/*`
- **Database**: Currently SQLite only (spec requires MongoDB + QuestDB)
- **Deployment**: ❌ No Docker setup exists

### Required Architecture (from specs/energy-dashboard-spec.md)
- **Application State DB**: MongoDB 7 (settings, entities, subscription state)
- **Time-Series DB**: QuestDB 8.2.1 (energy readings, statistics)
- **Networking**: Bridge network `energy-network`
- **Ports**:
  - App: 3042
  - MongoDB: 27017
  - QuestDB: 9000 (HTTP), 9009 (ILP), 8812 (PostgreSQL wire)
  - Nginx (optional): 80, 443

### Critical Considerations
1. **Database Plugins**: MongoDB/QuestDB plugins don't exist yet, but Docker can be implemented independently
2. **Environment Variables**: Need fallback to `.env` for HA_URL and HA_TOKEN
3. **Volume Mounts**: Development needs hot reload via bind mounts, production uses named volumes
4. **Health Checks**: MongoDB requires `mongosh --eval "db.adminCommand('ping')"`
5. **Traefik Labels**: Support existing reverse proxy integration in home lab

---

## Implementation Steps

### Phase 1: Docker Foundation Files (2 hours)

#### Step 1.1: Create Multi-stage Dockerfile

**File**: `/Users/eric/Dev/energy-tracker/Dockerfile`

**Purpose**: Multi-stage build separating build-time dependencies from runtime image

**Content**:
```dockerfile
# ================================================
# Build Stage
# ================================================
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files for dependency installation
COPY package*.json ./
COPY web/api/package*.json ./web/api/
COPY web/frontend/package*.json ./web/frontend/

# Install ALL dependencies (including devDependencies for build)
RUN npm ci --workspace=web/api --workspace=web/frontend && \
    npm ci

# Copy source code
COPY . .

# Build frontend with Vite
RUN npm run build --workspace=web/frontend

# ================================================
# Production Stage
# ================================================
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY web/api/package*.json ./web/api/
RUN npm ci --omit=dev --workspace=web/api && \
    npm ci --omit=dev

# Copy built assets and necessary files from builder
COPY --from=builder /app/web/api ./web/api
COPY --from=builder /app/web/frontend/dist ./web/frontend/dist
COPY --from=builder /app/watt.json ./
COPY --from=builder /app/web/frontend/watt.json ./web/frontend/

# Create data directory for SQLite fallback
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3042

# Expose application port
EXPOSE 3042

# Start application
CMD ["npm", "start"]
```

**Verification**:
```bash
# Build test image
docker build -t energy-dashboard:test .

# Run without databases (should fail gracefully)
docker run -p 3042:3042 energy-dashboard:test

# Expected: Container starts, logs show database connection warnings
```

**Dependencies**: None

---

#### Step 1.2: Create .dockerignore

**File**: `/Users/eric/Dev/energy-tracker/.dockerignore`

**Purpose**: Reduce Docker build context size and exclude sensitive files

**Content**:
```
# Node modules (installed during build)
node_modules
web/*/node_modules

# Version control
.git
.gitignore

# Environment files (security)
.env
.env.*

# Logs and databases
*.log
data/*.db
data/*.db-*

# OS files
.DS_Store
Thumbs.db

# Build artifacts
dist
.vite

# Documentation
*.md
!README.md

# Docker files (not needed in context)
docker-compose*.yml
Dockerfile
.dockerignore

# Project management
claude-instance
specs
.claude

# Package manager lockfiles (but keep package-lock.json)
yarn.lock
pnpm-lock.yaml
```

**Verification**:
```bash
# Build and check context size
docker build --no-cache -t energy-dashboard:test . 2>&1 | grep "Sending build context"

# Expected: Context size < 10MB
```

**Dependencies**: None

---

#### Step 1.3: Create Environment Template

**File**: `/Users/eric/Dev/energy-tracker/.env.example`

**Purpose**: Template for environment variables with documentation

**Content**:
```bash
# ================================================
# MongoDB Configuration (Application State)
# ================================================
# Default for Docker Compose (service name: mongodb)
MONGODB_URI=mongodb://mongodb:27017/energy_dashboard

# For authentication (production):
# MONGODB_URI=mongodb://energy:password@mongodb:27017/energy_dashboard?authSource=admin

# For local development (host MongoDB):
# MONGODB_URI=mongodb://localhost:27017/energy_dashboard

# ================================================
# QuestDB Configuration (Time-Series Data)
# ================================================
QUESTDB_HOST=questdb
QUESTDB_ILP_PORT=9009
QUESTDB_HTTP_PORT=9000

# For local development (host QuestDB):
# QUESTDB_HOST=localhost

# ================================================
# Application Configuration
# ================================================
PORT=3042
NODE_ENV=production

# ================================================
# Home Assistant (Optional - can configure via UI)
# ================================================
# Leave commented to configure via /dashboard/settings
# HA_URL=homeassistant.local:8123
# HA_TOKEN=eyJ0eXAiOiJKV1QiLCJhbGciOiJIUzI1NiJ9...
```

**Verification**:
```bash
# Create .env from template
cp .env.example .env

# Edit .env with real values (if needed)
# nano .env

# Verify it's ignored by git
git status | grep -q ".env" && echo "ERROR: .env not ignored!" || echo "OK"
```

**Dependencies**: None

---

### Phase 2: Development Docker Compose (1 hour)

#### Step 2.1: Create docker-compose.yml

**File**: `/Users/eric/Dev/energy-tracker/docker-compose.yml`

**Purpose**: Development environment with hot reload and database GUIs

**Content**:
```yaml
version: '3.8'

services:
  # ================================================
  # Main Application
  # ================================================
  app:
    build:
      context: .
      target: builder  # Use builder stage for development
    ports:
      - "3042:3042"
    environment:
      - NODE_ENV=development
      - PORT=3042
      # MongoDB (Application State)
      - MONGODB_URI=mongodb://mongodb:27017/energy_dashboard
      # QuestDB (Time-Series Data)
      - QUESTDB_HOST=questdb
      - QUESTDB_ILP_PORT=9009
      - QUESTDB_HTTP_PORT=9000
      # Home Assistant (optional - can configure via UI)
      - HA_URL=${HA_URL:-homeassistant.local:8123}
      - HA_TOKEN=${HA_TOKEN:-}
    volumes:
      # Bind mount source for hot reload
      - ./web:/app/web
      - ./data:/app/data
      - ./watt.json:/app/watt.json
      # Exclude node_modules from bind mount (use image's version)
      - /app/node_modules
      - /app/web/api/node_modules
      - /app/web/frontend/node_modules
    depends_on:
      mongodb:
        condition: service_healthy
      questdb:
        condition: service_started
    networks:
      - energy-network
    command: npm run dev

  # ================================================
  # MongoDB (Application State Database)
  # ================================================
  mongodb:
    image: mongo:7
    ports:
      - "27017:27017"
    volumes:
      - mongodb_data:/data/db
    networks:
      - energy-network
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 10s
      timeout: 5s
      retries: 5
      start_period: 20s

  # ================================================
  # QuestDB (Time-Series Database)
  # ================================================
  questdb:
    image: questdb/questdb:8.2.1
    ports:
      - "9000:9000"   # HTTP API & Web Console
      - "9009:9009"   # ILP (InfluxDB Line Protocol)
      - "8812:8812"   # PostgreSQL wire protocol
    volumes:
      - questdb_data:/var/lib/questdb
      - ./docker/questdb/server.conf:/var/lib/questdb/conf/server.conf:ro
    networks:
      - energy-network
    environment:
      - QDB_LOG_W_STDOUT_LEVEL=ERROR

  # ================================================
  # Mongo Express (Database GUI - Profile: tools)
  # ================================================
  mongo-express:
    image: mongo-express:latest
    profiles:
      - tools
    ports:
      - "8081:8081"
    environment:
      - ME_CONFIG_MONGODB_URL=mongodb://mongodb:27017
      - ME_CONFIG_BASICAUTH=false
    networks:
      - energy-network
    depends_on:
      mongodb:
        condition: service_healthy

# ================================================
# Volumes
# ================================================
volumes:
  mongodb_data:
    driver: local
  questdb_data:
    driver: local

# ================================================
# Networks
# ================================================
networks:
  energy-network:
    driver: bridge
```

**Key Features**:
- **Hot Reload**: Bind mounts `./web` for live code changes
- **Anonymous Volumes**: Prevent node_modules from being overwritten
- **Health Checks**: MongoDB must be healthy before app starts
- **Tools Profile**: Mongo Express only starts with `--profile tools`

**Verification**:
```bash
# Create QuestDB config first (see Step 3.1)
mkdir -p docker/questdb
# ... create server.conf

# Start all services
docker compose up -d

# Check service health
docker compose ps

# Expected output:
# app       running    0.0.0.0:3042->3042/tcp
# mongodb   healthy    0.0.0.0:27017->27017/tcp
# questdb   running    0.0.0.0:9000->9000/tcp, ...

# View logs
docker compose logs -f app

# Test hot reload (edit a file)
echo "// test" >> web/frontend/src/main.jsx
# Should see Vite rebuild in logs

# Start with Mongo Express
docker compose --profile tools up -d
open http://localhost:8081
```

**Dependencies**:
- Dockerfile (Step 1.1)
- .dockerignore (Step 1.2)
- docker/questdb/server.conf (Step 3.1)

---

### Phase 3: Configuration Files (1 hour)

#### Step 3.1: Create QuestDB Configuration

**File**: `/Users/eric/Dev/energy-tracker/docker/questdb/server.conf`

**Purpose**: Optimize QuestDB for home lab deployment

**Actions**:
```bash
# Create directory
mkdir -p /Users/eric/Dev/energy-tracker/docker/questdb
```

**Content**:
```properties
# ================================================
# QuestDB Server Configuration
# Optimized for home lab deployment
# ================================================

# HTTP Server
http.bind.to=0.0.0.0:9000
http.min.worker.count=1
http.worker.count=2

# ILP (InfluxDB Line Protocol) for high-speed ingestion
line.tcp.enabled=true
line.tcp.bind.to=0.0.0.0:9009
line.tcp.writer.worker.count=1

# PostgreSQL wire protocol
pg.enabled=true
pg.bind.to=0.0.0.0:8812
pg.net.connection.limit=64

# Memory settings optimized for home lab (not production server)
shared.worker.count=2
cairo.sql.copy.buffer.size=2M
```

**Verification**:
```bash
# Start QuestDB with config
docker compose up questdb

# Access web console
open http://localhost:9000

# Run test query
curl "http://localhost:9000/exec?query=SELECT%201"

# Expected: {"query":"SELECT 1","columns":[...],"dataset":[[1]],...}
```

**Dependencies**: None

---

#### Step 3.2: Create Nginx Configuration

**File**: `/Users/eric/Dev/energy-tracker/docker/nginx/nginx.conf`

**Purpose**: Reverse proxy for production deployment

**Actions**:
```bash
# Create directory
mkdir -p /Users/eric/Dev/energy-tracker/docker/nginx
```

**Content**:
```nginx
events {
    worker_connections 1024;
}

http {
    # Upstream to app service
    upstream app {
        server app:3042;
    }

    # HTTP Server
    server {
        listen 80;
        server_name energy.local;

        # Redirect to HTTPS (uncomment for production with SSL)
        # return 301 https://$server_name$request_uri;

        # Proxy all requests to app
        location / {
            proxy_pass http://app;
            proxy_http_version 1.1;

            # WebSocket support (for HMR in development)
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';

            # Standard proxy headers
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;

            # Disable caching for dynamic content
            proxy_cache_bypass $http_upgrade;
        }

        # WebSocket endpoint (explicit for clarity)
        location /ws {
            proxy_pass http://app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }

    # HTTPS Server (uncomment for production)
    # server {
    #     listen 443 ssl http2;
    #     server_name energy.local;
    #
    #     ssl_certificate /etc/nginx/certs/cert.pem;
    #     ssl_certificate_key /etc/nginx/certs/key.pem;
    #
    #     location / {
    #         proxy_pass http://app;
    #         proxy_http_version 1.1;
    #         proxy_set_header Host $host;
    #         proxy_set_header X-Real-IP $remote_addr;
    #         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #         proxy_set_header X-Forwarded-Proto $scheme;
    #     }
    # }
}
```

**Verification**:
```bash
# Test nginx config syntax
docker run --rm -v $(pwd)/docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro nginx:alpine nginx -t

# Expected: nginx: configuration file /etc/nginx/nginx.conf test is successful
```

**Dependencies**: None

---

### Phase 4: Production Docker Compose (1.5 hours)

#### Step 4.1: Create docker-compose.prod.yml

**File**: `/Users/eric/Dev/energy-tracker/docker-compose.prod.yml`

**Purpose**: Production deployment with restart policies, profiles, and Traefik integration

**Content**:
```yaml
version: '3.8'

services:
  # ================================================
  # Main Application (Production Build)
  # ================================================
  app:
    build:
      context: .
      target: production  # Use production stage
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3042
      # MongoDB (Application State)
      - MONGODB_URI=${MONGODB_URI:-mongodb://mongodb:27017/energy_dashboard}
      # QuestDB (Time-Series Data)
      - QUESTDB_HOST=${QUESTDB_HOST:-questdb}
      - QUESTDB_ILP_PORT=${QUESTDB_ILP_PORT:-9009}
      - QUESTDB_HTTP_PORT=${QUESTDB_HTTP_PORT:-9000}
      # Home Assistant (optional - can configure via UI)
      - HA_URL=${HA_URL:-}
      - HA_TOKEN=${HA_TOKEN:-}
    volumes:
      # Only mount data directory (no source code)
      - app_data:/app/data
    depends_on:
      mongodb:
        condition: service_healthy
      questdb:
        condition: service_started
    networks:
      - energy-network
    labels:
      # Traefik integration (for home lab reverse proxy)
      - "traefik.enable=true"
      - "traefik.http.routers.energy.rule=Host(`energy.local`)"
      - "traefik.http.services.energy.loadbalancer.server.port=3042"

  # ================================================
  # MongoDB (Application State Database)
  # ================================================
  mongodb:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongodb_data:/data/db
    networks:
      - energy-network
    # Production health check (less frequent)
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  # ================================================
  # QuestDB (Time-Series Database)
  # ================================================
  questdb:
    image: questdb/questdb:8.2.1
    restart: unless-stopped
    volumes:
      - questdb_data:/var/lib/questdb
    networks:
      - energy-network
    environment:
      - QDB_LOG_W_STDOUT_LEVEL=ERROR
      - QDB_SHARED_WORKER_COUNT=2

  # ================================================
  # Nginx Reverse Proxy (Profile: nginx)
  # ================================================
  nginx:
    image: nginx:alpine
    profiles:
      - nginx
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./docker/nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./docker/nginx/certs:/etc/nginx/certs:ro
    depends_on:
      - app
    networks:
      - energy-network

  # ================================================
  # MongoDB Backup Service (Profile: backup)
  # ================================================
  mongo-backup:
    image: tiredofit/db-backup
    profiles:
      - backup
    restart: unless-stopped
    environment:
      - DB_TYPE=mongo
      - DB_HOST=mongodb
      - DB_NAME=energy_dashboard
      - DB_BACKUP_INTERVAL=1440   # Daily (minutes)
      - DB_CLEANUP_TIME=10080      # Keep 7 days (minutes)
      - COMPRESSION=GZ
    volumes:
      - backup_data:/backup
    depends_on:
      mongodb:
        condition: service_healthy
    networks:
      - energy-network

  # ================================================
  # Watchtower Auto-Update (Profile: auto-update)
  # ================================================
  watchtower:
    image: containrrr/watchtower
    profiles:
      - auto-update
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_SCHEDULE=0 4 * * *  # Daily at 4 AM
      - WATCHTOWER_INCLUDE_STOPPED=true
    # Only watch the app container
    command: --interval 86400 energy-tracker-app-1

# ================================================
# Volumes
# ================================================
volumes:
  app_data:
    driver: local
  mongodb_data:
    driver: local
  questdb_data:
    driver: local
  backup_data:
    driver: local

# ================================================
# Networks
# ================================================
networks:
  energy-network:
    driver: bridge
```

**Key Features**:
- **Restart Policies**: All services restart automatically
- **No Source Mounts**: Production uses built assets only
- **Traefik Labels**: Ready for existing reverse proxy
- **Profiles**:
  - `nginx`: Alternative to Traefik
  - `backup`: Automated daily MongoDB backups
  - `auto-update`: Watchtower for container updates

**Verification**:
```bash
# Build production image
docker compose -f docker-compose.prod.yml build

# Start base stack (no profiles)
docker compose -f docker-compose.prod.yml up -d

# Check status
docker compose -f docker-compose.prod.yml ps

# Expected: All services "Up" with restart policy "unless-stopped"

# Start with nginx profile
docker compose -f docker-compose.prod.yml --profile nginx up -d
open http://localhost

# Start with all profiles
docker compose -f docker-compose.prod.yml \
  --profile nginx \
  --profile backup \
  --profile auto-update \
  up -d

# Verify Traefik labels
docker compose -f docker-compose.prod.yml config | grep -A 3 "traefik"
```

**Dependencies**:
- Dockerfile (Step 1.1)
- docker/nginx/nginx.conf (Step 3.2)

---

### Phase 5: Testing & Validation (2 hours)

#### Step 5.1: Development Environment Testing

**Test 1: Clean Build and Start**

```bash
# Clean everything
docker compose down -v
docker system prune -f

# Build from scratch
docker compose build --no-cache

# Start services
docker compose up -d

# Wait for health checks
sleep 30

# Check all services healthy
docker compose ps

# Expected output:
# NAME                STATUS         PORTS
# app                 Up             0.0.0.0:3042->3042/tcp
# mongodb             Up (healthy)   0.0.0.0:27017->27017/tcp
# questdb             Up             0.0.0.0:9000->9000/tcp, ...
```

**Test 2: Database Connectivity**

```bash
# Test MongoDB
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"
# Expected: { ok: 1 }

# Test QuestDB HTTP API
curl "http://localhost:9000/exec?query=SELECT%201"
# Expected: {"query":"SELECT 1",...}

# Check app logs for database connections
docker compose logs app | grep -i "mongo\|quest"
# Should see connection logs (may show errors if plugins not implemented)
```

**Test 3: Hot Reload**

```bash
# Edit a frontend file
echo "// Hot reload test" >> web/frontend/src/main.jsx

# Check logs for Vite rebuild
docker compose logs app | tail -20
# Should see "hmr update" or similar

# Undo change
git checkout web/frontend/src/main.jsx
```

**Test 4: Data Persistence**

```bash
# Create test data in MongoDB
docker compose exec mongodb mongosh energy_dashboard --eval "
  db.test.insertOne({test: 'data', timestamp: new Date()})
"

# Stop and remove containers (keep volumes)
docker compose down

# Restart
docker compose up -d

# Verify data persists
docker compose exec mongodb mongosh energy_dashboard --eval "
  db.test.findOne()
"
# Expected: { _id: ..., test: 'data', timestamp: ... }
```

**Test 5: Mongo Express (Tools Profile)**

```bash
# Start with tools profile
docker compose --profile tools up -d

# Access Mongo Express
open http://localhost:8081

# Expected: Web UI showing energy_dashboard database
```

---

#### Step 5.2: Production Environment Testing

**Test 1: Production Build Size**

```bash
# Build production image
docker compose -f docker-compose.prod.yml build

# Check image size
docker images | grep energy-dashboard

# Expected: < 500MB for production image
```

**Test 2: No Development Artifacts**

```bash
# Start production stack
docker compose -f docker-compose.prod.yml up -d

# Try to access source code (should fail)
docker compose -f docker-compose.prod.yml exec app ls -la /app/web/frontend/src 2>&1

# Expected: "No such file or directory" (source not included)

# Verify dist exists
docker compose -f docker-compose.prod.yml exec app ls -la /app/web/frontend/dist

# Expected: Built assets present
```

**Test 3: Restart Policies**

```bash
# Check restart policies
docker compose -f docker-compose.prod.yml ps --format "table {{.Name}}\t{{.State}}\t{{.Status}}"

# Expected: All services show "unless-stopped"

# Simulate crash
docker compose -f docker-compose.prod.yml kill app

# Wait 10 seconds
sleep 10

# Check if restarted
docker compose -f docker-compose.prod.yml ps app

# Expected: "Up" (auto-restarted)
```

**Test 4: Nginx Profile**

```bash
# Start with nginx
docker compose -f docker-compose.prod.yml --profile nginx up -d

# Test proxy
curl -I http://localhost

# Expected: HTTP/1.1 200 OK (proxied from app)

# Check nginx logs
docker compose -f docker-compose.prod.yml logs nginx

# Expected: Proxy requests logged
```

**Test 5: Backup Profile**

```bash
# Start with backup
docker compose -f docker-compose.prod.yml --profile backup up -d

# Trigger manual backup
docker compose -f docker-compose.prod.yml exec mongo-backup backup-now

# List backups
docker compose -f docker-compose.prod.yml run --rm mongo-backup ls -lh /backup

# Expected: Backup file with timestamp
```

---

## File Summary

### New Files Created (7 files)

| File Path | Size | Purpose |
|-----------|------|---------|
| `/Users/eric/Dev/energy-tracker/Dockerfile` | ~1 KB | Multi-stage build |
| `/Users/eric/Dev/energy-tracker/.dockerignore` | ~500 B | Build context exclusions |
| `/Users/eric/Dev/energy-tracker/.env.example` | ~1 KB | Environment template |
| `/Users/eric/Dev/energy-tracker/docker-compose.yml` | ~3 KB | Development stack |
| `/Users/eric/Dev/energy-tracker/docker-compose.prod.yml` | ~4 KB | Production stack |
| `/Users/eric/Dev/energy-tracker/docker/questdb/server.conf` | ~500 B | QuestDB config |
| `/Users/eric/Dev/energy-tracker/docker/nginx/nginx.conf` | ~1.5 KB | Nginx config |

### Files to Modify (Optional)

| File Path | Changes | Reason |
|-----------|---------|--------|
| `/Users/eric/Dev/energy-tracker/.gitignore` | Add `.env`, `backup-*.archive` | Security |
| `/Users/eric/Dev/energy-tracker/README.md` | Add Docker Quick Start section | User documentation |

---

## Success Criteria Checklist

### Development Environment ✅

- [ ] `docker compose up -d` starts all services without errors
- [ ] MongoDB health check passes within 30 seconds
- [ ] QuestDB console accessible at `http://localhost:9000`
- [ ] App accessible at `http://localhost:3042/dashboard`
- [ ] Hot reload triggers on file changes (Vite HMR)
- [ ] Mongo Express accessible with `--profile tools`
- [ ] Data persists across `docker compose down` and `up`

### Production Environment ✅

- [ ] Production image builds successfully
- [ ] Production image size < 500MB
- [ ] No source code in production container
- [ ] All services have `restart: unless-stopped`
- [ ] Traefik labels present on app service
- [ ] Nginx profile proxies correctly
- [ ] Backup profile creates scheduled backups
- [ ] Watchtower monitors for updates

### Documentation ✅

- [ ] `.env.example` includes all required variables with comments
- [ ] `.dockerignore` excludes sensitive and unnecessary files
- [ ] All configuration files have inline comments
- [ ] README.md has Docker Quick Start section (optional)

---

## Timeline & Effort Estimate

| Phase | Tasks | Time | Cumulative |
|-------|-------|------|------------|
| **Phase 1** | Foundation files (Dockerfile, .dockerignore, .env.example) | 2h | 2h |
| **Phase 2** | Development compose | 1h | 3h |
| **Phase 3** | Config files (QuestDB, Nginx) | 1h | 4h |
| **Phase 4** | Production compose | 1.5h | 5.5h |
| **Phase 5** | Testing & validation | 2h | **7.5h** |

**Buffer**: Add 25% for unexpected issues = **~9.5 hours total**

---

## Quick Reference Commands

### Development

```bash
# Start all services
docker compose up -d

# View logs (follow mode)
docker compose logs -f app

# Restart a service
docker compose restart app

# Rebuild and restart
docker compose up -d --build

# Stop all services
docker compose down

# Clean slate (WARNING: deletes data)
docker compose down -v

# Access MongoDB shell
docker compose exec mongodb mongosh energy_dashboard

# Access QuestDB console
open http://localhost:9000

# Start with database GUI
docker compose --profile tools up -d
open http://localhost:8081
```

### Production

```bash
# Build production image
docker compose -f docker-compose.prod.yml build

# Start base stack
docker compose -f docker-compose.prod.yml up -d

# Start with all features
docker compose -f docker-compose.prod.yml \
  --profile nginx \
  --profile backup \
  --profile auto-update \
  up -d

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Check service status
docker compose -f docker-compose.prod.yml ps

# Stop all services
docker compose -f docker-compose.prod.yml down
```

### Troubleshooting

```bash
# Check resource usage
docker stats

# Check disk usage
docker system df

# Clean up unused resources
docker system prune -a

# Rebuild without cache
docker compose build --no-cache

# Inspect network
docker network inspect energy-tracker_energy-network

# Inspect volume
docker volume inspect energy-tracker_mongodb_data

# Check service logs
docker compose logs mongodb
docker compose logs questdb
docker compose logs app
```

---

## Post-Implementation Notes

### Known Limitations

1. **Database Plugins Not Yet Implemented**
   - MongoDB and QuestDB plugins (`mongodb.js`, `questdb.js`) don't exist yet
   - Docker setup is ready, but app won't use databases until plugins are implemented
   - App will start successfully but log connection warnings

2. **Fallback to SQLite**
   - Current implementation still uses SQLite (`database.js` plugin)
   - Docker mounts `./data` volume for SQLite fallback
   - No breaking changes until database migration (Phase 1 of main plan)

3. **Environment Variables**
   - HA_URL and HA_TOKEN can be configured via UI (when settings routes implemented)
   - `.env` file serves as fallback mechanism
   - Production deployments should use Docker secrets for sensitive data

### Next Steps (After Docker Implementation)

1. **Implement MongoDB Plugin** (Phase 1)
   - Create `web/api/plugins/mongodb.js`
   - Define collections: settings, entities, subscriptionState, syncLog

2. **Implement QuestDB Plugin** (Phase 1)
   - Create `web/api/plugins/questdb.js`
   - Configure ILP sender and HTTP query client

3. **Update Routes to Use New Databases** (Phase 1)
   - Migrate statistics routes to QuestDB
   - Migrate settings routes to MongoDB

4. **Deploy to Home Lab**
   - Use `docker-compose.prod.yml`
   - Configure reverse proxy (Traefik or Nginx)
   - Set up backup schedule

---

## Deployment Checklist (Home Lab)

### Prerequisites

- [ ] Docker and Docker Compose installed
- [ ] Git repository cloned to home lab server
- [ ] Static IP or hostname configured
- [ ] Home Assistant accessible from server
- [ ] (Optional) Traefik or Nginx reverse proxy running

### Initial Setup

```bash
# 1. Clone repository
git clone <repository-url> /opt/energy-dashboard
cd /opt/energy-dashboard

# 2. Create .env file
cp .env.example .env
nano .env
# Set HA_URL and HA_TOKEN (or configure via UI later)

# 3. Create necessary directories
mkdir -p docker/nginx/certs

# 4. (Optional) Add SSL certificates for Nginx
# cp /path/to/cert.pem docker/nginx/certs/
# cp /path/to/key.pem docker/nginx/certs/

# 5. Start production stack
docker compose -f docker-compose.prod.yml up -d

# 6. Check logs
docker compose -f docker-compose.prod.yml logs -f

# 7. Access dashboard
open http://<server-ip>:3042/dashboard
```

### Configure Home Assistant (via UI)

```bash
# 1. Open settings page
open http://<server-ip>:3042/dashboard/settings

# 2. Enter HA URL and token
# 3. Click "Test Connection"
# 4. Click "Discover Entities"
# 5. Select entities to track
# 6. Restart server to apply settings
docker compose -f docker-compose.prod.yml restart app
```

### Enable Optional Features

```bash
# Enable Nginx reverse proxy
docker compose -f docker-compose.prod.yml --profile nginx up -d

# Enable automated backups
docker compose -f docker-compose.prod.yml --profile backup up -d

# Enable auto-updates
docker compose -f docker-compose.prod.yml --profile auto-update up -d

# Enable all features
docker compose -f docker-compose.prod.yml \
  --profile nginx \
  --profile backup \
  --profile auto-update \
  up -d
```

---

## Implementation Complete ✅

Once all steps are verified and the success criteria checklist is complete, the Docker setup will provide:

1. ✅ **Development Environment**: Hot reload, exposed databases, Mongo Express GUI
2. ✅ **Production Environment**: Optimized builds, restart policies, Traefik integration
3. ✅ **Data Persistence**: Named volumes for MongoDB and QuestDB
4. ✅ **Backup Strategy**: Automated daily backups with retention policies
5. ✅ **Reverse Proxy Support**: Nginx or Traefik integration
6. ✅ **Auto-Updates**: Watchtower for container monitoring
7. ✅ **Monitoring**: Health checks and structured logging

**Status**: Ready for home lab deployment 🚀
