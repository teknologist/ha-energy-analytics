# Flow Report: Energy Dashboard Data Flows & Interactions

**Date:** 2026-01-02
**Project:** Energy Dashboard (energy-tracker)

---

## Overview

This report analyzes all data flows, component interactions, and system behaviors in the Energy Dashboard project, comparing current implementation against the specification.

---

## System Architecture Flow

### Current Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend (React + Vite)"]
        UI[User Interface<br/>index.jsx, history.jsx, settings.jsx]
        Hooks[React Query Hooks<br/>useEnergy.js]
        API_Client[API Client<br/>lib/api.js]
    end

    subgraph API["API Service (Fastify)"]
        Routes[Routes<br/>entities.js, statistics.js, root.js]
        HA_Plugin[HA Plugin<br/>home-assistant.js]
        DB_Plugin[DB Plugin<br/>database.js]
    end

    subgraph Storage["Storage"]
        SQLite[(SQLite<br/>energy.db)]
    end

    subgraph External["External Services"]
        HA[Home Assistant<br/>WebSocket API]
    end

    UI --> Hooks
    Hooks --> API_Client
    API_Client -->|HTTP| Routes
    Routes --> HA_Plugin
    Routes --> DB_Plugin
    DB_Plugin --> SQLite
    HA_Plugin -->|WebSocket| HA
```

### Spec Required Architecture

```mermaid
flowchart TB
    subgraph Frontend["Frontend"]
        UI[User Interface]
        Hooks[React Query]
        API_Client[API Client]
    end

    subgraph API["API Service"]
        Routes[Routes]
        HA_Plugin[HA Plugin]
        Mongo_Plugin[MongoDB Plugin]
        Quest_Plugin[QuestDB Plugin]
        Event_Recorder[Event Recorder Plugin]
    end

    subgraph Storage["Dual-Database"]
        MongoDB[(MongoDB<br/>App State)]
        QuestDB[(QuestDB<br/>Time-Series)]
    end

    subgraph External["External"]
        HA[Home Assistant]
    end

    UI --> Hooks --> API_Client -->|HTTP| Routes
    Routes --> Mongo_Plugin --> MongoDB
    Routes --> Quest_Plugin --> QuestDB
    Routes --> Event_Recorder

    Event_Recorder --> HA_Plugin
    Event_Recorder --> Mongo_Plugin
    Event_Recorder --> Quest_Plugin

    HA_Plugin -->|WebSocket| HA
```

**Key Differences:**
- Current: Single SQLite database
- Required: MongoDB (config/state) + QuestDB (metrics)
- Current: No event recorder
- Required: Event-driven sync with reconciliation

---

## Data Flow Diagrams

### Flow 1: Manual Data Sync (Current Implementation)

```mermaid
sequenceDiagram
    actor User
    participant UI as Frontend UI
    participant API as API Routes
    participant HA as HA Plugin
    participant DB as SQLite
    participant HomeAssistant as Home Assistant

    User->>UI: Click "Sync from HA"
    UI->>UI: Get selected entity + time range
    UI->>API: POST /api/statistics/sync<br/>{entity_ids, start_time, end_time}

    API->>HA: getStatistics(ids, start, end, 'hour')
    HA->>HomeAssistant: WebSocket: recorder/statistics_during_period
    HomeAssistant-->>HA: Statistics array
    HA-->>API: Parsed statistics

    API->>DB: insertStatsBatch(records)
    DB->>DB: INSERT OR REPLACE INTO energy_statistics

    API-->>UI: {success: true, records_synced: N}
    UI->>UI: Invalidate queries
    UI->>API: GET /api/statistics/:entity_id
    API->>DB: SELECT * FROM energy_statistics
    DB-->>API: Statistics rows
    API-->>UI: {data: [...]}
    UI->>UI: Render charts
