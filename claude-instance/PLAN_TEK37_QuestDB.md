# Docker Setup Implementation Plan - TEK-33 (P5.1)

**Priority:** Medium (P5)
**Status:** Not Started
**Dependencies:** All P1-P4 issues must be complete
**Estimated Effort:** 6-8 hours

---

## Executive Summary

This plan provides a comprehensive Docker setup for the Energy Dashboard application, including:
- Multi-stage Dockerfile for optimized production builds
- Development docker-compose with hot reload
- Production docker-compose for home lab deployment
- MongoDB and QuestDB service orchestration
- Nginx reverse proxy configuration
- Health checks and proper dependency management
- Data persistence via Docker volumes
- Optional profiles for backups and monitoring

**Key Architectural Decision:** The Docker setup implements the dual-database architecture (MongoDB + QuestDB) as specified, moving away from the current SQLite-only implementation.

---

## Prerequisites & Dependencies

### Required Completion Status
Before starting Docker setup, the following MUST be implemented:

✅ **P1 Issues (Database Architecture)**
- MongoDB plugin (`web/api/plugins/mongodb.js`)
- QuestDB plugin (`web/api/plugins/questdb.js`)
- Database schema migration from SQLite to dual-database

✅ **P2 Issues (Event Sync)**
- Event recorder plugin (`web/api/plugins/event-recorder.js`)
- Real-time routes (`web/api/routes/realtime.js`)

✅ **P3 Issues (Settings)**
- Settings routes (`web/api/routes/settings.js`)
- Settings UI integration

✅ **P4 Issues (Integration Testing)**
- All routes tested and working
- Database connections verified

### Why This Order Matters
Docker setup is P5 because:
1. It requires stable, tested application code
2. Database plugins must exist before containerization
3. Service dependencies (MongoDB, QuestDB) need working integration code
4. Health checks depend on functional API endpoints
5. Deployment scripts require complete build processes

---

## Part 1: Dockerfile (Multi-Stage Build)

### Overview
Create a production-optimized multi-stage Dockerfile that:
- Builds frontend assets in a builder stage
- Creates a minimal production runtime image
- Supports both development and production targets
- Uses Node.js 22 Alpine for small image size

### File: `Dockerfile`

**Location:** `/Users/eric/Dev/energy-tracker/Dockerfile`

**Implementation Details:**

#### Stage 1: Builder (Development/Build)
```dockerfile
FROM node:22-alpine AS builder

WORKDIR /app

# Copy all package.json files for dependency installation
COPY package*.json ./
COPY web/api/package*.json ./web/api/
COPY web/frontend/package*.json ./web/frontend/

# Install ALL dependencies (including devDependencies for build)
RUN npm ci
RUN npm ci --workspace=web/api
RUN npm ci --workspace=web/frontend

# Copy source code
COPY . .

# Build frontend (Vite build)
RUN npm run build --workspace=web/frontend
```

**Key Points:**
- Uses `npm ci` for reproducible installs
- Leverages npm workspaces (already configured in spec)
- Installs dev dependencies needed for Vite build
- Builds React frontend to static assets

#### Stage 2: Production Runtime
```dockerfile
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies ONLY
COPY package*.json ./
COPY web/api/package*.json ./web/api/
RUN npm ci --omit=dev
RUN npm ci --omit=dev --workspace=web/api

# Copy built artifacts from builder
COPY --from=builder /app/web/api ./web/api
COPY --from=builder /app/web/frontend/dist ./web/frontend/dist
COPY --from=builder /app/watt.json ./
COPY --from=builder /app/web/frontend/watt.json ./web/frontend/

# Create data directory for runtime storage
RUN mkdir -p /app/data

# Set production environment
ENV NODE_ENV=production
ENV PORT=3042

# Expose application port
EXPOSE 3042

# Health check (depends on /api/status endpoint from P3)
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3042/api/status || exit 1

# Start Platformatic Watt
CMD ["npm", "start"]
```

