# Implementation Plan: TEK-40 - P3.2 Statistics API Routes

**Date:** 2026-01-02
**Issue:** TEK-40 - Data sync and aggregation endpoints
**Priority:** High (P3)
**Dependencies:** TEK-35 (MongoDB), TEK-37 (QuestDB), TEK-36 (HA Plugin)

---

## Executive Summary

This plan details the complete implementation of the Statistics API Routes (`web/api/routes/statistics.js`) to migrate from the current SQLite-based manual sync system to a dual-database architecture (MongoDB + QuestDB) with real-time event-driven sync capabilities and advanced time-series aggregations.

### Current State Assessment

**Existing Implementation:**
- ✅ File exists: `web/api/routes/statistics.js` (269 lines)
- ✅ Basic endpoints: GET statistics, daily/monthly summaries, manual sync, compare
- ✅ SQLite database plugin: `web/api/plugins/database.js` (182 lines)
- ✅ Home Assistant plugin: `web/api/plugins/home-assistant.js` (150 lines)
- ❌ No MongoDB plugin (required for application state)
- ❌ No QuestDB plugin (required for time-series data)
- ❌ No real-time event sync
- ❌ No reconciliation logic
- ❌ No sync status tracking

**Critical Gaps:**
1. Database architecture: Using SQLite instead of MongoDB + QuestDB
2. Data sync: Manual only, no real-time event subscription
3. Aggregations: Basic SQL GROUP BY instead of QuestDB SAMPLE BY
4. State tracking: No subscription state, sync logs in SQLite
5. Performance: Not optimized for high-volume time-series ingestion

---

## Phase 1: Database Infrastructure Migration

### 1.1 MongoDB Plugin Implementation

**File:** `web/api/plugins/mongodb.js` (NEW FILE)

**Purpose:** Replace SQLite for application state (settings, entities, subscription tracking, sync logs)

**Implementation Details:**

```javascript
// Key collections:
// - settings: key-value config store
// - entities: discovered HA entities with tracking state
// - subscriptionState: WebSocket subscription lifecycle (singleton)
// - syncLog: history of sync operations

// Required methods:
// - getSetting(key), setSetting(key, value), getAllSettings()
// - upsertEntity(entity), getEntities(trackedOnly), setEntityTracked(id, bool)
// - getSubscriptionState(), updateSubscriptionState(update)
// - logSync(entry), getRecentSyncs(entityId, limit)
```

**Dependencies:**
- Package: `mongodb` (Apache 2.0 license)
- Environment: `MONGODB_URI=mongodb://localhost:27017/energy_dashboard`

**Indexes:**
```javascript
entities.createIndex({ isTracked: 1, isActive: 1 })
syncLog.createIndex({ entityId: 1, createdAt: -1 })
```

**Migration Strategy:**
1. Create plugin file with full CRUD operations
2. Add to `web/api/package.json` dependencies
3. Register in `web/api/platformatic.json` plugins array
4. Create data migration script from SQLite to MongoDB for existing entities
5. Update all routes to use `fastify.mongo` instead of `fastify.db`

**Schema Details:**

**settings collection:**
```javascript
{
  _id: "ha_url",
  value: "homeassistant.local:8123",
  updatedAt: ISODate()
}
```

**entities collection:**
```javascript
{
  _id: "sensor.home_power", // entity_id as primary key
  friendlyName: "Home Power Consumption",
  deviceClass: "power",
  unitOfMeasurement: "W",
  isTracked: true,
  isActive: true,
  discoveredAt: ISODate(),
  updatedAt: ISODate(),
  attributes: {
    stateClass: "measurement",
    icon: "mdi:flash"
  }
}
```

**subscriptionState collection:**
```javascript
{
  _id: "subscription", // singleton
  subscriptionId: 12345,
  subscribedAt: ISODate(),
  lastEventAt: ISODate(),
  status: "active", // active | disconnected | error
  errorMessage: null,
  reconnectCount: 0
}
```

**syncLog collection:**
```javascript
{
  _id: ObjectId(),
  entityId: "sensor.home_power",
  syncType: "backfill", // backfill | realtime | manual
  startTime: ISODate(),
  endTime: ISODate(),
  recordsSynced: 24,
  status: "success", // success | partial | failed
  errorMessage: null,
  createdAt: ISODate()
}
```

**Files to Create:**
- `web/api/plugins/mongodb.js` (~180 lines based on spec)

**Files to Update:**
- `web/api/package.json`: Add `"mongodb": "^6.14.0"`
- `web/api/platformatic.json`: Add to plugins array

