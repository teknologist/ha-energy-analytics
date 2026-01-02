# Docker Setup for Energy Dashboard

This directory contains Docker configuration files for running the Energy Dashboard application.

## Quick Start

### Development Mode
Start only the databases, run the API locally with hot reload:

```bash
./scripts/docker.sh dev
npm run dev
```

### Production Mode
Run everything in Docker:

```bash
./scripts/docker.sh prod
```

## Files

- **Dockerfile.api** - Multi-stage Dockerfile for the API service
- **README.md** - This file

## Architecture

The Docker setup consists of:

1. **MongoDB** (mongo:7.0) - Application state storage
   - Collections: settings, entities, subscriptionState, syncLog
   - Port: 27017
   - Volume: mongodb_data

2. **QuestDB** (questdb/questdb:7.0.1) - Time-series data storage
   - Tables: energy_readings, energy_statistics
   - Ports:
     - 9000: HTTP/REST API & Web Console
     - 9009: InfluxDB Line Protocol (ILP)
     - 8812: PostgreSQL wire protocol
   - Volume: questdb_data

3. **API** (Node.js 22 Alpine) - Platformatic Watt application
   - Fastify API with Home Assistant integration
   - React frontend served at /dashboard
   - Port: 3042 (configurable)
   - Volume: api_data (optional local state)

## Network

All services run on the `energy-network` bridge network, allowing service-to-service communication using service names as hostnames:

- `mongodb` - MongoDB connection URI: `mongodb://mongodb:27017/energy_dashboard`
- `questdb` - QuestDB host: `questdb`

## Volumes

Named volumes for data persistence:

- `energy-dashboard-mongodb-data` - MongoDB database files
- `energy-dashboard-mongodb-config` - MongoDB configuration
- `energy-dashboard-questdb-data` - QuestDB database files
- `energy-dashboard-api-data` - API local state (optional)

## Environment Variables

Configure in `.env` file (created from `.env.example`):

```bash
# Server
PORT=3042
NODE_ENV=production
LOG_LEVEL=info

# MongoDB (use 'mongodb' as host in Docker)
MONGODB_URI=mongodb://mongodb:27017/energy_dashboard

# QuestDB (use 'questdb' as host in Docker)
QUESTDB_HOST=questdb
QUESTDB_ILP_PORT=9009
QUESTDB_HTTP_PORT=9000

# Home Assistant
HA_URL=homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token_here
```

## Health Checks

All services have health checks configured:

- **MongoDB**: `mongosh` ping every 10s
- **QuestDB**: HTTP query check every 15s
- **API**: HTTP /api/health endpoint every 30s

The API service will only start after MongoDB and QuestDB are healthy.

## Docker Compose Commands

Using the helper script:

```bash
# Start development (databases only)
./scripts/docker.sh dev

# Start production (all services)
./scripts/docker.sh prod

# View logs
./scripts/docker.sh logs          # All services
./scripts/docker.sh logs api      # Specific service

# Stop services
./scripts/docker.sh down

# Clean up (removes volumes!)
./scripts/docker.sh clean

# Service status
./scripts/docker.sh status

# Restart services
./scripts/docker.sh restart       # All services
./scripts/docker.sh restart api   # Specific service

# Rebuild API
./scripts/docker.sh rebuild
```

Or use Docker Compose directly:

```bash
# Start services
docker compose up -d

# View logs
docker compose logs -f api

# Stop services
docker compose down

# Remove volumes
docker compose down -v
```

## Accessing Services

### API
- **URL**: http://localhost:3042/api/*
- **Dashboard**: http://localhost:3042/dashboard
- **Health**: http://localhost:3042/api/health

### MongoDB
- **Connection URI**: `mongodb://localhost:27017/energy_dashboard`
- **Shell**: `./scripts/docker.sh mongo` or `docker exec -it energy-dashboard-mongodb mongosh energy_dashboard`

### QuestDB
- **Web Console**: http://localhost:9000
- **REST API**: http://localhost:9000/exec?query=SELECT+*+FROM+energy_readings
- **PostgreSQL**: `psql -h localhost -p 8812 -U admin -d qdb`
- **Helper**: `./scripts/docker.sh questdb` (opens web console)

## Multi-Stage Build

The API Dockerfile uses a multi-stage build for optimal image size:

1. **Builder Stage**: Installs all dependencies, builds frontend assets
2. **Production Stage**: Copies only production dependencies and built artifacts

Image size optimization:
- Alpine Linux base (~50MB)
- No dev dependencies in final image
- Non-root user for security
- Layer caching for faster rebuilds

## Security Considerations

- API runs as non-root user (`nodejs:nodejs`)
- Health checks ensure service availability
- Environment variables for sensitive data (not in image)
- Volume permissions configured for nodejs user
- No secrets in Dockerfile or docker-compose.yml

## Troubleshooting

### API fails to connect to MongoDB
```bash
# Check MongoDB is running and healthy
docker compose ps mongodb
docker compose logs mongodb

# Verify network connectivity
docker compose exec api ping mongodb
```

### API fails to connect to QuestDB
```bash
# Check QuestDB is running and healthy
docker compose ps questdb
docker compose logs questdb

# Test QuestDB HTTP endpoint
curl http://localhost:9000/exec?query=SELECT+1
```

### Build fails
```bash
# Clean build cache
docker compose build --no-cache api

# Check build logs
docker compose build api 2>&1 | tee build.log
```

### Permission errors
```bash
# Check volume permissions
docker compose exec api ls -la /app/data

# Reset volumes (WARNING: deletes data!)
./scripts/docker.sh clean
```

## Development Workflow

1. Start databases in Docker:
   ```bash
   ./scripts/docker.sh dev
   ```

2. Run API locally with hot reload:
   ```bash
   npm run dev
   ```

3. Access services:
   - API: http://localhost:3042
   - MongoDB: mongodb://localhost:27017/energy_dashboard
   - QuestDB: http://localhost:9000

4. Make changes, API auto-reloads

5. Stop databases when done:
   ```bash
   ./scripts/docker.sh down
   ```

## Production Deployment

1. Configure environment:
   ```bash
   cp .env.example .env
   # Edit .env with production values
   ```

2. Start all services:
   ```bash
   ./scripts/docker.sh prod
   ```

3. Monitor logs:
   ```bash
   ./scripts/docker.sh logs
   ```

4. Check health:
   ```bash
   curl http://localhost:3042/api/health
   ```

## Updating

To update to a new version:

```bash
# Pull latest code
git pull

# Rebuild API image
./scripts/docker.sh rebuild

# Or restart all services
./scripts/docker.sh down
./scripts/docker.sh prod
```

## Backup and Restore

### MongoDB Backup
```bash
docker compose exec mongodb mongodump --db energy_dashboard --out /tmp/backup
docker compose cp mongodb:/tmp/backup ./backup
```

### MongoDB Restore
```bash
docker compose cp ./backup mongodb:/tmp/backup
docker compose exec mongodb mongorestore --db energy_dashboard /tmp/backup/energy_dashboard
```

### QuestDB Backup
```bash
# Stop QuestDB
docker compose stop questdb

# Copy data directory
docker compose cp questdb:/var/lib/questdb ./questdb-backup

# Restart QuestDB
docker compose start questdb
```

## Resource Limits

To add resource limits, modify `docker-compose.yml`:

```yaml
services:
  api:
    deploy:
      resources:
        limits:
          cpus: '1.0'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```
