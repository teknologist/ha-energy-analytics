# API Plugins

This directory contains Fastify plugins for the Energy Dashboard API service.

## MongoDB Plugin (`mongodb.js`)

MongoDB plugin for managing application state and metadata. Handles all non-time-series data.

### Features

- **Settings Management**: Key-value configuration storage
- **Entity Tracking**: Cache Home Assistant entities and track which ones are monitored
- **Subscription State**: Track real-time WebSocket subscriptions and event counts
- **Sync Logging**: Record manual sync operations from Home Assistant recorder database
- **Automatic Indexing**: Optimized indexes for common query patterns
- **Health Checks**: Monitor database connectivity

### Collections

#### settings
Key-value configuration storage:
- `key` (string, unique)
- `value` (any type)
- `updatedAt` (Date)

#### entities
Cached Home Assistant entities:
- `entityId` (string, unique) - e.g., "sensor.home_energy"
- `friendlyName` (string) - Display name
- `deviceClass` (string) - e.g., "energy", "power"
- `unitOfMeasurement` (string) - e.g., "kWh", "W"
- `state` (string) - Current state value
- `isTracked` (boolean) - Whether this entity is monitored
- `lastSeen` (Date) - Last time entity was updated
- `createdAt` (Date)
- `updatedAt` (Date)

#### subscriptionState
Real-time subscription tracking:
- `entityId` (string, unique)
- `subscriptionId` (string) - WebSocket subscription ID
- `isActive` (boolean)
- `lastEventAt` (Date) - Last time an event was received
- `eventCount` (number) - Total events received
- `createdAt` (Date)
- `updatedAt` (Date)

#### syncLog
Manual sync operation history:
- `entityIds` (array of strings)
- `recordsSynced` (number)
- `startTime` (Date) - Sync time range start
- `endTime` (Date) - Sync time range end
- `period` (string) - "5minute", "hour", "day", etc.
- `duration` (number) - Sync duration in ms
- `success` (boolean)
- `error` (string, optional)
- `createdAt` (Date)

### API Reference

#### Health Check

**`healthCheck()`**
```javascript
const health = await fastify.mongo.healthCheck()
// Returns: { healthy: true, timestamp: Date }
```

#### Settings CRUD

**`getSetting(key)`**
```javascript
const value = await fastify.mongo.getSetting('refresh_interval')
// Returns: value or undefined
```

**`setSetting(key, value)`**
```javascript
await fastify.mongo.setSetting('refresh_interval', 300)
// Returns: { key, value }
```

**`getAllSettings()`**
```javascript
const settings = await fastify.mongo.getAllSettings()
// Returns: { key1: value1, key2: value2, ... }
```

**`deleteSetting(key)`**
```javascript
const deleted = await fastify.mongo.deleteSetting('old_setting')
// Returns: true if deleted, false if not found
```

#### Entity Management

**`upsertEntity(entity)`**
```javascript
await fastify.mongo.upsertEntity({
  entity_id: 'sensor.home_energy',
  friendly_name: 'Home Energy',
  device_class: 'energy',
  unit_of_measurement: 'kWh',
  state: '123.45',
  isTracked: true
})
// Returns: entity document
```

**`getEntities(filter)`**
```javascript
// Get all tracked entities
const tracked = await fastify.mongo.getEntities({ isTracked: true })

// Filter by device class
const energySensors = await fastify.mongo.getEntities({ deviceClass: 'energy' })

// Get all entities
const all = await fastify.mongo.getEntities()
```

**`getEntity(entityId)`**
```javascript
const entity = await fastify.mongo.getEntity('sensor.home_energy')
// Returns: entity document or null
```

**`setEntityTracked(entityId, isTracked)`**
```javascript
await fastify.mongo.setEntityTracked('sensor.home_energy', false)
// Returns: true if updated, false if not found
```

**`deleteEntity(entityId)`**
```javascript
await fastify.mongo.deleteEntity('sensor.old_sensor')
// Returns: true if deleted, false if not found
```

#### Subscription State

**`getSubscriptionState(entityId?)`**
```javascript
// Get specific entity's subscription state
const state = await fastify.mongo.getSubscriptionState('sensor.home_energy')

// Get all subscription states
const allStates = await fastify.mongo.getSubscriptionState()
```