```

**Characteristics:**
- User-initiated
- Synchronous (blocks until complete)
- No automatic updates
- Gaps during offline periods

---

### Flow 2: Real-Time Event Sync (Spec Required)

```mermaid
sequenceDiagram
    participant HA_WS as Home Assistant<br/>WebSocket
    participant EventRec as Event Recorder<br/>Plugin
    participant QuestDB as QuestDB<br/>(Readings)
    participant MongoDB as MongoDB<br/>(State)
    participant UI as Frontend UI

    Note over EventRec: Startup
    EventRec->>MongoDB: Load known entities
    EventRec->>HA_WS: subscribeToStateChanges()
    HA_WS-->>EventRec: Subscription confirmed

    Note over EventRec: Check for gaps
    EventRec->>MongoDB: getSubscriptionState()
    MongoDB-->>EventRec: {lastEventAt: "2026-01-01T10:00:00Z"}
    EventRec->>EventRec: Detect 2-hour gap
    EventRec->>HA_WS: getStatistics(gap period)
    HA_WS-->>EventRec: Historical stats
    EventRec->>QuestDB: writeStats(backfill_data)

    loop Real-time Events
        HA_WS->>EventRec: state_changed event<br/>{entity_id, new_state, old_state}
        EventRec->>EventRec: Filter: isEnergyEntity?
        alt Is energy entity
            EventRec->>QuestDB: writeReadings([{<br/>  entity_id, state, timestamp<br/>}])
            EventRec->>MongoDB: updateSubscriptionState({<br/>  lastEventAt: now<br/>})
        end
    end

    loop Every 5 minutes
        EventRec->>MongoDB: getSubscriptionState()
        MongoDB-->>EventRec: {lastEventAt: "..."}
        EventRec->>EventRec: Check if stale (> 2 min)
        alt Connection stale
            EventRec->>HA_WS: reconnect()
            EventRec->>HA_WS: backfillStatistics()
        end
    end

    loop Every hour
        EventRec->>HA_WS: getStatistics(last hour)
        HA_WS-->>EventRec: Hourly stats
        EventRec->>QuestDB: writeStats(hourly_data)
        EventRec->>MongoDB: logSync({<br/>  syncType: 'reconciliation'<br/>})
    end

    Note over UI: User opens dashboard
    UI->>EventRec: GET /api/readings/:entity_id
    EventRec->>QuestDB: SELECT * FROM energy_readings<br/>WHERE timestamp > now() - 24h
    QuestDB-->>EventRec: Raw readings
    EventRec-->>UI: {readings: [...]}
    UI->>UI: Live-update charts
```

**Characteristics:**
- Automatic, continuous
- Sub-second latency
- Gap-aware reconciliation
- Resilient to network failures

---

### Flow 3: Entity Discovery & Tracking

#### Current Flow

```mermaid
sequenceDiagram
    actor User
    participant UI as Frontend
    participant API as API Routes
    participant HA as HA Plugin
    participant DB as SQLite
    participant HomeAssistant as Home Assistant

    User->>UI: Open dashboard
    UI->>API: GET /api/entities
    API->>HA: getEnergyEntities()
    HA->>HomeAssistant: WebSocket: get_states
    HomeAssistant-->>HA: All entity states
    HA->>HA: Filter by:<br/>- entity_id patterns<br/>- device_class<br/>- unit_of_measurement
    HA-->>API: Filtered energy entities

    API->>DB: upsertEntity(entity) for each
    DB->>DB: INSERT OR REPLACE INTO entities

    API-->>UI: {entities: [...]}
    UI->>UI: Populate EntitySelector dropdown

    User->>UI: Select entity from dropdown
    UI->>UI: Store selectedEntity in state
    UI->>API: GET /api/statistics/:entity_id
```

**Issues:**
- No user control over which entities to track
- All discovered entities are stored
- No "tracked" vs "available" distinction

#### Spec Required Flow

```mermaid
sequenceDiagram
    actor User
    participant Settings as Settings Page
    participant API as API Routes
    participant HA as HA Plugin
    participant MongoDB as MongoDB
    participant HomeAssistant as Home Assistant

    User->>Settings: Click "Discover Entities"
    Settings->>API: POST /api/settings/discover-entities
    API->>HA: discoverEnergyEntities()
    HA->>HomeAssistant: get_states
    HomeAssistant-->>HA: States
    HA-->>API: Filtered entities

    API->>MongoDB: upsertEntity({<br/>  entity_id, friendly_name,<br/>  isTracked: false, isActive: true<br/>})
    API-->>Settings: {discovered: 15, entities: [...]}

    Settings->>Settings: Render checkbox list
    User->>Settings: Select entities to track
    User->>Settings: Click "Track N Entities"

    Settings->>API: POST /api/settings/tracked-entities<br/>{entity_ids: [...]}
    API->>MongoDB: Set all isTracked = false
    API->>MongoDB: Set selected isTracked = true
    API-->>Settings: {success: true}

    Note over API: Event Recorder uses tracked entities
    API->>MongoDB: getEntities(trackedOnly = true)
    MongoDB-->>API: Tracked entities only
    API->>API: Subscribe to state_changed<br/>for tracked entities only