---

### 1.2 QuestDB Plugin Implementation

**File:** `web/api/plugins/questdb.js` (NEW FILE)

**Purpose:** Replace SQLite for time-series data with high-performance ILP ingestion

**Implementation Details:**

```javascript
// Tables (created via QuestDB):
// - energy_readings: raw state_changed events (PARTITION BY DAY)
// - energy_statistics: hourly aggregated stats (PARTITION BY MONTH)

// ILP writes (millions/sec throughput):
// - writeReadings(readings): batch write to energy_readings
// - writeStats(stats): batch write to energy_statistics

// HTTP queries (time-series optimized):
// - getReadings(entityId, start, end, limit)
// - getStatistics(entityId, start, end, period)
// - getDailySummary(entityId, start, end) - uses SAMPLE BY
// - getMonthlySummary(entityId, start, end) - uses SAMPLE BY
// - getLatestSyncTime(entityId)
```

**Dependencies:**
- Package: `@questdb/nodejs-client` (Apache 2.0 license)
- Environment:
  - `QUESTDB_HOST=localhost`
  - `QUESTDB_ILP_PORT=9009`
  - `QUESTDB_HTTP_PORT=9000`

**QuestDB Table Schemas:**

```sql
-- Raw readings from state_changed events
CREATE TABLE energy_readings (
  entity_id SYMBOL,           -- Indexed for fast filtering
  state DOUBLE,               -- Current sensor value
  previous_state DOUBLE,      -- Previous value (delta calculations)
  attributes STRING,          -- JSON string of HA attributes
  timestamp TIMESTAMP         -- Designated timestamp column
) TIMESTAMP(timestamp) PARTITION BY DAY;

-- Aggregated statistics (hourly from HA recorder)
CREATE TABLE energy_statistics (
  entity_id SYMBOL,
  period SYMBOL,              -- 'hour', 'day', 'month'
  state DOUBLE,               -- End-of-period state
  sum DOUBLE,                 -- Cumulative sum
  mean DOUBLE,                -- Average over period
  min DOUBLE,                 -- Minimum value
  max DOUBLE,                 -- Maximum value
  timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY MONTH;
```

**Migration Strategy:**
1. Create QuestDB plugin with ILP sender + HTTP client
2. Add to package.json dependencies
3. Register in platformatic.json (after mongodb)
4. Write migration script to copy energy_statistics from SQLite to QuestDB
5. Update statistics.js routes to query QuestDB instead of SQLite

**Performance Considerations:**
- ILP writes: <1ms per event (batched)
- Queries with SAMPLE BY: <50ms for millions of rows
- Partitioning: Auto-prunes old partitions based on retention policy
- Symbols: entity_id stored as symbol for efficient filtering

**Files to Create:**
- `web/api/plugins/questdb.js` (~180 lines)
- `scripts/migrate-sqlite-to-questdb.js` (migration utility)

**Files to Update:**
- `web/api/package.json`: Add `"@questdb/nodejs-client": "^4.2.2"`
- `web/api/platformatic.json`: Add to plugins array with dependency on mongodb

---

### 1.3 Database Plugin Dependency Chain

**Plugin Load Order (Critical):**

```
1. mongodb.js       (no dependencies)
2. questdb.js       (no dependencies)
3. home-assistant.js (depends on: mongodb)
4. event-recorder.js (depends on: home-assistant, mongodb, questdb)
5. routes/*         (depends on all above)
```

**Update `web/api/platformatic.json`:**

```json
{
  "$schema": "https://schemas.platformatic.dev/@platformatic/service/3.0.0.json",
  "service": {
    "openapi": true
  },
  "plugins": {
    "paths": [
      {
        "path": "./plugins/mongodb.js",
        "encapsulate": false
      },
      {
        "path": "./plugins/questdb.js",
        "encapsulate": false
      },
      {
        "path": "./plugins/home-assistant.js",
        "encapsulate": false,
        "options": {
          "dependencies": ["mongodb"]
        }
      },
      {
        "path": "./plugins/event-recorder.js",
        "encapsulate": false,
        "options": {
          "dependencies": ["home-assistant", "mongodb", "questdb"]
        }
      }
    ]
  }
}
```

**Files to Update:**
- `web/api/platformatic.json`: Complete rewrite of plugins section

---

## Phase 2: Statistics Routes Refactoring

### 2.1 Update Existing Endpoints to Use QuestDB

**File:** `web/api/routes/statistics.js` (MODIFY EXISTING)

**Current Endpoints to Refactor:**