**`updateSubscriptionState(entityId, state)`**
```javascript
await fastify.mongo.updateSubscriptionState('sensor.home_energy', {
  subscriptionId: 'sub_123',
  isActive: true,
  eventCount: 0
})
```

**`incrementEventCount(entityId)`**
```javascript
// Increments eventCount and updates lastEventAt
await fastify.mongo.incrementEventCount('sensor.home_energy')
```

**`clearSubscriptionState(entityId?)`**
```javascript
// Clear specific entity's subscription
await fastify.mongo.clearSubscriptionState('sensor.home_energy')

// Clear all subscriptions
const count = await fastify.mongo.clearSubscriptionState()
```

#### Sync Logging

**`logSync(syncData)`**
```javascript
await fastify.mongo.logSync({
  entityIds: ['sensor.energy1', 'sensor.energy2'],
  recordsSynced: 720,
  startTime: new Date('2024-01-01'),
  endTime: new Date('2024-01-02'),
  period: 'hour',
  duration: 1500,
  success: true
})
// Returns: sync log document with _id
```

**`getRecentSyncs(limit, filter)`**
```javascript
// Get last 20 syncs
const syncs = await fastify.mongo.getRecentSyncs(20)

// Filter by entity
const entitySyncs = await fastify.mongo.getRecentSyncs(10, {
  entityId: 'sensor.home_energy'
})

// Filter by success status
const failures = await fastify.mongo.getRecentSyncs(10, { success: false })
```

**`getLastSuccessfulSync(entityId?)`**
```javascript
// Get last successful sync for any entity
const lastSync = await fastify.mongo.getLastSuccessfulSync()

// Get last successful sync for specific entity
const entityLastSync = await fastify.mongo.getLastSuccessfulSync('sensor.home_energy')
```

**`getSyncStats()`**
```javascript
const stats = await fastify.mongo.getSyncStats()
// Returns:
// {
//   totalSyncs: 150,
//   successfulSyncs: 145,
//   failedSyncs: 5,
//   totalRecordsSynced: 108000,
//   lastSync: Date
// }
```

#### Database Statistics

**`getStats()`**
```javascript
const stats = await fastify.mongo.getStats()
// Returns:
// {
//   database: 'energy_dashboard',
//   collections: {
//     settings: 5,
//     entities: 12,
//     subscriptionState: 8,
//     syncLog: 150
//   },
//   dataSize: 1024000,
//   indexSize: 256000,
//   totalSize: 1280000
// }
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/energy_dashboard` |

### Running MongoDB Locally

**Docker:**
```bash
docker run -d -p 27017:27017 --name mongodb mongo:latest
```

**Docker Compose** (from project root):
```bash
docker-compose up mongodb
```

### Usage in Routes

```javascript
export default async function (fastify, opts) {
  // Cache entities from Home Assistant
  fastify.get('/api/entities', async (request, reply) => {
    const haEntities = await fastify.ha.getEnergyEntities()

    // Update cache
    for (const entity of haEntities) {
      await fastify.mongo.upsertEntity(entity)
    }

    return { entities: haEntities }
  })

  // Get cached entities
  fastify.get('/api/entities/cached', async (request, reply) => {
    const entities = await fastify.mongo.getEntities({ isTracked: true })
    return { entities }
  })

  // Track sync operation
  fastify.post('/api/sync', async (request, reply) => {
    const startTime = Date.now()

    try {
      const result = await performSync()

      await fastify.mongo.logSync({
        entityIds: result.entityIds,
        recordsSynced: result.count,
        duration: Date.now() - startTime,
        success: true
      })

      return result
    } catch (error) {
      await fastify.mongo.logSync({
        entityIds: [],
        recordsSynced: 0,
        duration: Date.now() - startTime,
        success: false,
        error: error.message
      })

      throw error
    }
  })
}
```

### Testing

Run the test suite:

```bash
# Make sure MongoDB is running
docker run -p 27017:27017 mongo:latest

# Run tests
cd web/api
npm test
```

Tests use a separate test database (`energy_dashboard_test`) that is automatically cleaned up.

### Indexes

The plugin automatically creates the following indexes on startup:

**settings:**
- `{ key: 1 }` (unique)

**entities:**
- `{ entityId: 1 }` (unique)
- `{ isTracked: 1, deviceClass: 1 }` (compound)
- `{ deviceClass: 1 }`
- `{ lastSeen: -1 }` (descending)

