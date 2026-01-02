# Docker Quick Start

## TL;DR

```bash
# Development (recommended)
./scripts/docker.sh dev
npm run dev

# Production
./scripts/docker.sh prod
```

## Common Commands

| Command | Description |
|---------|-------------|
| `./scripts/docker.sh dev` | Start databases only (run API locally) |
| `./scripts/docker.sh prod` | Start everything in Docker |
| `./scripts/docker.sh down` | Stop all services |
| `./scripts/docker.sh logs` | View all logs |
| `./scripts/docker.sh logs api` | View API logs only |
| `./scripts/docker.sh mongo` | Open MongoDB shell |
| `./scripts/docker.sh questdb` | Open QuestDB console |
| `./scripts/docker.sh status` | Check service status |
| `./scripts/docker.sh restart` | Restart all services |
| `./scripts/docker.sh rebuild` | Rebuild and restart API |
| `./scripts/docker.sh clean` | ⚠️ Remove everything (deletes data!) |

## Access Services

| Service | URL |
|---------|-----|
| API | http://localhost:3042/api/* |
| Dashboard | http://localhost:3042/dashboard |
| Health Check | http://localhost:3042/api/health |
| MongoDB | mongodb://localhost:27017/energy_dashboard |
| QuestDB Console | http://localhost:9000 |
| QuestDB PostgreSQL | psql -h localhost -p 8812 -U admin -d qdb |

## First Time Setup

```bash
# 1. Ensure .env exists
cp .env.example .env
# Edit .env with your Home Assistant URL and token

# 2. Validate setup
./scripts/docker-test.sh

# 3. Start development
./scripts/docker.sh dev
npm run dev
```

## Environment Variables

**For local development** (use localhost):
```bash
MONGODB_URI=mongodb://localhost:27017/energy_dashboard
QUESTDB_HOST=localhost
```

**For Docker production** (use service names):
```bash
MONGODB_URI=mongodb://mongodb:27017/energy_dashboard
QUESTDB_HOST=questdb
```

## Troubleshooting

```bash
# Check if services are running
./scripts/docker.sh status

# View recent logs
./scripts/docker.sh logs --tail=100

# Restart a specific service
docker compose restart api

# Clean everything and start fresh
./scripts/docker.sh clean
./scripts/docker.sh dev
```

## Data Backup

```bash
# MongoDB
docker compose exec mongodb mongodump --db energy_dashboard --out /tmp/backup
docker compose cp mongodb:/tmp/backup ./backup

# QuestDB (requires stopping service)
docker compose stop questdb
docker compose cp questdb:/var/lib/questdb ./questdb-backup
docker compose start questdb
```

## More Help

- Full docs: `DOCKER.md` (root) or `docker/README.md`
- Script help: `./scripts/docker.sh help`
- Validate setup: `./scripts/docker-test.sh`