```

**Improvements:**
- User explicitly chooses which entities to track
- Reduces noise from irrelevant sensors
- Saves ingestion bandwidth

---

### Flow 4: Settings Configuration

#### Current Flow
**Status:** Frontend exists, backend missing

```mermaid
sequenceDiagram
    actor User
    participant Settings as Settings Page
    participant API as API Routes (NOT IMPLEMENTED)

    User->>Settings: Open /dashboard/settings
    Settings->>API: GET /api/settings
    API-->>Settings: 404 Not Found

    Note over Settings: Shows hardcoded HA_URL<br/>from environment
```

#### Spec Required Flow

```mermaid
sequenceDiagram
    actor User
    participant Settings as Settings Page
    participant API as Settings Routes
    participant MongoDB as MongoDB
    participant HA_WS as Home Assistant

    User->>Settings: Open /dashboard/settings
    Settings->>API: GET /api/settings
    API->>MongoDB: getAllSettings()
    MongoDB-->>API: {ha_url: "...", ha_token: "***"}
    API-->>Settings: {settings, ha_connected: true}
    Settings->>Settings: Populate form fields

    User->>Settings: Enter new HA URL + token
    User->>Settings: Click "Save Configuration"

    Settings->>API: POST /api/settings/home-assistant<br/>{url: "...", token: "..."}
    API->>API: Test connection first
    API->>HA_WS: Connect + Authenticate
    HA_WS-->>API: auth_ok
    API->>API: Close test connection

    API->>MongoDB: setSetting('ha_url', url)
    API->>MongoDB: setSetting('ha_token', token)
    API-->>Settings: {success: true, message: "Restart to apply"}
    Settings->>Settings: Show success message
```

**Benefits:**
- No manual `.env` editing
- Connection validation before saving
- Stored securely in database

---

### Flow 5: Query & Display Statistics

#### Current Flow

```mermaid
sequenceDiagram
    participant UI as Dashboard Page
    participant Hooks as useEnergy.js
    participant API as API Routes
    participant DB as SQLite

    Note over UI: User selects entity + time range
    UI->>UI: setState({selectedEntity, timeRange})

    UI->>Hooks: useStatistics(entityId, timeRange)
    Hooks->>Hooks: Calculate start/end time
    Hooks->>API: GET /api/statistics/:entity_id?start_time=...&end_time=...
    API->>DB: getStatistics(entityId, startTime, endTime)
    DB->>DB: SELECT * FROM energy_statistics<br/>WHERE entity_id = ? AND start_time BETWEEN ...
    DB-->>API: Rows
    API-->>Hooks: {data: [...]}
    Hooks-->>UI: statistics array

    UI->>Hooks: useDailySummary(entityId, timeRange)
    Hooks->>API: GET /api/statistics/:entity_id/daily
    API->>DB: getDailySummary(entityId, startTime, endTime)
    DB->>DB: SELECT<br/>  date(start_time) as date,<br/>  SUM(...) as total,<br/>  AVG(mean) as avg_power,<br/>  MAX(max) as peak<br/>GROUP BY date(start_time)
    DB-->>API: Aggregated rows
    API-->>Hooks: {data: [...]}
    Hooks-->>UI: dailySummary array

    UI->>UI: Render StatsCard components
    UI->>UI: Calculate totalConsumption, avgDaily, peakUsage
    UI->>UI: Render EnergyChart (bar + line)