#### 2.1.1 POST /api/statistics/sync (Manual Sync)

**Current Implementation:**
- Uses `fastify.ha.getStatistics()` to fetch from HA
- Writes to SQLite via `fastify.db.insertStatsBatch()`
- Synchronous blocking operation

**New Implementation:**
- Keep HA fetch logic (no change)
- Replace `fastify.db.insertStatsBatch()` → `fastify.questdb.writeStats()`
- Add sync logging to MongoDB: `fastify.mongo.logSync()`
- Make async/non-blocking: return immediately, sync in background

**Code Changes:**

```javascript
// BEFORE (lines 92-93):
if (records.length > 0) {
  fastify.db.insertStatsBatch(records)
}

// AFTER:
if (records.length > 0) {
  await fastify.questdb.writeStats(records)

  // Log sync to MongoDB
  await fastify.mongo.logSync({
    entityId: null, // bulk sync
    syncType: 'manual',
    startTime,
    endTime,
    recordsSynced: totalRecords,
    status: 'success'
  })
}
```

**Response Schema Update:**

```javascript
// Add sync_id for tracking
return {
  success: true,
  sync_id: ObjectId(), // from MongoDB syncLog
  entities_synced: Object.keys(stats).length,
  records_synced: totalRecords,
  period,
  time_range: { start: startTime, end: endTime }
}
```

---

#### 2.1.2 GET /api/statistics/:entity_id

**Current Implementation:**
- Uses SQLite: `fastify.db.getStatistics()`
- Basic SELECT with time range filter

**New Implementation:**
- Use QuestDB: `fastify.questdb.getStatistics()`
- Add period parameter support
- Add format parameter (chart vs raw)

**Code Changes:**

```javascript
// BEFORE (line 135):
const stats = fastify.db.getStatistics(entity_id, startTime, endTime)

// AFTER:
const { period = 'hour', format = 'raw' } = request.query
const result = await fastify.questdb.getStatistics(
  entity_id,
  startTime,
  endTime,
  period
)

const stats = result.dataset || []

// Transform for chart format if requested
if (format === 'chart') {
  stats = stats.map(row => ({
    timestamp: row[0], // QuestDB returns arrays
    state: row[1],
    sum: row[2],
    mean: row[3],
    min: row[4],
    max: row[5]
  }))
}
```

**Query String Schema Update:**

```javascript
querystring: {
  type: 'object',
  properties: {
    start_time: { type: 'string', format: 'date-time' },
    end_time: { type: 'string', format: 'date-time' },
    period: {
      type: 'string',
      enum: ['hour', 'day', 'month'],
      default: 'hour'
    },
    format: {
      type: 'string',
      enum: ['raw', 'chart'],
      default: 'raw'
    }
  }
}
```

**Response Schema:**

```javascript
return {
  entity_id,
  period,
  time_range: { start: startTime, end: endTime },
  count: stats.length,
  data: stats,
  meta: {
    start: startTime,
    end: endTime,
    count: stats.length
  }
}
```

---

#### 2.1.3 GET /api/statistics/:entity_id/daily

**Current Implementation:**
- Uses SQLite GROUP BY: `fastify.db.getDailySummary()`

**New Implementation:**
- Use QuestDB SAMPLE BY: `fastify.questdb.getDailySummary()`
- Significantly faster for large datasets

**Code Changes:**

```javascript
// BEFORE (line 172):
const summary = fastify.db.getDailySummary(entity_id, startTime, endTime)

// AFTER:
const result = await fastify.questdb.getDailySummary(
  entity_id,
  startTime,
  endTime
)

const summary = result.dataset.map(row => ({
  date: row[0],
  total: row[1],
  avg_power: row[2],
  peak: row[3],
  readings: row[4]
}))
```

**No schema changes needed.**

---

#### 2.1.4 GET /api/statistics/:entity_id/monthly

**Current Implementation:**
- Uses SQLite GROUP BY: `fastify.db.getMonthlySummary()`

**New Implementation:**
- Use QuestDB SAMPLE BY: `fastify.questdb.getMonthlySummary()`

**Code Changes:**

```javascript
// BEFORE (line 209):
const summary = fastify.db.getMonthlySummary(entity_id, startTime, endTime)

// AFTER:
const result = await fastify.questdb.getMonthlySummary(
  entity_id,
  startTime,
  endTime
)

const summary = result.dataset.map(row => ({
  month: row[0],
  total: row[1],
  avg_power: row[2],
  peak: row[3],
  readings: row[4]
}))
```

**No schema changes needed.**

---

