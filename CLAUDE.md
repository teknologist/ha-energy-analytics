# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Energy Dashboard fetches consumption data from Home Assistant via WebSocket API, stores app state in MongoDB and time-series data in QuestDB, and displays insights via React charts. Uses **Platformatic Watt** as the runtime to orchestrate API and frontend services.

## Documentation Standards

- **All diagrams MUST use Mermaid** - architecture, flows, dependencies, sequences, etc.
- Reference the full spec at `specs/energy-dashboard-spec.md` for detailed implementation

## Commands

```bash
# Development (runs all services with hot reload)
npm run dev

# Production
npm run build
npm run start

# Install dependencies (run from project root)
npm install
cd web/api && npm install && cd ../..
cd web/frontend && npm install && cd ../..

# Testing
npm run test:unit      # Run all unit/integration tests
npm run test:coverage  # Run tests with coverage report
npm run test:e2e       # Run E2E tests (requires app running)
```

## Testing

**All tests MUST use Vitest** - no node:test, jest, or other frameworks.

### Test Structure

| Test Type | Location | Description |
|-----------|----------|-------------|
| Unit tests | `web/api/lib/*.test.js` | Pure unit tests for utilities |
| Integration tests | `web/api/test/plugins/*.test.js` | Plugin tests (require MongoDB/QuestDB) |
| E2E tests | `e2e/*.spec.js` | Playwright API tests |

### Coverage Target

- **Minimum 80% statement coverage** on testable code

### Coverage Configuration

**Files included in coverage** (`vitest.config.js`):
- `web/api/**/*.js` - API service code (lib utilities)
- `runtime-plugins/mongodb.js` - MongoDB plugin
- `runtime-plugins/questdb.js` - QuestDB plugin

**Files excluded from coverage:**
- `runtime-plugins/home-assistant.js` - requires real HA instance
- `web/api/routes/**` - covered by E2E tests (Playwright)
- `web/frontend/**` - frontend has separate testing
- All test files (`*.test.js`, `test/**`)

**Why only some files appear in coverage reports:**
Coverage reports only show files that are actually exercised by tests. Files with 0% coverage or no test execution don't appear. The three typical files shown are:
- `runtime-plugins/mongodb.js` - tested via integration tests
- `runtime-plugins/questdb.js` - tested via integration tests
- `web/api/lib/utils.js` - tested via unit tests

Route files don't appear because they're excluded (E2E coverage via Playwright instead).

### Writing Tests

```javascript
// Use vitest imports
import { describe, it, expect, beforeAll, afterAll } from 'vitest';

// For conditional skipping (e.g., when DB unavailable)
describe.skipIf(!DB_AVAILABLE)('Plugin Tests', () => {
  // tests...
});
```

### Running Tests

```bash
# Start databases first (for integration tests)
docker compose up -d mongodb questdb

# Run all tests
npm run test:unit

# Run with coverage
npm run test:coverage

# Run E2E (requires app running on port 3042)
npm run test:e2e
```

## Architecture

```mermaid
flowchart TB
    subgraph Watt["Platformatic Watt Runtime"]
        subgraph RuntimePlugins["Runtime Plugins (Shared)"]
            Mongo["mongodb.js"]
            QDB["questdb.js"]
            HA["home-assistant.js"]
        end

        Runtime["localhost:3042"]
        API["API Service /api/*"]
        Frontend["Frontend /dashboard/*"]

        Runtime --> API
        Runtime --> Frontend
    end

    API --> Mongo
    API --> QDB
    API --> HA

    MongoDB[(MongoDB)]
    QuestDB[(QuestDB)]
    HomeAssistant[Home Assistant]

    Mongo --> MongoDB
    QDB --> QuestDB
    HA <--> HomeAssistant
```

**Runtime Plugins** (`runtime-plugins/`): Shared across all services with `encapsulate: false`
- `mongodb.js` - Application state storage (settings, entities, subscriptions)
- `questdb.js` - Time-series data storage (readings, statistics)
- `home-assistant.js` - WebSocket client + event subscriptions

**Services:**
- **API** (`web/api/`): Fastify service with `@platformatic/service`
  - `routes/` - Auto-loaded routes (entities, statistics, realtime, settings)
  - Accesses shared plugins via `fastify.mongo`, `fastify.questdb`, `fastify.ha`

- **Frontend** (`web/frontend/`): React + Vite served at `/dashboard`
  - Uses React Query, Recharts, ShadCN UI (Radix + Tailwind)
  - `hooks/useEnergy.js` - Data fetching hooks
  - `lib/api.js` - API client

> **Note**: The Recorder service (`web/recorder/`) is planned but not yet implemented. It is excluded from autoload in `watt.json`.

## Data Flow

```mermaid
flowchart LR
    subgraph HA[Home Assistant]
        States[Entity States]
        RecorderDB[Recorder DB]
    end

    subgraph Sync[Data Sync]
        Events[state_changed events]
        Manual[Manual sync API]
    end

    subgraph DB[Database]
        Readings[energy_readings]
        Stats[energy_statistics]
    end

    States --> Events
    Events --> Readings
    RecorderDB --> Manual
    Manual --> Stats

    subgraph Reconciliation
        Heartbeat[3-min check]
        Hourly[Hourly backfill]
    end

    Heartbeat --> Events
    Hourly --> Stats
```

**Two sync modes:**
1. **Event-driven** (real-time): Subscribe to `state_changed` → `energy_readings`
2. **Manual/scheduled**: Fetch `recorder/statistics_during_period` → `energy_statistics`

## Key Technical Details