```

**Characteristics:**
- Reactive to user input
- Queries refreshed every 60s (polling)
- Manual sync required for new data

#### Spec Flow with Real-time Updates

```mermaid
sequenceDiagram
    participant UI as Dashboard Page
    participant Hooks as useEnergy.js
    participant API as API Routes
    participant QuestDB as QuestDB

    Note over UI: User selects entity + time range

    UI->>Hooks: useStatistics(entityId, timeRange)
    Hooks->>API: GET /api/statistics/:entity_id
    API->>QuestDB: SELECT * FROM energy_statistics<br/>WHERE entity_id = '...' AND period = 'hour'<br/>AND timestamp BETWEEN ...
    QuestDB-->>API: Rows (time-partitioned)
    API-->>Hooks: {data: [...]}

    loop Every 60s (polling)
        Hooks->>API: Refetch statistics
        API->>QuestDB: Query latest data
        QuestDB-->>API: Updated rows
        API-->>Hooks: Fresh data
        Hooks->>UI: Auto-update charts
    end

    Note over UI: User clicks "View Raw Readings"
    UI->>Hooks: useReadings(entityId, since)
    Hooks->>API: GET /api/readings/:entity_id?since=...
    API->>QuestDB: SELECT * FROM energy_readings<br/>WHERE entity_id = '...'<br/>AND timestamp > '...'<br/>ORDER BY timestamp DESC<br/>LIMIT 1000
    QuestDB-->>API: Raw event rows
    API-->>Hooks: {readings: [...]}
    Hooks->>UI: Render high-resolution chart
```

**Improvements:**
- Real-time data automatically appears
- Access to raw readings (sub-hourly)
- Time-series optimized queries

---

## Component Interaction Map

### Frontend Component Hierarchy

```
App (main.jsx)
├── QueryClientProvider
│   └── RouterProvider
│       └── RootLayout (__root.jsx)
│           ├── Header (Navigation + HA Status)
│           └── Outlet
│               ├── DashboardPage (index.jsx)
│               │   ├── EntitySelector
│               │   ├── TimeRangeSelect
│               │   ├── SyncButton
│               │   ├── StatsCard × 4
│               │   └── EnergyChart × 2
│               ├── HistoryPage (history.jsx)
│               └── SettingsPage (settings.jsx)
│                   ├── Connection Status Card
│                   ├── HA Config Form
│                   └── Entity Discovery Card
```

### Hook Dependencies

```
useEnergy.js
├── useStatus()
│   └── fetchStatus() → GET /api/status (MISSING)
├── useEntities()
│   └── fetchEntities() → GET /api/entities
├── useStatistics(entityId, timeRange)
│   └── fetchStatistics() → GET /api/statistics/:entity_id
├── useDailySummary(entityId, timeRange)
│   └── fetchDailySummary() → GET /api/statistics/:entity_id/daily
└── useSyncData()
    └── syncData() → POST /api/statistics/sync
```

### API Plugin Dependency Graph

#### Current

```
fastify
├── database.js (SQLite)
└── home-assistant.js
    └── database.js (optional, used in routes)
```

**Issues:**
- No explicit dependency declaration
- HA plugin doesn't depend on database
- Routes manually access both plugins

#### Spec Required

```
fastify
├── mongodb.js
├── questdb.js
├── home-assistant.js
│   └── mongodb.js (for settings)
└── event-recorder.js
    ├── home-assistant.js
    ├── mongodb.js
    └── questdb.js
```

**Benefits:**
- Clear dependency chain
- Proper plugin loading order
- Fail-fast if dependencies missing

---

## State Management Flow

### Frontend State (React Query)

```mermaid
stateDiagram-v2
    [*] --> Idle: Component mount

    Idle --> Fetching: Query triggered
    Fetching --> Success: Data received
    Fetching --> Error: Request failed

    Success --> Stale: staleTime expired (30s)
    Success --> Refetching: refetchInterval (60s)

    Stale --> Refetching: User interaction
    Refetching --> Success: Fresh data
    Refetching --> Error: Request failed

    Error --> Idle: Retry after delay

    Success --> Invalidated: Mutation success
    Invalidated --> Refetching: Auto-refetch
```

**Key Behaviors:**
- `staleTime: 30000ms`: Data considered fresh for 30s
- `refetchInterval: 60000ms`: Auto-refetch statistics every 60s
- `refetchOnWindowFocus: true`: Refetch when tab becomes active
- Mutations invalidate related queries

### Backend State (Database)

#### Current (SQLite)

```
energy_statistics
├── entity_id (indexed)
├── start_time (indexed)
└── UNIQUE(entity_id, start_time, period)

entities
└── entity_id (primary key)

sync_log
└── entity_id (indexed)
```

**Issues:**
- No subscription state tracking
- No settings storage
- No entity tracking preferences

#### Spec (MongoDB + QuestDB)

**MongoDB Collections:**
```
settings
├── _id: "ha_url"
├── _id: "ha_token"
└── ...