#### 2.1.5 POST /api/statistics/compare

**Current Implementation:**
- Iterates entities, calls SQLite for each

**New Implementation:**
- Keep iteration logic
- Replace DB calls with QuestDB queries
- Add parallel query execution for performance

**Code Changes:**

```javascript
// BEFORE (lines 252-258):
for (const entityId of entity_ids) {
  if (aggregation === 'monthly') {
    results[entityId] = fastify.db.getMonthlySummary(entityId, startTime, endTime)
  } else if (aggregation === 'daily') {
    results[entityId] = fastify.db.getDailySummary(entityId, startTime, endTime)
  } else {
    results[entityId] = fastify.db.getStatistics(entityId, startTime, endTime)
  }
}

// AFTER (parallel execution):
const queries = entity_ids.map(async entityId => {
  let result
  if (aggregation === 'monthly') {
    result = await fastify.questdb.getMonthlySummary(entityId, startTime, endTime)
  } else if (aggregation === 'daily') {
    result = await fastify.questdb.getDailySummary(entityId, startTime, endTime)
  } else {
    result = await fastify.questdb.getStatistics(entityId, startTime, endTime, 'hour')
  }
  return [entityId, result.dataset || []]
})

const resultsArray = await Promise.all(queries)
const results = Object.fromEntries(resultsArray)
```

**Performance Improvement:** Parallel queries reduce total time from O(n) to O(1) for multiple entities.

---

### 2.2 Add New Endpoint: GET /api/statistics/:entity_id/summary

**Purpose:** Aggregated summary with total consumption, average, peak, and trend comparison

**Implementation:**

```javascript
fastify.get('/api/statistics/:entity_id/summary', {
  schema: {
    description: 'Get aggregated summary for an entity',
    tags: ['statistics'],
    params: {
      type: 'object',
      properties: {
        entity_id: { type: 'string' }
      },
      required: ['entity_id']
    },
    querystring: {
      type: 'object',
      properties: {
        start_time: { type: 'string', format: 'date-time' },
        end_time: { type: 'string', format: 'date-time' }
      }
    }
  }
}, async (request, reply) => {
  const { entity_id } = request.params
  const { start_time, end_time } = request.query

  const endTime = end_time || new Date().toISOString()
  const startTime = start_time || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString()

  // Query aggregated stats from QuestDB
  const sql = `
    SELECT
      sum(sum) as total_consumption,
      avg(mean) as average_power,
      max(max) as peak_power,
      min(min) as min_power,
      count() as data_points
    FROM energy_statistics
    WHERE entity_id = '${entity_id}'
    AND period = 'hour'
    AND timestamp BETWEEN '${startTime}' AND '${endTime}'
  `

  const result = await fastify.questdb.query(sql)
  const row = result.dataset?.[0] || [0, 0, 0, 0, 0]

  // Calculate trend comparison (current period vs previous period)
  const periodLength = new Date(endTime) - new Date(startTime)
  const prevStartTime = new Date(new Date(startTime) - periodLength).toISOString()
  const prevEndTime = startTime

  const trendSql = `
    SELECT sum(sum) as prev_total
    FROM energy_statistics
    WHERE entity_id = '${entity_id}'
    AND period = 'hour'
    AND timestamp BETWEEN '${prevStartTime}' AND '${prevEndTime}'
  `

  const trendResult = await fastify.questdb.query(trendSql)
  const prevTotal = trendResult.dataset?.[0]?.[0] || 0

  const currentTotal = row[0]
  const trend = prevTotal > 0
    ? ((currentTotal - prevTotal) / prevTotal) * 100
    : 0

  return {
    entity_id,
    time_range: { start: startTime, end: endTime },
    summary: {
      total_consumption: currentTotal,
      average_power: row[1],
      peak_power: row[2],
      min_power: row[3],
      data_points: row[4]
    },
    trend: {
      percentage_change: Math.round(trend * 100) / 100,
      direction: trend > 0 ? 'increase' : trend < 0 ? 'decrease' : 'stable',
      comparison_period: {
        start: prevStartTime,
        end: prevEndTime
      }
    }
  }
})
```

**Response Example:**

```json
{
  "entity_id": "sensor.home_power",
  "time_range": {
    "start": "2025-12-01T00:00:00Z",
    "end": "2026-01-01T00:00:00Z"
  },
  "summary": {
    "total_consumption": 1234.5,
    "average_power": 1200,
    "peak_power": 1500,
    "min_power": 800,
    "data_points": 720
  },
  "trend": {
    "percentage_change": 15.5,
    "direction": "increase",
    "comparison_period": {
      "start": "2025-11-01T00:00:00Z",
      "end": "2025-12-01T00:00:00Z"
    }
  }
}
```