- All services use ES modules (`"type": "module"`)
- **Node.js 22.19+** required (Platformatic Watt requirement)
- **MongoDB collections**: `settings`, `entities`, `subscriptionState`, `syncLog`
- **QuestDB tables**: `energy_readings`, `energy_statistics`
- Frontend served at `/dashboard`, API at `/api/*`
- HA WebSocket: `ws://{HA_URL}/api/websocket` with token auth

## API Conventions

### Canonical Response Format

All API responses use a consistent format with degraded fallback support:

```javascript
// Success response
{ success: true, data: { ... } }

// Success with degraded data (HA unavailable, using cache)
{ success: true, data: { ... }, degraded: true, degradedReason: "Home Assistant unavailable" }

// Error response
{ success: false, error: "Error message" }
```

When Home Assistant is unavailable, return HTTP 200 with cached data and `degraded: true` flag instead of HTTP 503.

### Parameter Naming Convention

All API parameters use **snake_case**:
- Query parameters: `entity_id`, `start_time`, `end_time`
- Path parameters: `:entity_id`
- Response fields: `entity_id`, `last_updated`, `unit_of_measurement`

## MongoDB Data Management

### Collections and TTL

| Collection | Purpose | Retention |
|------------|---------|-----------|
| `settings` | App configuration | Permanent |
| `entities` | Cached entity metadata | Upsert (no growth) |
| `subscriptionState` | WebSocket subscription state | Permanent |
| `syncLog` | Sync operation logs | 7 days (TTL index) |

### TTL Index for syncLog

```javascript
// Auto-created in event-recorder.js onReady hook
await db.collection('syncLog').createIndex(
  { createdAt: 1 },
  { expireAfterSeconds: 7 * 24 * 60 * 60 }  // 7 days
);
```

## Scheduled Tasks

Platformatic Watt's built-in scheduler handles recurring tasks (configured in `watt.json`):

```json
{
  "scheduler": [
    {
      "name": "hourly-backfill",
      "cron": "0 * * * *",
      "callbackUrl": "http://recorder.plt.local/backfill/trigger",
      "method": "POST",
      "maxRetry": 3,
      "enabled": true
    }
  ]
}
```

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HA_URL` | Home Assistant host:port | `homeassistant.local:8123` |
| `HA_TOKEN` | Long-lived access token | (required) |
| `PORT` | Server port | `3042` |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/energy_dashboard` |
| `QUESTDB_HOST` | QuestDB hostname | `localhost` |
| `QUESTDB_ILP_PORT` | QuestDB ILP ingestion port | `9009` |
| `QUESTDB_HTTP_PORT` | QuestDB HTTP API port | `9000` |

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/entities` | GET | List tracked energy entities |
| `/api/entities/:entity_id` | GET | Get single entity details |
| `/api/entities/:entity_id/tracked` | PATCH | Toggle entity tracking |
| `/api/statistics/:entity_id` | GET | Get hourly/daily statistics |
| `/api/statistics/sync` | POST | Manual sync from HA |
| `/api/insights/top-consumers` | GET | Get top consuming entities |
| `/api/insights/peak` | GET | Get peak usage periods |
| `/api/insights/patterns` | GET | Get consumption patterns |
| `/api/insights/breakdown` | GET | Get consumption breakdown |
| `/api/insights/timeline` | GET | Get consumption timeline |
| `/api/readings/:entity_id` | GET | Real-time readings |
| `/api/subscription/status` | GET | Event subscription status |
| `/api/subscription/backfill` | POST | Force backfill |
| `/api/health` | GET | Health check |
| `/api/status` | GET | System status |
| `/api/settings` | GET | Get all settings |
| `/api/settings/tracked-entities` | POST | Update tracked entities |

## Directory Structure

```
energy-tracker/
├── watt.json                    # Runtime config with shared plugins
├── vitest.config.js             # Test configuration
├── playwright.config.js         # E2E test configuration
├── runtime-plugins/             # Shared plugins (all services access)
│   ├── mongodb.js               # fastify.mongo decorator
│   ├── questdb.js               # fastify.questdb decorator
│   └── home-assistant.js        # fastify.ha decorator
├── web/
│   ├── api/                     # API Service (routes + tests)
│   │   ├── platformatic.json
│   │   ├── routes/
│   │   ├── lib/                 # Utilities + unit tests
│   │   └── test/                # Integration tests
│   └── frontend/                # React frontend
├── e2e/                         # Playwright E2E tests
└── docker/
```

## Extending

**Add new aggregations**: Use QuestDB's `SAMPLE BY` in `runtime-plugins/questdb.js`
**Add new routes**: Create files in `web/api/routes/` - auto-loaded via platformatic.json
**Add shared plugins**: Create in `runtime-plugins/` and register in root `watt.json`

## Critical Rules

### Test Failures

**NEVER change assertions just to make tests pass naively.** When a test fails:

1. **Investigate** - Understand why the test is failing
2. **Determine the root cause** - Is the code wrong or is the assertion wrong?
3. **Fix appropriately**:
   - If the code is wrong → fix the code
   - If the assertion was incorrect → fix the assertion with clear justification
4. **Never blindly modify assertions** without understanding the underlying issue

## Linear Integration

- **Project**: `ha-energy-analytics`
- **Issue Prefix**: `TEK` (e.g., TEK-44, TEK-45)
- **Assignee**: Eric
- **Profile**: `personal`

### Planning Structure

- **Master Plan**: TEK-44 serves as the master implementation plan and orchestrates all issues
- **Issue Plans**: Each individual issue contains its own detailed implementation plan
- **No separate plan files**: Update the Linear issues directly when plans need modification