entities
├── _id: entity_id
├── isTracked: boolean
└── isActive: boolean

subscriptionState
└── _id: "subscription" (singleton)
    ├── subscriptionId
    ├── lastEventAt
    └── status

syncLog
└── entityId (indexed)
```

**QuestDB Tables:**
```
energy_readings (partitioned by DAY)
├── entity_id (SYMBOL, indexed)
├── state (DOUBLE)
└── timestamp (TIMESTAMP, designated)

energy_statistics (partitioned by MONTH)
├── entity_id (SYMBOL, indexed)
├── period (SYMBOL)
└── timestamp (TIMESTAMP, designated)
```

---

## Error Handling & Recovery Flows

### Current Error Handling

```mermaid
flowchart TD
    Request[API Request] --> Try{Try}
    Try -->|Success| Return[Return Data]
    Try -->|Error| Log[fastify.log.error]
    Log --> Reply[reply.code(500)]
    Reply --> UI[UI receives error]
    UI --> Fallback{Has fallback?}
    Fallback -->|Yes| Cache[Try /api/entities/cached]
    Fallback -->|No| ShowError[Display error message]
```

**Limitations:**
- Generic 500 errors
- No retry logic in backend
- Frontend relies on React Query retry (3 attempts)

### Spec Error Handling & Recovery

```mermaid
flowchart TD
    WS_Error[WebSocket Disconnected] --> Detect{Heartbeat Detects}
    Detect -->|lastEventAt > 2 min| Reconnect[Force Reconnect]
    Reconnect --> Backfill[Trigger Backfill]
    Backfill --> Gap[Calculate Gap Period]
    Gap --> Fetch[Fetch Missing Stats from HA]
    Fetch --> Insert[Insert to QuestDB]
    Insert --> Log[Log Reconciliation]

    Startup[Server Restart] --> Check[Check subscriptionState]
    Check --> LastEvent{lastEventAt?}
    LastEvent -->|Exists| CalcGap[Calculate Gap]
    LastEvent -->|Null| Default[Default to 7 days]
    CalcGap --> Fetch
    Default --> Fetch
```

**Improvements:**
- Automatic gap detection
- Self-healing reconnection
- Startup recovery logic

---

## Performance Characteristics

### Current Implementation

| Operation | Method | Performance |
|-----------|--------|-------------|
| Entity listing | SQLite SELECT | ~10ms (few entities) |
| Statistics query | SQLite SELECT with date filter | ~50ms (7 days hourly) |
| Daily aggregation | SQLite GROUP BY | ~100ms (30 days) |
| Sync operation | HA API + batch INSERT | ~2-5s (depends on period) |
| Manual sync | Synchronous, blocks UI | User waits 2-5s |

**Bottlenecks:**
- SQLite GROUP BY on large datasets
- No connection pooling (single SQLite connection)
- Synchronous sync blocks response

### Spec Performance Targets

| Operation | Method | Target Performance |
|-----------|--------|-------------------|
| Entity listing | MongoDB query | <10ms |
| Statistics query | QuestDB SAMPLE BY | <50ms (millions of rows) |
| Raw readings | QuestDB time-partitioned query | <100ms (1 million rows) |
| Event ingestion | QuestDB ILP | <1ms per event |
| Sync operation | Background task | Non-blocking, async |

**Optimizations:**
- QuestDB time-partitioned storage (auto-pruning)
- ILP batch writes (millions/sec throughput)
- MongoDB indexes on isTracked, entityId
- Async backfill (doesn't block user)

---

## Security & Data Privacy

### Current

- **HA Token**: Stored in `.env` file
- **Transport**: No HTTPS (local network only)
- **Database**: SQLite file (no access control)

### Spec

- **HA Token**: Stored in MongoDB (still plain text, but centralized)
- **Transport**: Can add Nginx with TLS termination
- **Database**: MongoDB + QuestDB can add authentication
- **Docker**: Isolated containers, network segmentation

**Recommendations:**
- Add MongoDB authentication in production
- Use Kubernetes secrets or Vault for tokens
- Enable QuestDB access control
- Add Nginx with TLS for external access

---

## Scalability Analysis

### Current Limits

| Metric | Current Limit | Reason |
|--------|--------------|--------|
| Entities tracked | ~50 | Manual sync becomes slow |
| Retention period | ~1 year | SQLite file size grows |
| Event ingestion rate | ~1 event/sec | Not designed for real-time |
| Concurrent users | ~5 | SQLite WAL mode, single process |

### Spec Scalability

| Metric | Spec Capacity | Reason |
|--------|--------------|--------|
| Entities tracked | 1000+ | MongoDB horizontal scaling |
| Retention period | 10+ years | QuestDB partitioned storage |
| Event ingestion rate | 10,000+ events/sec | ILP protocol |
| Concurrent users | 100+ | QuestDB read replicas |

---

## Monitoring & Observability

### Current

- **Logging**: Fastify console logs
- **Metrics**: None
- **Health checks**: Basic root route `/`

### Spec

**Proposed Additions:**
```javascript
// /api/status
{
  homeAssistant: {
    connected: true,
    lastEventAt: "2026-01-02T10:00:00Z",
    subscriptionId: 12345
  },
  databases: {
    mongodb: "connected",
    questdb: "connected"
  },
  eventRecorder: {
    status: "active",
    knownEntities: 15,
    eventsToday: 45231
  },
  sync: {
    lastReconciliation: "2026-01-02T09:00:00Z",
    nextScheduled: "2026-01-02T10:00:00Z"
  }
}
```

**Metrics to Track:**
- Events ingested per minute
- Query latency (p50, p95, p99)
- WebSocket connection uptime
- Gap detection occurrences

---

## Deployment Flow

### Current

```mermaid
flowchart LR
    Dev[Local Development] -->|npm run dev| Watt[Wattpm Dev Server]
    Watt --> API[API: localhost:3042/api]
    Watt --> Frontend[Frontend: localhost:3042/dashboard]

    Production[Production] -->|npm run build| Build[Vite Build]
    Build --> Start[npm start]
    Start --> Watt2[Wattpm Runtime]