**Files to Modify:**
- `web/api/routes/statistics.js`: Add new endpoint (lines 218+)

---

### 2.3 Add New Endpoint: GET /api/statistics/sync-status

**Purpose:** Get last sync timestamps per entity

**Implementation:**

```javascript
fastify.get('/api/statistics/sync-status', {
  schema: {
    description: 'Get last sync timestamps per entity',
    tags: ['statistics']
  }
}, async (request, reply) => {
  // Get all tracked entities from MongoDB
  const entities = await fastify.mongo.getEntities(true) // tracked only

  // Query latest sync time for each from QuestDB
  const statusPromises = entities.map(async entity => {
    const latestTime = await fastify.questdb.getLatestSyncTime(entity._id)
    const recentSyncs = await fastify.mongo.getRecentSyncs(entity._id, 5)

    // Count records in last 24h from QuestDB
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
    const now = new Date().toISOString()

    const countSql = `
      SELECT count() as record_count
      FROM energy_statistics
      WHERE entity_id = '${entity._id}'
      AND timestamp BETWEEN '${yesterday}' AND '${now}'
    `
    const countResult = await fastify.questdb.query(countSql)
    const recordCount = countResult.dataset?.[0]?.[0] || 0

    return {
      entity_id: entity._id,
      friendly_name: entity.friendlyName,
      last_sync: latestTime,
      records_count_24h: recordCount,
      recent_syncs: recentSyncs.map(s => ({
        type: s.syncType,
        timestamp: s.createdAt,
        records: s.recordsSynced,
        status: s.status
      }))
    }
  })

  const statuses = await Promise.all(statusPromises)

  return {
    entities: statuses,
    total_tracked: statuses.length
  }
})
```

**Response Example:**

```json
{
  "entities": [
    {
      "entity_id": "sensor.home_power",
      "friendly_name": "Home Power Consumption",
      "last_sync": "2026-01-02T10:00:00Z",
      "records_count_24h": 24,
      "recent_syncs": [
        {
          "type": "manual",
          "timestamp": "2026-01-02T10:00:00Z",
          "records": 24,
          "status": "success"
        }
      ]
    }
  ],
  "total_tracked": 1
}
```

**Files to Modify:**
- `web/api/routes/statistics.js`: Add new endpoint (lines 270+)

---

## Summary of Files

### New Files (2 total)

| File | Lines | Purpose |
|------|-------|---------|
| `web/api/plugins/mongodb.js` | ~180 | MongoDB plugin for application state |
| `web/api/plugins/questdb.js` | ~180 | QuestDB plugin for time-series data |

**Total New Lines:** ~360

---

### Modified Files (3 total)

| File | Changes | Lines Added |
|------|---------|-------------|
| `web/api/routes/statistics.js` | Refactor all endpoints to use QuestDB, add summary + sync-status endpoints | ~150 |
| `web/api/package.json` | Add mongodb, @questdb/nodejs-client dependencies | ~2 |
| `web/api/platformatic.json` | Update plugins array with dependency chain | ~30 |

**Total Modified Lines:** ~182

---

## Implementation Timeline

**Total Estimated Effort:** 1-2 weeks (1 developer)

### Week 1: Database Infrastructure
- **Day 1-2:** Implement MongoDB plugin + tests
- **Day 3-4:** Implement QuestDB plugin + tests
- **Day 5:** Write migration scripts
- **Day 6-7:** Test migrations, verify data integrity

### Week 2: Statistics Routes Refactoring
- **Day 1-2:** Refactor existing statistics routes to use QuestDB
- **Day 3:** Add new summary and sync-status endpoints
- **Day 4-5:** Full integration testing
- **Day 6-7:** Documentation and final review

---

## Success Criteria

### Functional Requirements
- ✅ MongoDB plugin implemented and tested
- ✅ QuestDB plugin implemented and tested
- ✅ All existing endpoints refactored to use QuestDB
- ✅ Two new endpoints implemented (summary, sync-status)
- ✅ Data migration scripts working

### Non-Functional Requirements
- ✅ Query latency <100ms for 1M rows (QuestDB SAMPLE BY)
- ✅ ILP write latency <10ms for 10k events
- ✅ Zero data loss during migration
- ✅ Test coverage >80%

---

## Complete Plan Location:
The plan has been saved to:
`/Users/eric/Dev/energy-tracker/claude-instance/PLAN.md`