**Key Points:**
- Only production dependencies installed (smaller image)
- Health check hits `/api/status` endpoint (must be implemented in P3)
- Exposes port 3042 (matches Watt default)
- Uses `wget` for health checks (available in Alpine)

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/Dockerfile`

**Dependencies:**
- `web/frontend/dist/` must exist after build (Vite output)
- `watt.json` runtime configuration
- `web/api/routes/root.js` must include `/api/status` endpoint

### Package.json Workspace Configuration

**Required Addition:** Add workspaces to root package.json

**File:** `/Users/eric/Dev/energy-tracker/package.json`

**Change Required:**
```json
{
  "name": "energy-dashboard",
  "version": "0.0.1",
  "private": true,
  "workspaces": [
    "web/api",
    "web/frontend"
  ],
  "scripts": {
    "dev": "wattpm dev",
    "start": "wattpm start",
    "build": "wattpm build"
  },
  "devDependencies": {
    "wattpm": "^3.29.1"
  }
}
```

**Why:** npm workspaces are required for `npm ci --workspace=*` commands in Dockerfile.

---

## Part 2: .dockerignore File

### Overview
Prevent unnecessary files from being copied into Docker build context, reducing build time and image size.

### File: `.dockerignore`

**Location:** `/Users/eric/Dev/energy-tracker/.dockerignore`

**Content:**
```dockerignore
# Dependencies (installed during build)
node_modules
web/*/node_modules

# Git metadata
.git
.gitignore

# Environment files (should be provided by compose)
.env
.env.*

# Build artifacts (rebuilt in container)
web/frontend/dist
web/frontend/node_modules

# Data files (mounted as volumes)
data/
*.db
*.db-shm
*.db-wal

# Logs
*.log
logs/

# OS files
.DS_Store
Thumbs.db

# IDE files
.vscode/
.idea/
*.swp
*.swo

# Documentation
README.md
CLAUDE.md
specs/
claude-instance/

# CI/CD
.github/

# Testing
coverage/
.nyc_output/
```

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/.dockerignore`

---

## Part 3: Development Docker Compose

### Overview
Development environment with:
- Hot reload via volume mounts
- MongoDB for application state
- QuestDB for time-series data
- Mongo Express for database management (optional profile)
- All services networked together

### File: `docker-compose.yml`

**Location:** `/Users/eric/Dev/energy-tracker/docker-compose.yml`

**Implementation Details:**

#### Service 1: App (Main Application)
```yaml
services:
  app:
    build:
      context: .
      target: builder  # Use builder stage for dev (includes devDependencies)
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
      # Home Assistant (can be overridden by UI settings)
      - HA_URL=${HA_URL:-homeassistant.local:8123}
      - HA_TOKEN=${HA_TOKEN}
    volumes:
      # Hot reload: mount source code
      - ./web:/app/web
      - ./data:/app/data
      # Prevent overwriting node_modules with host's empty dirs
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
```

**Key Points:**
- Targets `builder` stage (has all dev dependencies)
- Volume mounts for hot reload (Vite HMR, Platformatic watch)
- Anonymous volumes for node_modules (prevent overwrite)
- Depends on healthy MongoDB before starting
- Uses environment variables from host `.env` file

#### Service 2: MongoDB (Application State)
```yaml
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
      start_period: 10s
```

**Key Points:**
- Uses official MongoDB 7 image
- Health check using `mongosh` (bundled with mongo:7)
- Named volume for data persistence
- Exposes port for local access (e.g., MongoDB Compass)

#### Service 3: QuestDB (Time-Series Data)
```yaml
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
```

**Key Points:**
- Uses QuestDB 8.2.1 (latest stable)
- Exposes three ports: HTTP (console), ILP (ingestion), PostgreSQL (queries)
- Custom server.conf for tuning (see Part 6)
- Named volume for time-series data persistence
- Read-only config mount

#### Service 4: Mongo Express (Optional - Tools Profile)
```yaml
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
      - mongodb
```

**Key Points:**
- Only starts with `--profile tools`
- Web UI for MongoDB management at http://localhost:8081
- No authentication in dev (local only)
- Useful for debugging entity tracking, settings, sync logs

#### Networks and Volumes
```yaml
volumes:
  mongodb_data:
  questdb_data:

networks:
  energy-network:
    driver: bridge
```

**Key Points:**
- Named volumes for persistence across restarts
- Single bridge network for all services
- No external network access required (localhost only)

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/docker-compose.yml`

**New Directories:**
- `/Users/eric/Dev/energy-tracker/docker/` (for configs)
- `/Users/eric/Dev/energy-tracker/docker/questdb/`
- `/Users/eric/Dev/energy-tracker/docker/nginx/`

**Dependencies:**
- Requires MongoDB plugin implementation (P1)
- Requires QuestDB plugin implementation (P1)
- Requires `/api/status` endpoint (P3)

---

## Part 4: Production Docker Compose

### Overview
Production-ready configuration for home lab deployment with:
- Optimized production builds
- Restart policies for high availability
- Optional Nginx reverse proxy
- Automatic backups via profile
- Watchtower for auto-updates
- Traefik labels for existing reverse proxy integration

### File: `docker-compose.prod.yml`

**Location:** `/Users/eric/Dev/energy-tracker/docker-compose.prod.yml`

**Implementation Details:**

#### Service 1: App (Production Build)
```yaml
services:
  app:
    build:
      context: .
      target: production  # Use production stage (minimal)
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3042
      - MONGODB_URI=mongodb://mongodb:27017/energy_dashboard
      - QUESTDB_HOST=questdb
      - QUESTDB_ILP_PORT=9009
      - QUESTDB_HTTP_PORT=9000
    volumes:
      - app_data:/app/data
    depends_on:
      mongodb:
        condition: service_healthy
      questdb:
        condition: service_started
    networks:
      - energy-network
    labels:
      # Traefik labels (if using existing reverse proxy)
      - "traefik.enable=true"
      - "traefik.http.routers.energy.rule=Host(`energy.local`)"
      - "traefik.http.services.energy.loadbalancer.server.port=3042"
```

**Key Points:**
- Uses `production` target (minimal image)
- `restart: unless-stopped` for automatic recovery
- No port exposure (behind reverse proxy)
- Traefik labels for existing home lab setups
- Minimal volumes (no source code mounts)

#### Service 2: MongoDB (Production)
```yaml
  mongodb:
    image: mongo:7
    restart: unless-stopped
    volumes:
      - mongodb_data:/data/db
    networks:
      - energy-network
    healthcheck:
      test: ["CMD", "mongosh", "--eval", "db.adminCommand('ping')"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
```

**Key Points:**
- No port exposure (internal network only)
- Longer health check intervals (production-tuned)
- Named volume for production data

#### Service 3: QuestDB (Production)
```yaml
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
```

**Key Points:**
- No config file mount (uses defaults)
- Tuned worker count for production
- Named volume for time-series data

#### Service 4: Nginx (Optional - Profile: nginx)
```yaml
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
```

**Key Points:**
- Only starts with `--profile nginx`
- Alternative to Traefik for users without existing proxy
- Supports TLS with custom certs
- Configuration in Part 5

#### Service 5: MongoDB Backup (Optional - Profile: backup)
```yaml
  mongo-backup:
    image: tiredofit/db-backup
    profiles:
      - backup
    restart: unless-stopped
    environment:
      - DB_TYPE=mongo
      - DB_HOST=mongodb
      - DB_NAME=energy_dashboard
      - DB_BACKUP_INTERVAL=1440  # Daily (minutes)
      - DB_CLEANUP_TIME=10080     # Weekly cleanup (minutes)
      - COMPRESSION=GZ
    volumes:
      - backup_data:/backup
    depends_on:
      - mongodb
    networks:
      - energy-network
```

**Key Points:**
- Automated daily backups
- Weekly cleanup of old backups
- Gzip compression
- Stores in named volume (can be backed up externally)

#### Service 6: Watchtower (Optional - Profile: auto-update)
```yaml
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
    command: --interval 86400 energy-dashboard-app-1
```

**Key Points:**
- Automatic Docker image updates
- Scheduled at 4 AM daily
- Cleans up old images
- Monitors only the app container

#### Volumes and Networks
```yaml
volumes:
  app_data:
  mongodb_data:
  questdb_data:
  backup_data:

networks:
  energy-network:
    driver: bridge
```

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/docker-compose.prod.yml`

---

## Part 5: Nginx Configuration

### Overview
Nginx reverse proxy configuration for users without existing reverse proxy infrastructure.

### File: `docker/nginx/nginx.conf`

**Location:** `/Users/eric/Dev/energy-tracker/docker/nginx/nginx.conf`

**Implementation:**

```nginx
events {
    worker_connections 1024;
}

http {
    # Upstream to app container
    upstream energy_app {
        server app:3042;
        keepalive 32;
    }

    # HTTP server (redirect to HTTPS in production)
    server {
        listen 80;
        server_name energy.local;

        # Uncomment for HTTPS redirect in production
        # return 301 https://$server_name$request_uri;

        location / {
            proxy_pass http://energy_app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;

            # Timeouts for WebSocket connections
            proxy_read_timeout 86400s;
            proxy_send_timeout 86400s;
        }

        # WebSocket support for Vite HMR (dev only)
        location /ws {
            proxy_pass http://energy_app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_read_timeout 86400s;
        }
    }

    # HTTPS server (uncomment for production with certs)
    # server {
    #     listen 443 ssl http2;
    #     server_name energy.local;
    #
    #     ssl_certificate /etc/nginx/certs/cert.pem;
    #     ssl_certificate_key /etc/nginx/certs/key.pem;
    #     ssl_protocols TLSv1.2 TLSv1.3;
    #     ssl_ciphers HIGH:!aNULL:!MD5;
    #
    #     location / {
    #         proxy_pass http://energy_app;
    #         proxy_http_version 1.1;
    #         proxy_set_header Host $host;
    #         proxy_set_header X-Real-IP $remote_addr;
    #         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #         proxy_set_header X-Forwarded-Proto $scheme;
    #         proxy_read_timeout 86400s;
    #     }
    # }
}
```

**Key Points:**
- Keepalive connections to app
- WebSocket support (required for Home Assistant WebSocket client)
- Long timeouts for persistent connections
- Optional HTTPS configuration
- X-Forwarded headers for proper logging

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/docker/nginx/nginx.conf`

**New Directories:**
- `/Users/eric/Dev/energy-tracker/docker/nginx/certs/` (for TLS certificates)

**Usage:**
```bash
# Place self-signed or Let's Encrypt certs in docker/nginx/certs/
docker/nginx/certs/
  ├── cert.pem
  └── key.pem
```

---

## Part 6: QuestDB Configuration

### Overview
QuestDB server configuration tuned for home lab deployment with moderate resource usage.

### File: `docker/questdb/server.conf`

**Location:** `/Users/eric/Dev/energy-tracker/docker/questdb/server.conf`

**Implementation:**

```properties
# QuestDB Server Configuration for Energy Dashboard

# HTTP server (Web Console + REST API)
http.bind.to=0.0.0.0:9000
http.min.worker.count=1
http.worker.count=2
http.net.connection.limit=64

# ILP (InfluxDB Line Protocol) - High-performance ingestion
line.tcp.enabled=true
line.tcp.bind.to=0.0.0.0:9009
line.tcp.writer.worker.count=1
line.tcp.net.connection.limit=32
line.tcp.commit.interval.default=2000

# PostgreSQL wire protocol (for SQL queries)
pg.enabled=true
pg.bind.to=0.0.0.0:8812
pg.net.connection.limit=64
pg.worker.count=2

# Memory settings for small home lab (2-4 GB RAM available)
shared.worker.count=2
cairo.sql.copy.buffer.size=2M
cairo.sql.page.frame.max.rows=100000

# Query optimization
cairo.max.uncommitted.rows=500000
cairo.commit.lag=10000

# Partitioning (automatic by timestamp)
cairo.default.partition.by=DAY
cairo.o3.enabled=true

# Logging
log.w.stdout.level=ERROR
```

**Key Points:**
- Tuned for 2-4 GB RAM home lab servers
- 2 shared workers (balance CPU vs memory)
- ILP enabled for real-time event ingestion
- Daily partitioning for time-series data
- Out-of-order ingestion support (O3)
- Error-level logging only

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/docker/questdb/server.conf`

---

## Part 7: Environment File Template

### Overview
Template for environment variables, documenting all available configuration options.

### File: `.env.example`

**Location:** `/Users/eric/Dev/energy-tracker/.env.example`

**Implementation:**

```bash
# Energy Dashboard Environment Configuration
# Copy this file to .env and fill in your values

# =============================================================================
# Application Settings
# =============================================================================
PORT=3042
NODE_ENV=production

# =============================================================================
# MongoDB Configuration (Application State)
# =============================================================================
# Local MongoDB (Docker)
MONGODB_URI=mongodb://localhost:27017/energy_dashboard

# OR: MongoDB with authentication
# MONGODB_URI=mongodb://username:password@localhost:27017/energy_dashboard?authSource=admin

# OR: MongoDB Atlas
# MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/energy_dashboard?retryWrites=true&w=majority

# =============================================================================
# QuestDB Configuration (Time-Series Data)
# =============================================================================
QUESTDB_HOST=localhost
QUESTDB_ILP_PORT=9009
QUESTDB_HTTP_PORT=9000

# Docker users: use container names
# QUESTDB_HOST=questdb

# =============================================================================
# Home Assistant Integration
# =============================================================================
# These settings can be configured via the UI (Settings page)
# Environment variables act as fallback values

# Home Assistant URL (without protocol)
HA_URL=homeassistant.local:8123

# Long-lived access token (generate in HA: Profile → Long-Lived Access Tokens)
HA_TOKEN=your_long_lived_access_token_here

# =============================================================================
# Docker Compose Overrides
# =============================================================================
# Uncomment and customize for docker-compose

# Expose MongoDB port for local tools (e.g., MongoDB Compass)
# MONGODB_EXTERNAL_PORT=27017

# Expose QuestDB console for debugging
# QUESTDB_EXTERNAL_HTTP_PORT=9000

# =============================================================================
# Optional: Nginx Configuration
# =============================================================================
# SERVER_NAME=energy.local
# SSL_CERT_PATH=/path/to/cert.pem
# SSL_KEY_PATH=/path/to/key.pem

# =============================================================================
# Optional: Backup Configuration
# =============================================================================
# BACKUP_INTERVAL=1440  # Minutes (default: daily)
# BACKUP_RETENTION=7    # Days to keep backups
```

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/.env.example`

**Important:** Add `.env` to `.gitignore` (should already be there)

---

## Part 8: Docker Utility Scripts

### Overview
Helper scripts for common Docker operations.

### File: `scripts/docker-dev.sh`

**Location:** `/Users/eric/Dev/energy-tracker/scripts/docker-dev.sh`

**Implementation:**

```bash
#!/bin/bash
# Development Docker Compose helper

set -e

COMPOSE_FILE="docker-compose.yml"

case "$1" in
  up)
    echo "Starting development environment..."
    docker compose -f $COMPOSE_FILE up -d
    echo "Services started. Access:"
    echo "  Dashboard: http://localhost:3042/dashboard"
    echo "  MongoDB: localhost:27017"
    echo "  QuestDB Console: http://localhost:9000"
    ;;

  up-tools)
    echo "Starting development environment with tools..."
    docker compose -f $COMPOSE_FILE --profile tools up -d
    echo "Services started. Access:"
    echo "  Dashboard: http://localhost:3042/dashboard"
    echo "  Mongo Express: http://localhost:8081"
    echo "  QuestDB Console: http://localhost:9000"
    ;;

  down)
    echo "Stopping development environment..."
    docker compose -f $COMPOSE_FILE down
    ;;

  logs)
    docker compose -f $COMPOSE_FILE logs -f ${2:-app}
    ;;

  restart)
    echo "Restarting ${2:-app}..."
    docker compose -f $COMPOSE_FILE restart ${2:-app}
    ;;

  shell)
    docker compose -f $COMPOSE_FILE exec ${2:-app} sh
    ;;

  clean)
    echo "WARNING: This will remove all containers and volumes!"
    read -p "Are you sure? (yes/no): " confirm
    if [ "$confirm" = "yes" ]; then
      docker compose -f $COMPOSE_FILE down -v
      echo "Cleaned up containers and volumes."
    fi
    ;;

  *)
    echo "Usage: $0 {up|up-tools|down|logs|restart|shell|clean} [service]"
    echo ""
    echo "Commands:"
    echo "  up          - Start all services"
    echo "  up-tools    - Start all services + Mongo Express"
    echo "  down        - Stop all services"
    echo "  logs        - View logs (optionally specify service)"
    echo "  restart     - Restart service (default: app)"
    echo "  shell       - Open shell in service (default: app)"
    echo "  clean       - Remove all containers and volumes"
    exit 1
    ;;
esac
```

**Make executable:**
```bash
chmod +x scripts/docker-dev.sh
```

### File: `scripts/docker-prod.sh`

**Location:** `/Users/eric/Dev/energy-tracker/scripts/docker-prod.sh`

**Implementation:**

```bash
#!/bin/bash
# Production Docker Compose helper

set -e

COMPOSE_FILE="docker-compose.prod.yml"

case "$1" in
  up)
    echo "Starting production environment..."
    docker compose -f $COMPOSE_FILE up -d
    echo "Production services started."
    echo "Access dashboard at configured hostname (e.g., http://energy.local)"
    ;;

  up-full)
    echo "Starting production with all profiles..."
    docker compose -f $COMPOSE_FILE --profile nginx --profile backup --profile auto-update up -d
    echo "All services started (Nginx + Backup + Watchtower)."
    ;;

  down)
    echo "Stopping production environment..."
    docker compose -f $COMPOSE_FILE --profile nginx --profile backup --profile auto-update down
    ;;

  logs)
    docker compose -f $COMPOSE_FILE logs -f ${2:-app}
    ;;

  backup-now)
    echo "Running manual MongoDB backup..."
    docker compose -f $COMPOSE_FILE exec mongodb mongodump \
      --db energy_dashboard \
      --archive=/data/backups/manual-$(date +%Y%m%d-%H%M%S).archive \
      --gzip
    echo "Backup completed."
    ;;

  restore)
    if [ -z "$2" ]; then
      echo "Usage: $0 restore <backup-file>"
      exit 1
    fi
    echo "Restoring MongoDB from $2..."
    docker compose -f $COMPOSE_FILE exec -T mongodb mongorestore \
      --archive=/data/backups/$2 \
      --gzip \
      --drop
    echo "Restore completed."
    ;;

  update)
    echo "Pulling latest images and rebuilding..."
    docker compose -f $COMPOSE_FILE pull
    docker compose -f $COMPOSE_FILE build --no-cache
    docker compose -f $COMPOSE_FILE up -d
    echo "Update completed."
    ;;

  *)
    echo "Usage: $0 {up|up-full|down|logs|backup-now|restore|update} [args]"
    echo ""
    echo "Commands:"
    echo "  up          - Start core services (app, mongodb, questdb)"
    echo "  up-full     - Start all services (+ nginx, backup, watchtower)"
    echo "  down        - Stop all services"
    echo "  logs        - View logs (optionally specify service)"
    echo "  backup-now  - Manual MongoDB backup"
    echo "  restore     - Restore from backup file"
    echo "  update      - Pull, rebuild, and restart"
    exit 1
    ;;
esac
```

**Make executable:**
```bash
chmod +x scripts/docker-prod.sh
```

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/scripts/docker-dev.sh`
- `/Users/eric/Dev/energy-tracker/scripts/docker-prod.sh`

**New Directories:**
- `/Users/eric/Dev/energy-tracker/scripts/`

---

## Part 9: Documentation Updates

### Overview
Add Docker deployment documentation to README.

### File Updates Required

#### 1. Update Root README.md

**File:** `/Users/eric/Dev/energy-tracker/README.md`

**Add Section:** "Docker Deployment"

```markdown
## Docker Deployment

### Quick Start (Development)

```bash
# Copy environment template
cp .env.example .env

# Edit .env with your Home Assistant credentials
nano .env

# Start all services
./scripts/docker-dev.sh up

# Or with MongoDB management UI
./scripts/docker-dev.sh up-tools

# Access the dashboard
open http://localhost:3042/dashboard
```

### Production Deployment (Home Lab)

```bash
# Build production image
docker compose -f docker-compose.prod.yml build

# Start core services
./scripts/docker-prod.sh up

# Or start with all features (Nginx, backups, auto-updates)
./scripts/docker-prod.sh up-full

# View logs
./scripts/docker-prod.sh logs app
```

### Service Access

| Service | URL | Description |
|---------|-----|-------------|
| Dashboard | http://localhost:3042/dashboard | Main application |
| QuestDB Console | http://localhost:9000 | Time-series database UI |
| Mongo Express | http://localhost:8081 | MongoDB UI (dev only) |

### Docker Profiles

**Development:**
- `default` - App, MongoDB, QuestDB
- `tools` - Add Mongo Express

**Production:**
- `default` - App, MongoDB, QuestDB
- `nginx` - Add Nginx reverse proxy
- `backup` - Add automated MongoDB backups
- `auto-update` - Add Watchtower for automatic updates

### Manual Operations

```bash
# MongoDB backup
./scripts/docker-prod.sh backup-now

# Restore from backup
./scripts/docker-prod.sh restore backup-20260102-120000.archive

# Update to latest version
./scripts/docker-prod.sh update

# View app logs
docker compose logs -f app

# Shell into app container
docker compose exec app sh
```
```

#### 2. Create Docker-specific README

**File:** `/Users/eric/Dev/energy-tracker/docker/README.md`

**Content:**

```markdown
# Docker Configuration

This directory contains Docker-related configuration files for the Energy Dashboard.

## Directory Structure

```
docker/
├── nginx/
│   ├── nginx.conf       # Nginx reverse proxy configuration
│   └── certs/           # TLS certificates (create manually)
│       ├── cert.pem
│       └── key.pem
└── questdb/
    └── server.conf      # QuestDB tuning configuration
```

## Nginx Setup

### HTTP Only (Development)
The default `nginx.conf` runs HTTP on port 80.

### HTTPS (Production)
1. Generate or obtain TLS certificates
2. Place in `docker/nginx/certs/`
3. Uncomment HTTPS server block in `nginx.conf`
4. Update return 301 redirect in HTTP block

### Self-Signed Certificates (Testing)
```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout docker/nginx/certs/key.pem \
  -out docker/nginx/certs/cert.pem \
  -subj "/CN=energy.local"
```

### Let's Encrypt (Production)
Use certbot or integrate with existing reverse proxy (Traefik, Caddy).

## QuestDB Configuration

The `server.conf` is tuned for home lab deployments (2-4 GB RAM).

**Key Settings:**
- `shared.worker.count=2` - CPU cores allocated
- `cairo.sql.page.frame.max.rows=100000` - Memory per query
- `cairo.default.partition.by=DAY` - Daily time partitions

**Customization:**
- For servers with 8+ GB RAM: increase `shared.worker.count=4`
- For high-frequency ingestion: decrease `line.tcp.commit.interval.default=1000`

## Volumes

**Development:**
- `mongodb_data` - MongoDB database files
- `questdb_data` - QuestDB time-series data
- `./web` - Source code (mounted for hot reload)

**Production:**
- `mongodb_data` - MongoDB database files
- `questdb_data` - QuestDB time-series data
- `app_data` - Application runtime data
- `backup_data` - MongoDB backup archives

**Backup Locations:**
```bash
# List Docker volumes
docker volume ls

# Inspect volume location
docker volume inspect energy-dashboard_mongodb_data

# Manual backup
docker run --rm -v energy-dashboard_mongodb_data:/data -v $(pwd):/backup \
  alpine tar czf /backup/mongodb-backup.tar.gz /data
```

## Networking

All services run in the `energy-network` bridge network.

**Service Names (DNS):**
- `app` - Main application (port 3042)
- `mongodb` - MongoDB (port 27017)
- `questdb` - QuestDB (ports 9000, 9009, 8812)
- `nginx` - Reverse proxy (ports 80, 443)

**Connection from app:**
```bash
# MongoDB URI in container
MONGODB_URI=mongodb://mongodb:27017/energy_dashboard

# QuestDB in container
QUESTDB_HOST=questdb
```

## Health Checks

**App Container:**
- Endpoint: `http://localhost:3042/api/status`
- Interval: 30s
- Timeout: 10s
- Start period: 40s (allow time for DB connections)

**MongoDB Container:**
- Command: `mongosh --eval "db.adminCommand('ping')"`
- Interval: 10s (dev) / 30s (prod)

**QuestDB:**
- No health check (starts immediately)
- App will retry connection on startup

## Troubleshooting

### App won't start
```bash
# Check logs
docker compose logs app

# Common issues:
# 1. MongoDB not ready → Wait for health check
# 2. Invalid HA_TOKEN → Check .env or UI settings
# 3. Port 3042 in use → Change PORT in .env
```

### MongoDB connection failed
```bash
# Test MongoDB health
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Check network
docker compose exec app ping mongodb
```

### QuestDB ingestion errors
```bash
# View QuestDB logs
docker compose logs questdb

# Access QuestDB console
open http://localhost:9000

# Check table schema
SELECT * FROM energy_readings LIMIT 1;
```

### Hot reload not working (dev)
```bash
# Ensure volumes are mounted
docker compose exec app ls -la /app/web

# Restart with clean build
docker compose down
docker compose build --no-cache
docker compose up
```
```

### Files Modified/Created

**Modified Files:**
- `/Users/eric/Dev/energy-tracker/README.md` (add Docker section)

**New Files:**
- `/Users/eric/Dev/energy-tracker/docker/README.md`

---

## Part 10: CI/CD Integration (Optional)

### Overview
GitHub Actions workflow for building and testing Docker images on push.

### File: `.github/workflows/docker.yml`

**Location:** `/Users/eric/Dev/energy-tracker/.github/workflows/docker.yml`

**Implementation:**

```yaml
name: Docker Build & Test

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  docker-build:
    runs-on: ubuntu-latest

    steps:
      - name: Checkout code
        uses: actions/checkout@v4

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v3

      - name: Build Docker image
        uses: docker/build-push-action@v5
        with:
          context: .
          target: production
          push: false
          tags: energy-dashboard:test
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Test Docker image
        run: |
          docker run --rm energy-dashboard:test npm --version
          docker run --rm energy-dashboard:test node --version

      - name: Scan image for vulnerabilities
        uses: aquasecurity/trivy-action@master
        with:
          image-ref: energy-dashboard:test
          format: 'table'
          exit-code: '0'
          severity: 'CRITICAL,HIGH'
```

**Key Points:**
- Builds on every push to main/develop
- Uses GitHub Actions cache for faster builds
- Tests that Node.js is available in image
- Scans for security vulnerabilities with Trivy

### Files Modified/Created

**New Files (Optional):**
- `/Users/eric/Dev/energy-tracker/.github/workflows/docker.yml`

---

## Part 11: Testing & Validation

### Testing Checklist

After implementing all Docker files, perform these validation steps:

#### 1. Development Environment Test
```bash
# Build and start
./scripts/docker-dev.sh up

# Verify services are running
docker compose ps

# Expected output:
# - app (healthy)
# - mongodb (healthy)
# - questdb (running)

# Test endpoints
curl http://localhost:3042/api/status
curl http://localhost:3042/api/entities

# Check QuestDB console
open http://localhost:9000

# Stop services
./scripts/docker-dev.sh down
```

#### 2. Production Build Test
```bash
# Build production image
docker compose -f docker-compose.prod.yml build

# Start production stack
./scripts/docker-prod.sh up

# Verify health
docker compose -f docker-compose.prod.yml ps

# Test endpoints (via Traefik or direct)
curl http://localhost:3042/api/status

# Check logs for errors
docker compose -f docker-compose.prod.yml logs app | grep ERROR

# Stop services
./scripts/docker-prod.sh down
```

#### 3. Volume Persistence Test
```bash
# Start dev environment
./scripts/docker-dev.sh up

# Create test data (via UI or API)
# Settings → Configure HA
# Settings → Discover Entities

# Stop and remove containers
docker compose down

# Start again
./scripts/docker-dev.sh up

# Verify data persists
curl http://localhost:3042/api/settings
# Should show previously configured HA settings
```

#### 4. Hot Reload Test (Development)
```bash
# Start dev environment
./scripts/docker-dev.sh up-tools

# Edit a frontend file
echo "// test comment" >> web/frontend/src/main.jsx

# Check logs for Vite HMR
docker compose logs -f app | grep "HMR"
# Should see Vite reloading

# Edit a backend file
echo "// test comment" >> web/api/routes/root.js

# Check logs for Platformatic reload
docker compose logs -f app | grep "restart"
# Should see Platformatic restarting
```

#### 5. Database Integration Test
```bash
# Start services
./scripts/docker-dev.sh up

# Test MongoDB connection
docker compose exec app node -e "
const { MongoClient } = require('mongodb');
const client = new MongoClient('mongodb://mongodb:27017');
client.connect().then(() => {
  console.log('MongoDB connected');
  client.close();
});
"

# Test QuestDB connection
curl http://localhost:9000/exec?query=SELECT%201

# Expected: {"query":"SELECT 1","columns":[...],"dataset":[[1]],"count":1}
```

#### 6. Multi-Service Communication Test
```bash
# Start all services
./scripts/docker-dev.sh up

# App → MongoDB
docker compose exec app node -e "console.log(process.env.MONGODB_URI)"
# Should print: mongodb://mongodb:27017/energy_dashboard

# App → QuestDB
docker compose exec app ping -c 1 questdb
# Should succeed

# MongoDB → Accessible from app
docker compose exec app nc -zv mongodb 27017
# Should succeed
```

### Files Modified/Created

**New Files (Optional):**
- `/Users/eric/Dev/energy-tracker/tests/docker-integration.sh` (automated test script)

---

## Part 12: Migration from SQLite to Docker

### Overview
Guide for migrating existing SQLite data to the new Docker-based dual-database setup.

### Migration Script: `scripts/migrate-to-docker.sh`

**Location:** `/Users/eric/Dev/energy-tracker/scripts/migrate-to-docker.sh`

**Implementation:**

```bash
#!/bin/bash
# Migrate existing SQLite data to Docker MongoDB + QuestDB

set -e

echo "Energy Dashboard: SQLite → Docker Migration"
echo "==========================================="
echo ""

# Check if SQLite database exists
SQLITE_DB="./data/energy.db"
if [ ! -f "$SQLITE_DB" ]; then
  echo "No SQLite database found at $SQLITE_DB"
  echo "Starting fresh Docker deployment..."
  exit 0
fi

echo "Found existing SQLite database: $SQLITE_DB"
echo ""

# Start Docker services
echo "Starting Docker services..."
docker compose up -d mongodb questdb
sleep 10

echo "Exporting data from SQLite..."

# Export entities
sqlite3 $SQLITE_DB "SELECT * FROM entities;" > /tmp/entities.csv
echo "  - Exported entities"

# Export statistics
sqlite3 $SQLITE_DB "SELECT * FROM energy_statistics;" > /tmp/statistics.csv
echo "  - Exported statistics"

# Export sync logs
sqlite3 $SQLITE_DB "SELECT * FROM sync_log;" > /tmp/sync_log.csv
echo "  - Exported sync logs"

echo ""
echo "Importing data to Docker databases..."

# TODO: Implement import logic once MongoDB/QuestDB plugins exist
# This will require:
# 1. Node.js script to read CSV and insert into MongoDB
# 2. QuestDB ILP ingestion for statistics
# 3. Mapping of SQLite schema to new dual-database schema

echo ""
echo "Migration preparation complete."
echo ""
echo "NEXT STEPS:"
echo "1. Implement MongoDB/QuestDB plugins (P1)"
echo "2. Run migration import script (to be created)"
echo "3. Verify data in new databases"
echo "4. Start full application with: ./scripts/docker-dev.sh up"
echo ""
echo "Your original SQLite database is preserved at: $SQLITE_DB"
```

**Make executable:**
```bash
chmod +x scripts/migrate-to-docker.sh
```

**Note:** Full migration script requires P1 (database plugins) to be implemented first.

### Files Modified/Created

**New Files:**
- `/Users/eric/Dev/energy-tracker/scripts/migrate-to-docker.sh`

---

## Implementation Sequence

### Phase 1: Core Docker Files (2 hours)
1. Create `Dockerfile` with multi-stage build
2. Create `.dockerignore`
3. Update root `package.json` with workspaces
4. Create `.env.example`

**Validation:**
```bash
docker build -t energy-dashboard:test .
docker run --rm energy-dashboard:test npm --version
```

### Phase 2: Development Compose (1.5 hours)
1. Create `docker-compose.yml`
2. Create `docker/questdb/server.conf`
3. Create `scripts/docker-dev.sh`

**Validation:**
```bash
./scripts/docker-dev.sh up
docker compose ps
curl http://localhost:3042/api/status
```

### Phase 3: Production Compose (1.5 hours)
1. Create `docker-compose.prod.yml`
2. Create `docker/nginx/nginx.conf`
3. Create `scripts/docker-prod.sh`

**Validation:**
```bash
docker compose -f docker-compose.prod.yml build
./scripts/docker-prod.sh up
```

### Phase 4: Documentation (1 hour)
1. Update `README.md` with Docker section
2. Create `docker/README.md`
3. Test all documented commands

### Phase 5: Testing & Refinement (2 hours)
1. Run full integration tests
2. Test hot reload in dev
3. Test persistence across restarts
4. Optimize build cache layers
5. Document any issues found

**Total Estimated Time:** 8 hours

---

## Files Summary

### New Files Created (19 files)

**Docker Core:**
1. `/Users/eric/Dev/energy-tracker/Dockerfile`
2. `/Users/eric/Dev/energy-tracker/.dockerignore`
3. `/Users/eric/Dev/energy-tracker/.env.example`

**Docker Compose:**
4. `/Users/eric/Dev/energy-tracker/docker-compose.yml`
5. `/Users/eric/Dev/energy-tracker/docker-compose.prod.yml`

**Configurations:**
6. `/Users/eric/Dev/energy-tracker/docker/nginx/nginx.conf`
7. `/Users/eric/Dev/energy-tracker/docker/questdb/server.conf`
8. `/Users/eric/Dev/energy-tracker/docker/README.md`

**Scripts:**
9. `/Users/eric/Dev/energy-tracker/scripts/docker-dev.sh`
10. `/Users/eric/Dev/energy-tracker/scripts/docker-prod.sh`
11. `/Users/eric/Dev/energy-tracker/scripts/migrate-to-docker.sh`

**Documentation:**
12. `/Users/eric/Dev/energy-tracker/README.md` (modified)

**Optional:**
13. `/Users/eric/Dev/energy-tracker/.github/workflows/docker.yml`
14. `/Users/eric/Dev/energy-tracker/tests/docker-integration.sh`

### Modified Files (1 file)

1. `/Users/eric/Dev/energy-tracker/package.json` (add workspaces)

### New Directories (3 directories)

1. `/Users/eric/Dev/energy-tracker/docker/`
2. `/Users/eric/Dev/energy-tracker/docker/nginx/`
3. `/Users/eric/Dev/energy-tracker/docker/questdb/`
4. `/Users/eric/Dev/energy-tracker/scripts/`

---

## Dependency Analysis

### Hard Dependencies (Must Be Implemented First)

**From P1 (Database Architecture):**
- `/Users/eric/Dev/energy-tracker/web/api/plugins/mongodb.js`
- `/Users/eric/Dev/energy-tracker/web/api/plugins/questdb.js`
- MongoDB collections: `settings`, `entities`, `subscriptionState`, `syncLog`
- QuestDB tables: `energy_readings`, `energy_statistics`

**Why:** Docker Compose services (MongoDB, QuestDB) are useless without application code to connect to them.

**From P3 (Settings & Status):**
- `/Users/eric/Dev/energy-tracker/web/api/routes/settings.js`
- Endpoint: `GET /api/status` (required for health check)

**Why:** Dockerfile health check fails without `/api/status` endpoint.

### Soft Dependencies (Recommended but Optional)

**From P2 (Event Recorder):**
- `/Users/eric/Dev/energy-tracker/web/api/plugins/event-recorder.js`
- Real-time data ingestion

**Why:** Docker setup works without this, but the application won't have real-time functionality.

**From P4 (Testing):**
- Integration tests for all routes
- Database connection verification

**Why:** Ensures Docker deployment is stable and production-ready.

---

## Risk Assessment

### High Risk
1. **Database plugins not implemented**
   - **Impact:** Docker containers start but app crashes
   - **Mitigation:** Block Docker implementation until P1 complete
   - **Validation:** Test database connections before Docker work

2. **Volume mount permissions**
   - **Impact:** MongoDB/QuestDB can't write data
   - **Mitigation:** Use named volumes (already in compose files)
   - **Validation:** Test data persistence across restarts

3. **Port conflicts**
   - **Impact:** Services fail to start
   - **Mitigation:** Document all ports, make configurable
   - **Validation:** Check for port usage before starting

### Medium Risk
1. **Health check fails on slow systems**
   - **Impact:** Docker marks container unhealthy
   - **Mitigation:** Increase `start_period` to 60s
   - **Validation:** Test on low-spec hardware

2. **Hot reload breaks in containers**
   - **Impact:** Development workflow slowed
   - **Mitigation:** Volume mounts for node_modules, proper Vite config
   - **Validation:** Test HMR after file changes

3. **Build cache invalidation**
   - **Impact:** Slow builds (10+ minutes)
   - **Mitigation:** Optimize layer ordering, use BuildKit
   - **Validation:** Test with `--no-cache` to measure worst case

### Low Risk
1. **Nginx config needs TLS setup**
   - **Impact:** Users need manual cert generation
   - **Mitigation:** Document self-signed and Let's Encrypt options
   - **Validation:** Test both HTTP and HTTPS configurations

2. **QuestDB memory usage**
   - **Impact:** OOM on low-RAM systems
   - **Mitigation:** Tuned `server.conf`, document min requirements
   - **Validation:** Test on 2GB RAM VM

---

## Success Criteria

### Must Have (MVP)
- [ ] Dockerfile builds successfully
- [ ] Development compose starts all services
- [ ] App connects to MongoDB
- [ ] App connects to QuestDB
- [ ] Frontend accessible at http://localhost:3042/dashboard
- [ ] Health check passes
- [ ] Data persists across container restarts

### Should Have
- [ ] Production compose builds successfully
- [ ] Hot reload works in development
- [ ] MongoDB backup profile works
- [ ] Nginx reverse proxy functional
- [ ] All scripts executable and documented

### Nice to Have
- [ ] CI/CD pipeline builds Docker images
- [ ] Watchtower auto-update works
- [ ] Migration script from SQLite
- [ ] Docker Hub automated builds

---

## Troubleshooting Guide

### Common Issues & Solutions

#### Issue: "Cannot connect to MongoDB"
```bash
# Check MongoDB health
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Solution 1: Wait for health check
docker compose logs mongodb | grep "Waiting for connections"

# Solution 2: Increase start_period in compose
healthcheck:
  start_period: 60s  # Increase from 10s
```

#### Issue: "QuestDB ILP connection refused"
```bash
# Check QuestDB is listening
docker compose exec questdb netstat -tuln | grep 9009

# Solution: Ensure port is exposed in compose
ports:
  - "9009:9009"
```

#### Issue: "Vite HMR not working"
```bash
# Check volumes are mounted correctly
docker compose exec app ls -la /app/web/frontend/src

# Solution: Add Vite HMR configuration
# vite.config.js:
server: {
  host: '0.0.0.0',
  port: 5173,
  watch: {
    usePolling: true
  }
}
```

#### Issue: "Build fails: Cannot find package"
```bash
# Solution: Ensure workspaces are configured
# package.json:
{
  "workspaces": ["web/api", "web/frontend"]
}

# Rebuild from scratch
docker compose build --no-cache
```

#### Issue: "Permission denied: /app/data"
```bash
# Solution: Use named volumes instead of bind mounts
volumes:
  - app_data:/app/data  # Named volume
  # NOT: - ./data:/app/data  # Bind mount
```

---

## Performance Optimization

### Build Time Optimization
1. **Layer Caching:** Copy package.json before source code
2. **Multi-stage:** Separate builder and production stages
3. **BuildKit:** Use Docker BuildKit for parallel builds
4. **CI Cache:** Use GitHub Actions cache for layers

**Expected Build Times:**
- Cold build (no cache): 8-12 minutes
- Warm build (cached layers): 2-3 minutes
- Development rebuild: <1 minute (layers cached)

### Runtime Optimization
1. **QuestDB Tuning:** Adjust worker count based on CPU cores
2. **MongoDB Compression:** Enable WiredTiger compression
3. **Nginx Caching:** Cache static assets
4. **Connection Pooling:** Configure MongoDB connection pools

**Expected Resource Usage:**
- App: 200-300 MB RAM, <10% CPU
- MongoDB: 100-200 MB RAM, <5% CPU
- QuestDB: 300-500 MB RAM, <15% CPU
- **Total:** ~1 GB RAM, suitable for Raspberry Pi 4 or similar

---

## Security Considerations

### Production Deployment
1. **MongoDB Authentication:**
   ```yaml
   mongodb:
     environment:
       - MONGO_INITDB_ROOT_USERNAME=admin
       - MONGO_INITDB_ROOT_PASSWORD=${MONGO_PASSWORD}
   ```

2. **QuestDB Access Control:**
   - Enable authentication in `server.conf`
   - Use environment variables for credentials

3. **Nginx TLS:**
   - Use Let's Encrypt for free certificates
   - Configure TLS 1.2+ only
   - Enable HSTS headers

4. **Docker Socket:**
   - Watchtower has access to Docker socket
   - **Risk:** Container escape if compromised
   - **Mitigation:** Use read-only socket or skip Watchtower

5. **Secret Management:**
   - Use Docker secrets (Swarm) or external vault
   - Never commit `.env` to git
   - Rotate HA_TOKEN regularly

---

## Rollback Plan

If Docker deployment fails or causes issues:

### Emergency Rollback to SQLite
```bash
# Stop Docker services
docker compose down

# Restore original environment
export DATABASE_TYPE=sqlite
export DATABASE_PATH=./data/energy.db

# Run without Docker
npm install
npm run dev
```

### Partial Rollback (Keep Docker, Use SQLite)
```bash
# Comment out MongoDB/QuestDB in docker-compose.yml
# Modify app environment:
environment:
  - DATABASE_TYPE=sqlite
  - DATABASE_PATH=/app/data/energy.db

# Restart
docker compose up -d
```

---

## Post-Implementation Checklist

After completing Docker setup:

- [ ] Test development workflow (up, logs, shell, down)
- [ ] Test production build and deployment
- [ ] Verify data persistence (stop/start containers)
- [ ] Test hot reload in development
- [ ] Test MongoDB connection from app
- [ ] Test QuestDB ingestion and queries
- [ ] Test Nginx reverse proxy (if using)
- [ ] Test backup and restore process
- [ ] Document any environment-specific tweaks
- [ ] Update Linear issue TEK-33 with completion notes
- [ ] Create follow-up issues if needed (e.g., CI/CD, monitoring)

---

## Appendix: Environment Variable Reference

### Complete Environment Variable List

| Variable | Required | Default | Description | Used By |
|----------|----------|---------|-------------|---------|
| `PORT` | No | `3042` | Application HTTP port | App, Nginx |
| `NODE_ENV` | No | `development` | Node environment | App |
| `MONGODB_URI` | Yes | - | MongoDB connection string | App (MongoDB plugin) |
| `QUESTDB_HOST` | Yes | `localhost` | QuestDB hostname | App (QuestDB plugin) |
| `QUESTDB_ILP_PORT` | No | `9009` | QuestDB ILP ingestion port | App (QuestDB plugin) |
| `QUESTDB_HTTP_PORT` | No | `9000` | QuestDB HTTP query port | App (QuestDB plugin) |
| `HA_URL` | No* | - | Home Assistant URL | App (HA plugin) |
| `HA_TOKEN` | No* | - | Home Assistant access token | App (HA plugin) |

*Can be configured via Settings UI instead of environment

---

## Conclusion

This implementation plan provides a complete Docker setup for the Energy Dashboard, enabling:
- **Development:** Fast iteration with hot reload
- **Production:** Stable home lab deployment with high availability
- **Scalability:** Easy addition of features (backups, monitoring, load balancing)
- **Portability:** Runs on any system with Docker (x86, ARM, cloud, local)

**Estimated Total Effort:** 6-8 hours
**Blockers:** Must complete P1 (database plugins) before implementation
**Risk Level:** Low (well-documented, follows Docker best practices)

**Next Steps:**
1. Complete P1-P4 issues (database, event sync, settings, testing)
2. Review this plan with stakeholders
3. Begin Docker implementation following phased approach
4. Test thoroughly before marking TEK-33 complete