**subscriptionState:**
- `{ entityId: 1 }` (unique)
- `{ isActive: 1 }`
- `{ lastEventAt: -1 }` (descending)

**syncLog:**
- `{ createdAt: -1 }` (descending)
- `{ entityIds: 1, createdAt: -1 }` (compound)
- `{ success: 1, createdAt: -1 }` (compound)
- `{ period: 1, createdAt: -1 }` (compound)

### Troubleshooting

**Connection Issues:**
```bash
# Check MongoDB is running
mongosh --eval "db.adminCommand('ping')"

# Check connection string
echo $MONGODB_URI
```

**Slow Queries:**
```javascript
// Enable MongoDB query profiling
await fastify.mongo.db.setProfilingLevel(2)

// Check slow queries
const slowQueries = await fastify.mongo.db.system.profile.find().toArray()
```

**Index Issues:**
```javascript
// List all indexes
for (const [name, collection] of Object.entries(fastify.mongo.collections)) {
  const indexes = await collection.indexes()
  console.log(name, indexes)
}
```

---

## QuestDB Plugin (`questdb.js`)

High-performance time-series database plugin for storing and querying energy readings and statistics.

### Features

- **ILP Protocol**: High-throughput writes using QuestDB's InfluxDB Line Protocol
- **HTTP API**: Flexible SQL queries for time-series data
- **Automatic Reconnection**: Built-in retry logic for connection failures
- **Batch Operations**: Efficient batch writes for readings and statistics
- **Time-Series Queries**: Specialized methods for common query patterns
- **SAMPLE BY**: Leverages QuestDB's powerful aggregation capabilities

### Database Schema

#### energy_readings
Real-time readings from Home Assistant `state_changed` events:

```sql
CREATE TABLE IF NOT EXISTS energy_readings (
  entity_id SYMBOL,
  state DOUBLE,
  previous_state DOUBLE,
  attributes STRING,
  timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY DAY;
```

#### energy_statistics
Aggregated hourly/daily statistics:

```sql
CREATE TABLE IF NOT EXISTS energy_statistics (
  entity_id SYMBOL,
  period SYMBOL,
  state DOUBLE,
  sum DOUBLE,
  mean DOUBLE,
  min DOUBLE,
  max DOUBLE,
  timestamp TIMESTAMP
) TIMESTAMP(timestamp) PARTITION BY MONTH;
```

### API Reference

#### Write Operations

**`writeReadings(readings)`**
```javascript
await fastify.questdb.writeReadings([
  {
    entity_id: 'sensor.home_energy',
    state: 123.45,
    previous_state: 120.30,
    attributes: { unit: 'kWh' },
    timestamp: Date.now() * 1000000 // nanoseconds
  }
])
```

**`writeStats(stats)`**
```javascript
await fastify.questdb.writeStats([
  {
    entity_id: 'sensor.home_energy',
    period: 'hour',
    state: 155.8,
    sum: 5.3,
    mean: 152.65,
    min: 150.5,
    max: 155.8,
    timestamp: Date.now() * 1000000
  }
])
```

#### Read Operations

**`getReadings(entityId, startTime, endTime, limit)`**
```javascript
const readings = await fastify.questdb.getReadings(
  'sensor.home_energy',
  new Date('2024-01-01'),
  new Date('2024-01-02'),
  1000
)
```

**`getStatistics(entityId, startTime, endTime, period)`**
```javascript
const stats = await fastify.questdb.getStatistics(
  'sensor.home_energy',
  new Date('2024-01-01'),
  new Date('2024-01-31'),
  'hour' // optional: filter by period
)
```

**`getDailySummary(entityId, startTime, endTime)`**
```javascript
const daily = await fastify.questdb.getDailySummary(
  'sensor.home_energy',
  new Date('2024-01-01'),
  new Date('2024-01-31')
)
// Returns: entity_id, timestamp, total, avg_power, peak, readings
```

**`getMonthlySummary(entityId, startTime, endTime)`**
```javascript
const monthly = await fastify.questdb.getMonthlySummary(
  'sensor.home_energy',
  new Date('2024-01-01'),
  new Date('2024-12-31')
)
// Uses SAMPLE BY 1M for monthly aggregation
```

#### Utility Methods

**`getLatestReadingTime(entityId)`**
```javascript
const latest = await fastify.questdb.getLatestReadingTime('sensor.home_energy')
// Returns: ISO timestamp string or null
```