```

### Spec (Docker)

```mermaid
flowchart TB
    Source[Source Code] -->|docker build| Image[Docker Image]
    Image -->|docker-compose up| Stack[Docker Stack]

    Stack --> App[App Container]
    Stack --> MongoDB[MongoDB Container]
    Stack --> QuestDB[QuestDB Container]
    Stack --> Nginx[Nginx Container]

    App --> Volumes[Persistent Volumes]
    MongoDB --> Volumes
    QuestDB --> Volumes
```

---

## Integration Points

### Home Assistant Integration

**Methods:**
1. **WebSocket API** (Current + Spec):
   - `get_states`: Fetch all entity states
   - `recorder/statistics_during_period`: Historical data
   - `energy/get_prefs`: Energy dashboard config
   - `subscribe_events`: Real-time state changes (SPEC)

2. **HTTP API** (Alternative, not used):
   - REST endpoints for entities/states
   - Less efficient than WebSocket

### Frontend ↔ API Contract

**Data Formats:**
```typescript
// Entity
{
  entity_id: string
  friendly_name: string
  state: string | number
  device_class?: string
  unit_of_measurement?: string
}

// Statistic
{
  entity_id: string
  start_time: ISO8601
  end_time?: ISO8601
  state: number
  sum: number
  mean: number
  min: number
  max: number
  period: 'hour' | 'day' | 'month'
}

// Daily Summary
{
  date: ISO8601
  total: number
  avg_power: number
  peak: number
  readings: number
}
```

---

## Conclusion

The current implementation provides a **functional manual sync workflow** with a polished frontend, but lacks the **real-time event-driven architecture** required by the specification. The primary flows missing are:

1. **Real-time Event Ingestion**: WebSocket subscription to `state_changed` events
2. **Reconciliation Logic**: Heartbeat monitoring and gap backfilling
3. **Dual-Database Operations**: MongoDB for state, QuestDB for metrics
4. **Settings Persistence**: Dynamic HA configuration via UI

**Flow Completeness:**
- ✅ Manual sync: 100%
- ⚠️ Entity discovery: 70% (no tracking preferences)
- ❌ Real-time sync: 0%
- ❌ Reconciliation: 0%
- ❌ Settings management: 0%
- ❌ Docker deployment: 0%

**Next Steps:**
1. Implement dual-database plugins (MongoDB + QuestDB)
2. Build event recorder plugin with subscription logic
3. Add settings routes and persistence
4. Create Docker deployment manifests