**`getLatestStatsTime(entityId, period)`**
```javascript
const latest = await fastify.questdb.getLatestStatsTime('sensor.home_energy', 'hour')
```

**`isConnected()`**
```javascript
if (fastify.questdb.isConnected()) {
  // Safe to write data
}
```

**`query(sql)`**
```javascript
const result = await fastify.questdb.query(`
  SELECT entity_id, avg(state) as avg_state
  FROM energy_readings
  WHERE timestamp > dateadd('d', -7, now())
  SAMPLE BY 1h
`)
```

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `QUESTDB_HOST` | QuestDB hostname | `localhost` |
| `QUESTDB_ILP_PORT` | ILP ingestion port | `9009` |
| `QUESTDB_HTTP_PORT` | HTTP API port | `9000` |

### Running QuestDB Locally

**Docker:**
```bash
docker run -p 9000:9000 -p 9009:9009 questdb/questdb:latest
```

**Docker Compose** (from project root):
```bash
docker-compose up questdb
```

Access the web console at: http://localhost:9000

### Usage in Routes

```javascript
export default async function (fastify, opts) {
  fastify.get('/readings/:entityId', async (request, reply) => {
    const { entityId } = request.params
    const { start, end, limit = 1000 } = request.query

    const readings = await fastify.questdb.getReadings(
      entityId,
      new Date(start),
      new Date(end),
      parseInt(limit)
    )

    return { data: readings }
  })

  fastify.post('/readings', async (request, reply) => {
    const { readings } = request.body

    await fastify.questdb.writeReadings(readings)

    return { success: true, count: readings.length }
  })
}
```

### Testing

Run the test suite:

```bash
# Make sure QuestDB is running
docker run -p 9000:9000 -p 9009:9009 questdb/questdb:latest

# Run tests
cd web/api
npm test
```

To skip QuestDB tests (if no instance available):
```bash
QUESTDB_TEST=false npm test
```

### Performance Considerations

1. **Batch Writes**: Always batch multiple readings/stats in a single call
   - Good: `writeReadings([r1, r2, r3, ...])`
   - Bad: `writeReadings([r1]); writeReadings([r2]); ...`

2. **Timestamp Format**: Use nanoseconds for precision
   ```javascript
   timestamp: Date.now() * 1000000 // ms -> ns
   ```

3. **SYMBOL Columns**: `entity_id` and `period` are SYMBOLs for efficient filtering

4. **Partitioning**:
   - `energy_readings`: Daily partitions (optimize for recent data queries)
   - `energy_statistics`: Monthly partitions (longer-term storage)

5. **Query Optimization**: Use `SAMPLE BY` for aggregations instead of GROUP BY
   ```sql
   -- Good: Uses SAMPLE BY
   SELECT timestamp, avg(state)
   FROM energy_readings
   WHERE timestamp > '2024-01-01'
   SAMPLE BY 1h

   -- Less efficient: Uses GROUP BY
   SELECT date_trunc('hour', timestamp), avg(state)
   FROM energy_readings
   WHERE timestamp > '2024-01-01'
   GROUP BY 1
   ```

### Error Handling

The plugin includes automatic reconnection logic:

```javascript
// Connection failures are logged and reconnection is attempted every 5s
// Writes will throw errors if connection is down
try {
  await fastify.questdb.writeReadings(readings)
} catch (err) {
  fastify.log.error({ err }, 'Failed to write readings')
  // Handle error (retry, queue, etc.)
}
```

### Troubleshooting

**Connection Issues:**
```bash
# Check QuestDB is running
curl http://localhost:9000/

# Check ILP port
nc -zv localhost 9009
```

**Schema Issues:**
```bash
# Access web console
open http://localhost:9000

# Verify tables exist
SELECT * FROM tables WHERE name IN ('energy_readings', 'energy_statistics')
```

**Data Not Appearing:**
- Check timestamps are in nanoseconds
- Verify entity_id is a valid SYMBOL (no special chars)
- Allow time for data to commit (async writes)

### Additional Resources

- [QuestDB Documentation](https://questdb.io/docs/)
- [ILP Protocol Guide](https://questdb.io/docs/reference/api/ilp/overview/)
- [SQL Reference](https://questdb.io/docs/reference/sql/select/)
- [SAMPLE BY Examples](https://questdb.io/docs/reference/sql/sample-by/)
