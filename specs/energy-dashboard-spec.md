# Energy Dashboard - Project Specification

A standalone home application that fetches energy consumption data from Home Assistant and provides analysis, charts, and dashboards.

## Overview

**Goal**: Build a local energy analytics dashboard that pulls data from Home Assistant's recorder database/API and presents consolidated views, trends, and insights.

**Stack**:
- **Runtime**: Node.js with Platformatic Watt application server
- **API Layer**: Fastify service for Home Assistant integration and data processing
- **Frontend**: React 18 + TanStack Query + TanStack Router + shadcn/ui + Recharts + Tailwind CSS
- **Database**: Dual-database architecture
  - **Application State**: MongoDB - settings, entities, subscription state, sync logs
  - **Time-Series Data**: QuestDB - all energy readings and statistics

> **Why Two Databases?** QuestDB is append-only optimized for time-series and cannot efficiently handle mutable application state (settings updates, entity tracking). MongoDB provides flexible document storage for configuration and operational state, while QuestDB delivers superior time-series performance for energy data ingestion and querying.

---

## Architecture

### System Overview

```mermaid
flowchart TB
    subgraph Watt["Platformatic Watt Runtime"]
        direction TB
        Runtime["Runtime (entrypoint)<br/>localhost:3042"]

        subgraph Services["Services"]
            API["API Service<br/>/api/*<br/>Fastify"]
            Frontend["Frontend<br/>/dashboard/*<br/>React + Vite"]
        end

        Runtime --> API
        Runtime --> Frontend
    end

    subgraph Plugins["API Plugins"]
        HA["home-assistant.js<br/>WebSocket Client"]
        DB["database.js<br/>Knex.js"]
        Recorder["event-recorder.js<br/>Real-time Sync"]
    end

    API --> HA
    API --> DB
    API --> Recorder

    subgraph Storage["Data Storage"]
        MongoDB["MongoDB<br/>(Application State)"]
        QuestDB["QuestDB<br/>(Time-Series)"]
    end

    DB --> MongoDB

    subgraph TimeSeriesPlugin["timeseries.js"]
        QDB["QuestDB Client"]
    end

    API --> TimeSeriesPlugin
    QDB --> QuestDB

    HomeAssistant["Home Assistant<br/>WebSocket API"]

    HA <--> HomeAssistant
    Recorder --> HA
    Recorder --> DB
```

### Data Flow Architecture

```mermaid
flowchart LR
    subgraph HA["Home Assistant"]
        States["Entity States"]
        Recorder_HA["Recorder DB"]
    end

    subgraph EventSync["Event-Driven Sync"]
        Subscribe["subscribe_events<br/>(state_changed)"]
        Filter["Energy Entity<br/>Filter"]
        RawInsert["Insert Raw<br/>Readings"]
    end

    subgraph ManualSync["Manual Sync"]
        API_Sync["POST /api/statistics/sync"]
        Stats_Fetch["recorder/statistics_during_period"]
        StatsInsert["Insert Hourly<br/>Statistics"]
    end

    subgraph Reconciliation["Reconciliation"]
        Heartbeat["5-min Heartbeat<br/>Check"]
        Hourly["Hourly Backfill"]
        Startup["Startup Gap<br/>Recovery"]
    end

    subgraph AppDB["SQLite/PostgreSQL"]
        SubState["subscription_state<br/>(lifecycle)"]
        Entities["entities<br/>(tracked sensors)"]
        Settings["settings<br/>(configuration)"]
    end

    subgraph QuestDB["QuestDB (Time-Series)"]
        Readings["energy_readings<br/>(raw events)"]
        Statistics["energy_statistics<br/>(hourly aggregates)"]
    end

    States --> Subscribe
    Subscribe --> Filter
    Filter --> RawInsert
    RawInsert --> Readings
    RawInsert --> SubState

    Recorder_HA --> Stats_Fetch
    API_Sync --> Stats_Fetch
    Stats_Fetch --> StatsInsert
    StatsInsert --> Statistics

    Heartbeat --> Subscribe
    Hourly --> Stats_Fetch
    Startup --> Stats_Fetch
```

### Reconciliation Strategy

```mermaid
flowchart TB
    subgraph Layers["Three Layers of Data Integrity"]
        L1["Layer 1: Event Stream<br/>Real-time capture via WebSocket"]
        L2["Layer 2: Heartbeat Check<br/>Every 5 min - detect stale connections"]
        L3["Layer 3: Hourly Reconciliation<br/>Fetch HA statistics to fill gaps"]
    end

    L1 --> L2
    L2 --> L3

    subgraph Recovery["Recovery Scenarios"]
        R1["Server Restart"]
        R2["Network Outage"]
        R3["WebSocket Silent Failure"]
        R4["HA Restart"]
    end

    L3 --> R1
    L3 --> R2
    L3 --> R3
    L3 --> R4
```

---

## Project Structure

```
energy-dashboard/
├── watt.json                    # Watt root configuration
├── package.json
├── .env                         # Environment variables (fallback only)
├── data/                        # SQLite database storage (dev)
│   └── .gitkeep
└── web/
    ├── api/                     # Fastify API service
    │   ├── watt.json
    │   ├── package.json
    │   ├── platformatic.json
    │   └── plugins/
    │       ├── home-assistant.js  # WebSocket client + subscriptions
    │       ├── database.js        # Knex.js multi-DB support
    │       └── event-recorder.js  # Real-time event sync + reconciliation
    │   └── routes/
    │       ├── root.js
    │       ├── entities.js
    │       ├── statistics.js
    │       ├── settings.js      # Settings CRUD endpoints
    │       └── realtime.js      # Real-time readings & subscription status
    │
    └── frontend/                # React frontend
        ├── watt.json
        ├── package.json
        ├── vite.config.js
        ├── tailwind.config.js
        ├── postcss.config.js
        ├── index.html
        └── src/
            ├── main.jsx
            ├── routeTree.gen.ts  # TanStack Router generated
            ├── index.css
            ├── lib/
            │   ├── utils.js
            │   └── api.js
            ├── hooks/
            │   └── useEnergy.js
            ├── routes/
            │   ├── __root.jsx
            │   ├── index.jsx     # Dashboard
            │   ├── history.jsx   # Historical data
            │   └── settings.jsx  # HA configuration UI
            └── components/
                ├── ui/
                │   ├── button.jsx
                │   ├── card.jsx
                │   └── select.jsx
                ├── EntitySelector.jsx
                ├── StatsCard.jsx
                └── EnergyChart.jsx
```

---

## Database Layer

### Dual-Database Architecture

The application uses a dual-database architecture optimized for different data access patterns:

1. **Application State Database** (MongoDB)
   - Configuration and settings (key-value documents)
   - Entity metadata and tracking preferences
   - Subscription lifecycle state
   - Sync logs and operational history

2. **Time-Series Database** (QuestDB - **Required**)
   - All energy readings (real-time events)
   - Aggregated statistics (hourly, daily, monthly)
   - Optimized for high-volume ingestion and time-based queries

#### Database Components

| Database | Use Case | Package | License | Required |
|----------|----------|---------|---------|----------|
| MongoDB | Application state, config, metadata | `mongodb` | Apache 2.0 | **Yes** |
| QuestDB | Time-series data (readings, statistics) | `@questdb/nodejs-client` | Apache 2.0 | **Yes** |

> **Why This Architecture?**
> - **MongoDB**: Flexible document storage for configuration, entity metadata, and operational state. Supports easy schema evolution without migrations. Natural fit for JSON-like settings and complex entity attributes.
> - **QuestDB**: Purpose-built for time-series data with ILP ingestion (millions of rows/second), time-partitioned storage, and SQL-compatible queries with time-series extensions. Low resource usage suitable for home lab deployments.

#### Database Configuration

**File: `.env`**
```bash
# MongoDB Configuration (Application State)
MONGODB_URI=mongodb://localhost:27017/energy_dashboard
# Or with authentication:
# MONGODB_URI=mongodb://energy:password@localhost:27017/energy_dashboard

# QuestDB Configuration (Time-Series Data)
QUESTDB_HOST=localhost
QUESTDB_ILP_PORT=9009
QUESTDB_HTTP_PORT=9000

# Server
PORT=3042

# Home Assistant (can be configured via UI instead)
HA_URL=homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token_here
```

### MongoDB Collections

**Collection: `settings`**
```javascript
// Key-value store for application configuration
{
  _id: "ha_url",
  value: "homeassistant.local:8123",
  updatedAt: ISODate("2025-01-02T10:00:00Z")
}
```

**Collection: `entities`**
```javascript
// Discovered and tracked Home Assistant entities
{
  _id: "sensor.home_power",
  friendlyName: "Home Power Consumption",
  deviceClass: "power",
  unitOfMeasurement: "W",
  isTracked: true,
  isActive: true,
  discoveredAt: ISODate("2025-01-02T10:00:00Z"),
  updatedAt: ISODate("2025-01-02T10:00:00Z"),
  attributes: {
    // Additional HA attributes stored as nested document
    stateClass: "measurement",
    icon: "mdi:flash"
  }
}
```

**Collection: `subscriptionState`**
```javascript
// Singleton document tracking WebSocket subscription lifecycle
{
  _id: "subscription",
  subscriptionId: 12345,
  subscribedAt: ISODate("2025-01-02T10:00:00Z"),
  lastEventAt: ISODate("2025-01-02T10:05:00Z"),
  status: "active", // active | disconnected | error
  errorMessage: null,
  reconnectCount: 0
}
```

**Collection: `syncLog`**
```javascript
// History of data sync operations
{
  _id: ObjectId("..."),
  entityId: "sensor.home_power",
  syncType: "backfill", // backfill | realtime | manual
  startTime: ISODate("2025-01-01T00:00:00Z"),
  endTime: ISODate("2025-01-02T00:00:00Z"),
  recordsSynced: 24,
  status: "success", // success | partial | failed
  errorMessage: null,
  createdAt: ISODate("2025-01-02T10:00:00Z")
}
```

### QuestDB Tables

**Table: `energy_readings`** (Real-time events via ILP)
```sql
CREATE TABLE energy_readings (
  entity_id SYMBOL,           -- Indexed for fast filtering
  state DOUBLE,               -- Current sensor value
  previous_state DOUBLE,      -- Previous value (for delta calculations)
  attributes STRING,          -- JSON string of additional attributes
  timestamp TIMESTAMP         -- Designated timestamp column
) TIMESTAMP(timestamp) PARTITION BY DAY;
```

**Table: `energy_statistics`** (Aggregated hourly data via ILP)
```sql
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

### MongoDB Plugin (Application State)

**File: `web/api/plugins/mongodb.js`**
```javascript
import fp from 'fastify-plugin';
import { MongoClient } from 'mongodb';

async function mongodbPlugin(fastify, options) {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/energy_dashboard';

  const client = new MongoClient(uri);
  await client.connect();

  const db = client.db();
  fastify.log.info('Connected to MongoDB');

  // Collections
  const settings = db.collection('settings');
  const entities = db.collection('entities');
  const subscriptionState = db.collection('subscriptionState');
  const syncLog = db.collection('syncLog');

  // Create indexes
  await entities.createIndex({ isTracked: 1, isActive: 1 });
  await syncLog.createIndex({ entityId: 1, createdAt: -1 });

  // Database helper functions
  const mongo = {
    client,
    db,

    // Settings CRUD
    async getSetting(key) {
      const doc = await settings.findOne({ _id: key });
      return doc?.value ?? null;
    },

    async setSetting(key, value) {
      await settings.updateOne(
        { _id: key },
        { $set: { value, updatedAt: new Date() } },
        { upsert: true }
      );
    },

    async getAllSettings() {
      const docs = await settings.find({}).toArray();
      return docs.reduce((acc, doc) => {
        acc[doc._id] = doc.value;
        return acc;
      }, {});
    },

    // Entity management
    async upsertEntity(entity) {
      await entities.updateOne(
        { _id: entity.entity_id },
        {
          $set: {
            friendlyName: entity.friendly_name,
            deviceClass: entity.device_class,
            unitOfMeasurement: entity.unit_of_measurement,
            isActive: true,
            updatedAt: new Date(),
            attributes: entity.attributes || {}
          },
          $setOnInsert: {
            isTracked: false,
            discoveredAt: new Date()
          }
        },
        { upsert: true }
      );
    },

    async getEntities(trackedOnly = false) {
      const filter = { isActive: true };
      if (trackedOnly) {
        filter.isTracked = true;
      }
      return entities.find(filter).toArray();
    },

    async setEntityTracked(entityId, tracked) {
      await entities.updateOne(
        { _id: entityId },
        { $set: { isTracked: tracked, updatedAt: new Date() } }
      );
    },

    // Subscription state (singleton)
    async getSubscriptionState() {
      return subscriptionState.findOne({ _id: 'subscription' });
    },

    async updateSubscriptionState(update) {
      await subscriptionState.updateOne(
        { _id: 'subscription' },
        { $set: update },
        { upsert: true }
      );
    },

    // Sync log
    async logSync(entry) {
      await syncLog.insertOne({
        ...entry,
        createdAt: new Date()
      });
    },

    async getRecentSyncs(entityId, limit = 10) {
      return syncLog
        .find({ entityId })
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    }
  };

  fastify.decorate('mongo', mongo);

  fastify.addHook('onClose', async () => {
    await client.close();
  });
}

export default fp(mongodbPlugin, { name: 'mongodb' });
```

### QuestDB Plugin (Time-Series Data)

**File: `web/api/plugins/questdb.js`**
```javascript
import fp from 'fastify-plugin';
import { Sender } from '@questdb/nodejs-client';

async function questdbPlugin(fastify, options) {
  const host = process.env.QUESTDB_HOST || 'localhost';
  const ilpPort = process.env.QUESTDB_ILP_PORT || 9009;
  const httpPort = process.env.QUESTDB_HTTP_PORT || 9000;

  // ILP Sender for high-performance writes
  const sender = Sender.fromConfig(`http::addr=${host}:${ilpPort};`);
  const httpUrl = `http://${host}:${httpPort}`;

  fastify.log.info(`Connected to QuestDB at ${host} (ILP: ${ilpPort}, HTTP: ${httpPort})`);

  const questdb = {
    sender,
    httpUrl,

    // Write energy readings (real-time events)
    async writeReadings(readings) {
      for (const reading of readings) {
        await sender
          .table('energy_readings')
          .symbol('entity_id', reading.entity_id)
          .floatColumn('state', reading.state)
          .floatColumn('previous_state', reading.previous_state ?? 0)
          .stringColumn('attributes', JSON.stringify(reading.attributes || {}))
          .at(BigInt(new Date(reading.timestamp).getTime()) * 1000000n, 'ns');
      }
      await sender.flush();
    },

    // Write statistics (aggregated data)
    async writeStats(stats) {
      for (const stat of stats) {
        await sender
          .table('energy_statistics')
          .symbol('entity_id', stat.entity_id)
          .symbol('period', stat.period || 'hour')
          .floatColumn('state', stat.state ?? 0)
          .floatColumn('sum', stat.sum ?? 0)
          .floatColumn('mean', stat.mean ?? 0)
          .floatColumn('min', stat.min ?? 0)
          .floatColumn('max', stat.max ?? 0)
          .at(BigInt(new Date(stat.start_time).getTime()) * 1000000n, 'ns');
      }
      await sender.flush();
    },

    // Query via HTTP API
    async query(sql) {
      const response = await fetch(`${httpUrl}/exec?query=${encodeURIComponent(sql)}`);
      if (!response.ok) {
        throw new Error(`QuestDB query failed: ${response.statusText}`);
      }
      return response.json();
    },

    // Get readings for an entity
    async getReadings(entityId, startTime, endTime, limit = 1000) {
      const sql = `
        SELECT * FROM energy_readings
        WHERE entity_id = '${entityId}'
        AND timestamp BETWEEN '${startTime}' AND '${endTime}'
        ORDER BY timestamp ASC
        LIMIT ${limit}
      `;
      return this.query(sql);
    },

    // Get statistics for an entity
    async getStatistics(entityId, startTime, endTime, period = 'hour') {
      const sql = `
        SELECT * FROM energy_statistics
        WHERE entity_id = '${entityId}'
        AND period = '${period}'
        AND timestamp BETWEEN '${startTime}' AND '${endTime}'
        ORDER BY timestamp ASC
      `;
      return this.query(sql);
    },

    // Get daily summary (aggregated from hourly stats)
    async getDailySummary(entityId, startTime, endTime) {
      const sql = `
        SELECT
          timestamp as date,
          sum(sum) as total,
          avg(mean) as avg_power,
          max(max) as peak,
          count() as readings
        FROM energy_statistics
        WHERE entity_id = '${entityId}'
        AND period = 'hour'
        AND timestamp BETWEEN '${startTime}' AND '${endTime}'
        SAMPLE BY 1d
        ORDER BY date ASC
      `;
      return this.query(sql);
    },

    // Get monthly summary
    async getMonthlySummary(entityId, startTime, endTime) {
      const sql = `
        SELECT
          timestamp as month,
          sum(sum) as total,
          avg(mean) as avg_power,
          max(max) as peak,
          count() as readings
        FROM energy_statistics
        WHERE entity_id = '${entityId}'
        AND period = 'hour'
        AND timestamp BETWEEN '${startTime}' AND '${endTime}'
        SAMPLE BY 1M
        ORDER BY month ASC
      `;
      return this.query(sql);
    },

    // Get latest sync time for an entity
    async getLatestSyncTime(entityId) {
      const sql = `
        SELECT max(timestamp) as latest
        FROM energy_statistics
        WHERE entity_id = '${entityId}'
      `;
      const result = await this.query(sql);
      return result.dataset?.[0]?.[0] || null;
    }
  };

  fastify.decorate('questdb', questdb);

  fastify.addHook('onClose', async () => {
    await sender.close();
  });
}

export default fp(questdbPlugin, { name: 'questdb' });
```

---

## Home Assistant Integration

### Auto-Discovery of Entities

The application automatically discovers energy-related entities from Home Assistant.

**File: `web/api/plugins/home-assistant.js`**
```javascript
import fp from 'fastify-plugin';
import WebSocket from 'ws';

class HomeAssistantClient {
  constructor(url, token, fastify) {
    this.url = url.startsWith('ws') ? url : `ws://${url}/api/websocket`;
    this.token = token;
    this.ws = null;
    this.messageId = 1;
    this.pendingRequests = new Map();
    this.connected = false;
    this.fastify = fastify;
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);

      this.ws.on('open', () => {
        this.fastify.log.info('WebSocket connected to Home Assistant');
      });

      this.ws.on('message', async (data) => {
        const message = JSON.parse(data.toString());

        if (message.type === 'auth_required') {
          this.ws.send(JSON.stringify({
            type: 'auth',
            access_token: this.token
          }));
        } else if (message.type === 'auth_ok') {
          this.connected = true;
          this.fastify.log.info('Authenticated with Home Assistant');
          resolve();
        } else if (message.type === 'auth_invalid') {
          reject(new Error('Invalid Home Assistant token'));
        } else if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id);
          this.pendingRequests.delete(message.id);
          if (message.success === false) {
            reject(new Error(message.error?.message || 'Request failed'));
          } else {
            resolve(message.result);
          }
        }
      });

      this.ws.on('error', (error) => {
        this.fastify.log.error('WebSocket error:', error);
        reject(error);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.fastify.log.info('WebSocket disconnected');
      });
    });
  }

  async send(type, payload = {}) {
    if (!this.connected) {
      throw new Error('Not connected to Home Assistant');
    }

    const id = this.messageId++;
    const message = { id, type, ...payload };

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(message));

      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);
    });
  }

  async getStates() {
    return this.send('get_states');
  }

  // Auto-discovery of energy-related entities
  async discoverEnergyEntities() {
    const states = await this.getStates();

    return states.filter(state => {
      const entityId = state.entity_id;
      const attrs = state.attributes || {};
      const deviceClass = attrs.device_class;
      const unit = attrs.unit_of_measurement;

      // Match energy-related entities
      return (
        entityId.includes('energy') ||
        entityId.includes('power') ||
        entityId.includes('consumption') ||
        entityId.includes('production') ||
        entityId.includes('solar') ||
        entityId.includes('grid') ||
        entityId.includes('battery') ||
        deviceClass === 'energy' ||
        deviceClass === 'power' ||
        deviceClass === 'battery' ||
        unit === 'kWh' ||
        unit === 'Wh' ||
        unit === 'W' ||
        unit === 'kW'
      );
    }).map(state => ({
      entity_id: state.entity_id,
      friendly_name: state.attributes?.friendly_name || state.entity_id,
      state: state.state,
      device_class: state.attributes?.device_class,
      unit_of_measurement: state.attributes?.unit_of_measurement,
      last_updated: state.last_updated,
    }));
  }

  async getStatistics(statisticIds, startTime, endTime, period = 'hour') {
    return this.send('recorder/statistics_during_period', {
      start_time: startTime,
      end_time: endTime,
      statistic_ids: statisticIds,
      period
    });
  }

  async getEnergyPreferences() {
    try {
      return await this.send('energy/get_prefs');
    } catch (error) {
      this.fastify.log.warn('Could not get energy preferences:', error.message);
      return null;
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
    }
  }
}

async function homeAssistantPlugin(fastify, options) {
  // Try to get config from MongoDB first, fall back to env
  let haUrl, haToken;

  try {
    const settings = await fastify.mongo.getAllSettings();
    haUrl = settings.ha_url || process.env.HA_URL || 'homeassistant.local:8123';
    haToken = settings.ha_token || process.env.HA_TOKEN;
  } catch {
    haUrl = process.env.HA_URL || 'homeassistant.local:8123';
    haToken = process.env.HA_TOKEN;
  }

  if (!haToken) {
    fastify.log.warn('HA_TOKEN not set - Home Assistant integration disabled');
    fastify.decorate('ha', null);
    return;
  }

  const client = new HomeAssistantClient(haUrl, haToken, fastify);

  try {
    await client.connect();
    fastify.decorate('ha', client);

    // Run initial entity discovery
    const entities = await client.discoverEnergyEntities();
    for (const entity of entities) {
      await fastify.mongo.upsertEntity(entity);
    }
    fastify.log.info(`Discovered ${entities.length} energy entities`);

    fastify.addHook('onClose', async () => {
      client.close();
    });
  } catch (error) {
    fastify.log.error('Failed to connect to Home Assistant:', error.message);
    fastify.decorate('ha', null);
  }
}

export default fp(homeAssistantPlugin, {
  name: 'home-assistant',
  dependencies: ['mongodb']
});
```

---

## Event Recorder Plugin (Real-Time Sync)

The event recorder plugin subscribes to Home Assistant `state_changed` events via WebSocket and records raw energy readings in real-time. It also handles reconciliation to ensure data integrity.

### Architecture

```mermaid
sequenceDiagram
    participant HA as Home Assistant
    participant WS as WebSocket Client
    participant ER as Event Recorder
    participant DB as Database

    Note over ER: Startup
    ER->>DB: Load known energy entities
    ER->>WS: subscribeToStateChanges()
    WS->>HA: subscribe_events (state_changed)
    HA-->>WS: Subscription confirmed

    Note over ER: Backfill gap since last event
    ER->>DB: Check subscription_state.last_event_at
    ER->>WS: getStatistics(gap period)
    WS->>HA: recorder/statistics_during_period
    HA-->>WS: Historical stats
    WS-->>ER: Stats data
    ER->>DB: Insert into energy_statistics

    loop Real-time Events
        HA->>WS: state_changed event
        WS->>ER: Event callback
        ER->>ER: isEnergyEntity()?
        alt Is energy entity
            ER->>DB: Insert into energy_readings
            ER->>DB: Update subscription_state.last_event_at
        end
    end

    loop Every 5 minutes
        ER->>DB: Check last_event_at
        alt Stale (> 2 min)
            ER->>WS: Force reconnect
            ER->>DB: Backfill missed stats
        end
    end

    loop Every hour
        ER->>WS: getStatistics(last hour)
        WS->>HA: recorder/statistics_during_period
        HA-->>WS: Hourly stats
        ER->>DB: Insert into energy_statistics (fill gaps)
    end
```

### Plugin Implementation

**File: `web/api/plugins/event-recorder.js`**
```javascript
import fp from 'fastify-plugin';

async function eventRecorderPlugin(fastify, options) {
  const { ha, mongo, questdb } = fastify;

  if (!ha || !mongo || !questdb) {
    fastify.log.warn('Event recorder requires ha, mongo, and questdb plugins');
    return;
  }

  // Energy entity filter cache
  let knownEnergyEntities = new Set();

  // Load known entities from MongoDB
  async function loadKnownEntities() {
    const entities = await mongo.getEntities();
    entities.forEach(e => knownEnergyEntities.add(e._id));
    fastify.log.info(`Loaded ${knownEnergyEntities.size} known energy entities`);
  }

  // Handle state change events
  async function handleStateChange(event) {
    const { entity_id, new_state, old_state } = event.data;

    if (!new_state) return; // Entity removed

    const isKnown = knownEnergyEntities.has(entity_id);
    const isEnergy = ha.isEnergyEntity(new_state);

    if (!isKnown && !isEnergy) return;

    // Add newly discovered energy entity to MongoDB
    if (!isKnown && isEnergy) {
      knownEnergyEntities.add(entity_id);
      await mongo.upsertEntity({
        entity_id,
        friendly_name: new_state.attributes?.friendly_name,
        device_class: new_state.attributes?.device_class,
        unit_of_measurement: new_state.attributes?.unit_of_measurement,
        attributes: new_state.attributes
      });
      fastify.log.info(`Discovered new energy entity: ${entity_id}`);
    }

    // Parse and validate state
    const stateValue = parseFloat(new_state.state);
    if (isNaN(stateValue)) return; // Skip unavailable/unknown

    const previousValue = old_state ? parseFloat(old_state.state) : null;

    // Record the reading to QuestDB via ILP
    await questdb.writeReadings([{
      entity_id,
      state: stateValue,
      previous_state: isNaN(previousValue) ? null : previousValue,
      timestamp: new_state.last_changed,
      attributes: new_state.attributes
    }]);

    // Update subscription state in MongoDB
    await mongo.updateSubscriptionState({
      lastEventAt: new Date()
    });
  }

  // Backfill statistics for a time gap
  async function backfillStatistics() {
    const entities = await mongo.getEntities(true); // tracked only
    if (entities.length === 0) return;

    let totalBackfilled = 0;

    for (const entity of entities) {
      const lastSync = await questdb.getLatestSyncTime(entity._id);
      const startTime = lastSync ||
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const endTime = new Date().toISOString();

      try {
        const stats = await ha.getStatistics([entity._id], startTime, endTime, 'hour');

        const records = [];
        for (const [id, entityStats] of Object.entries(stats)) {
          for (const stat of entityStats) {
            records.push({
              entity_id: id,
              start_time: stat.start,
              state: stat.state,
              sum: stat.sum,
              mean: stat.mean,
              min: stat.min,
              max: stat.max,
              period: 'hour'
            });
          }
          totalBackfilled += entityStats.length;
        }

        if (records.length > 0) {
          await questdb.writeStats(records);
        }

        // Log sync to MongoDB
        await mongo.logSync({
          entityId: entity._id,
          syncType: 'backfill',
          startTime,
          endTime,
          recordsSynced: records.length,
          status: 'success'
        });
      } catch (error) {
        fastify.log.warn(`Backfill failed for ${entity._id}: ${error.message}`);
        await mongo.logSync({
          entityId: entity._id,
          syncType: 'backfill',
          status: 'failed',
          errorMessage: error.message
        });
      }
    }

    fastify.log.info(`Backfilled ${totalBackfilled} statistics records`);
  }

  // Initialize
  async function initialize() {
    await loadKnownEntities();

    // Initialize subscription state in MongoDB
    await mongo.updateSubscriptionState({
      status: 'disconnected'
    });

    // Subscribe to state changes
    try {
      const subscriptionId = await ha.subscribeToStateChanges(handleStateChange);

      await mongo.updateSubscriptionState({
        subscriptionId,
        subscribedAt: new Date(),
        status: 'active'
      });

      fastify.log.info('Subscribed to Home Assistant state changes');
    } catch (error) {
      fastify.log.error(`Failed to subscribe: ${error.message}`);
    }

    // Backfill in background
    backfillStatistics().catch(err =>
      fastify.log.error(`Background backfill failed: ${err.message}`)
    );
  }

  // Periodic reconciliation intervals
  const HOURLY_SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour
  const HEARTBEAT_INTERVAL = 5 * 60 * 1000;    // 5 minutes
  const STALE_THRESHOLD = 2 * 60 * 1000;       // 2 minutes

  let hourlyTimer = null;
  let heartbeatTimer = null;

  function startPeriodicSync() {
    // Hourly reconciliation
    hourlyTimer = setInterval(async () => {
      try {
        await backfillStatistics();
      } catch (error) {
        fastify.log.error(`Hourly sync failed: ${error.message}`);
      }
    }, HOURLY_SYNC_INTERVAL);

    // Heartbeat check
    heartbeatTimer = setInterval(async () => {
      try {
        const state = await mongo.getSubscriptionState();

        if (state?.lastEventAt) {
          const lastEventTime = new Date(state.lastEventAt).getTime();
          const now = Date.now();

          if (now - lastEventTime > STALE_THRESHOLD) {
            fastify.log.warn('Stale connection detected, forcing reconnect');
            await ha.reconnect();
            await backfillStatistics();
          }
        }
      } catch (error) {
        fastify.log.error(`Heartbeat check failed: ${error.message}`);
      }
    }, HEARTBEAT_INTERVAL);
  }

  // Start everything
  await initialize();
  startPeriodicSync();

  // Cleanup on shutdown
  fastify.addHook('onClose', async () => {
    if (hourlyTimer) clearInterval(hourlyTimer);
    if (heartbeatTimer) clearInterval(heartbeatTimer);
    await ha.unsubscribeFromStateChanges();
  });

  // Expose methods for routes
  fastify.decorate('eventRecorder', {
    getSubscriptionState: () => mongo.getSubscriptionState(),
    forceBackfill: backfillStatistics,
    getKnownEntities: () => Array.from(knownEnergyEntities)
  });
}

export default fp(eventRecorderPlugin, {
  name: 'event-recorder',
  dependencies: ['home-assistant', 'mongodb', 'questdb']
});
```

---

## Real-Time API Routes

**File: `web/api/routes/realtime.js`**
```javascript
export default async function realtimeRoutes(fastify, options) {

  // Get real-time readings for an entity (from QuestDB)
  fastify.get('/api/readings/:entity_id', {
    schema: {
      description: 'Get real-time readings from event stream',
      tags: ['realtime'],
      params: {
        type: 'object',
        properties: { entity_id: { type: 'string' } },
        required: ['entity_id']
      },
      querystring: {
        type: 'object',
        properties: {
          since: { type: 'string', format: 'date-time' },
          limit: { type: 'integer', default: 1000 }
        }
      }
    }
  }, async (request, reply) => {
    const { entity_id } = request.params;
    const { since, limit = 1000 } = request.query;

    const sinceTime = since || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const endTime = new Date().toISOString();

    const result = await fastify.questdb.getReadings(entity_id, sinceTime, endTime, limit);

    return {
      entity_id,
      since: sinceTime,
      count: result.dataset?.length || 0,
      readings: result.dataset || []
    };
  });

  // Get hourly aggregation from real-time readings (QuestDB SAMPLE BY)
  fastify.get('/api/readings/:entity_id/hourly', {
    schema: {
      description: 'Get hourly aggregation from real-time readings',
      tags: ['realtime']
    }
  }, async (request, reply) => {
    const { entity_id } = request.params;
    const { start_time, end_time } = request.query;

    const endTime = end_time || new Date().toISOString();
    const startTime = start_time || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const sql = `
      SELECT
        timestamp as hour,
        min(state) as min_state,
        max(state) as max_state,
        avg(state) as avg_state,
        count() as reading_count
      FROM energy_readings
      WHERE entity_id = '${entity_id}'
      AND timestamp BETWEEN '${startTime}' AND '${endTime}'
      SAMPLE BY 1h
      ORDER BY hour ASC
    `;

    const result = await fastify.questdb.query(sql);

    return {
      entity_id,
      time_range: { start: startTime, end: endTime },
      data: result.dataset || []
    };
  });

  // Get subscription status (from MongoDB)
  fastify.get('/api/subscription/status', {
    schema: {
      description: 'Get event subscription status',
      tags: ['realtime']
    }
  }, async (request, reply) => {
    if (!fastify.eventRecorder) {
      return { status: 'not_initialized' };
    }

    const state = await fastify.eventRecorder.getSubscriptionState();
    const entities = fastify.eventRecorder.getKnownEntities();

    return {
      subscription: state,
      entities_tracked: entities.length,
      ha_connected: fastify.ha?.connected || false
    };
  });

  // Force backfill
  fastify.post('/api/subscription/backfill', {
    schema: {
      description: 'Force a backfill of statistics from Home Assistant',
      tags: ['realtime']
    }
  }, async (request, reply) => {
    if (!fastify.eventRecorder) {
      return reply.code(503).send({ error: 'Event recorder not initialized' });
    }

    await fastify.eventRecorder.forceBackfill();
    return { success: true, message: 'Backfill completed' };
  });
}
```

---

## Settings API Routes

**File: `web/api/routes/settings.js`**
```javascript
export default async function settingsRoutes(fastify, options) {

  // Get all settings (from MongoDB)
  fastify.get('/api/settings', {
    schema: {
      description: 'Get application settings',
      tags: ['settings'],
    }
  }, async (request, reply) => {
    const settings = await fastify.mongo.getAllSettings();

    // Mask sensitive data
    if (settings.ha_token) {
      settings.ha_token = '***configured***';
    }

    return {
      settings,
      ha_connected: fastify.ha?.connected || false,
      databases: {
        mongodb: 'connected',
        questdb: 'connected'
      }
    };
  });

  // Update Home Assistant configuration
  fastify.post('/api/settings/home-assistant', {
    schema: {
      description: 'Configure Home Assistant connection',
      tags: ['settings'],
      body: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Home Assistant URL (e.g., homeassistant.local:8123)' },
          token: { type: 'string', description: 'Long-lived access token' },
        },
        required: ['url', 'token']
      }
    }
  }, async (request, reply) => {
    const { url, token } = request.body;

    // Test connection before saving
    const WebSocket = (await import('ws')).default;
    const wsUrl = url.startsWith('ws') ? url : `ws://${url}/api/websocket`;

    try {
      await new Promise((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        let authenticated = false;

        ws.on('message', (data) => {
          const msg = JSON.parse(data.toString());
          if (msg.type === 'auth_required') {
            ws.send(JSON.stringify({ type: 'auth', access_token: token }));
          } else if (msg.type === 'auth_ok') {
            authenticated = true;
            ws.close();
            resolve();
          } else if (msg.type === 'auth_invalid') {
            ws.close();
            reject(new Error('Invalid token'));
          }
        });

        ws.on('error', reject);
        setTimeout(() => {
          if (!authenticated) {
            ws.close();
            reject(new Error('Connection timeout'));
          }
        }, 10000);
      });

      // Save settings to MongoDB
      await fastify.mongo.setSetting('ha_url', url);
      await fastify.mongo.setSetting('ha_token', token);

      return {
        success: true,
        message: 'Home Assistant configured successfully. Restart the server to apply changes.'
      };

    } catch (error) {
      return reply.code(400).send({
        success: false,
        error: error.message
      });
    }
  });

  // Test Home Assistant connection
  fastify.post('/api/settings/test-connection', {
    schema: {
      description: 'Test current Home Assistant connection',
      tags: ['settings'],
    }
  }, async (request, reply) => {
    if (!fastify.ha) {
      return reply.code(503).send({
        connected: false,
        error: 'Home Assistant not configured'
      });
    }

    try {
      const prefs = await fastify.ha.getEnergyPreferences();
      return {
        connected: true,
        energy_sources: prefs?.energy_sources?.length || 0
      };
    } catch (error) {
      return { connected: false, error: error.message };
    }
  });

  // Trigger entity discovery
  fastify.post('/api/settings/discover-entities', {
    schema: {
      description: 'Discover energy entities from Home Assistant',
      tags: ['settings'],
    }
  }, async (request, reply) => {
    if (!fastify.ha) {
      return reply.code(503).send({
        error: 'Home Assistant not connected'
      });
    }

    try {
      const entities = await fastify.ha.discoverEnergyEntities();

      // Update MongoDB
      for (const entity of entities) {
        await fastify.mongo.upsertEntity(entity);
      }

      return {
        success: true,
        discovered: entities.length,
        entities: entities.map(e => ({
          entity_id: e.entity_id,
          friendly_name: e.friendly_name,
          device_class: e.device_class,
          unit: e.unit_of_measurement,
        }))
      };
    } catch (error) {
      return reply.code(500).send({ error: error.message });
    }
  });

  // Set which entities to track
  fastify.post('/api/settings/tracked-entities', {
    schema: {
      description: 'Set which entities to track for statistics',
      tags: ['settings'],
      body: {
        type: 'object',
        properties: {
          entity_ids: {
            type: 'array',
            items: { type: 'string' },
            description: 'Entity IDs to track'
          }
        },
        required: ['entity_ids']
      }
    }
  }, async (request, reply) => {
    const { entity_ids } = request.body;

    // Get all entities and untrack them
    const allEntities = await fastify.mongo.getEntities();
    for (const entity of allEntities) {
      await fastify.mongo.setEntityTracked(entity._id, false);
    }

    // Then track selected
    for (const entityId of entity_ids) {
      await fastify.mongo.setEntityTracked(entityId, true);
    }

    return {
      success: true,
      tracked: entity_ids.length
    };
  });
}
```

---

## Frontend Implementation

### Package Dependencies

**File: `web/frontend/package.json`**
```json
{
  "name": "frontend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "@tanstack/react-query": "^5.90.16",
    "@tanstack/react-router": "^1.120.3",
    "recharts": "^2.15.3",
    "date-fns": "^4.1.0",
    "lucide-react": "^0.562.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "tailwind-merge": "^3.4.0",
    "@radix-ui/react-slot": "^1.2.4",
    "@radix-ui/react-select": "^2.2.6",
    "@radix-ui/react-tooltip": "^1.2.7",
    "@radix-ui/react-switch": "^1.1.3",
    "@radix-ui/react-dialog": "^1.1.7",
    "@radix-ui/react-label": "^2.1.3"
  },
  "devDependencies": {
    "@tanstack/router-plugin": "^1.120.3",
    "@vitejs/plugin-react": "^4.5.2",
    "vite": "^6.3.5",
    "@platformatic/vite": "^3.29.1",
    "tailwindcss": "^3.4.19",
    "postcss": "^8.5.4",
    "autoprefixer": "^10.4.21"
  }
}
```

### Vite Configuration

**File: `web/frontend/vite.config.js`**
```javascript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import { resolve } from 'path';

export default defineConfig({
  plugins: [
    TanStackRouterVite({
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
    }),
    react(),
  ],
  base: '/dashboard/',
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://api.plt.local',
        changeOrigin: true,
      },
    },
  },
});
```

### Main Entry Point

**File: `web/frontend/src/main.jsx`**
```jsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { routeTree } from './routeTree.gen';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      refetchOnWindowFocus: true,
    },
  },
});

const router = createRouter({
  routeTree,
  basepath: '/dashboard',
  context: {
    queryClient,
  },
});

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </React.StrictMode>
);
```

### API Client

**File: `web/frontend/src/lib/api.js`**
```javascript
const API_BASE = '/api';

async function fetchJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(error.error || `API error: ${res.status}`);
  }
  return res.json();
}

// Entity endpoints
export async function fetchEntities() {
  try {
    const data = await fetchJson(`${API_BASE}/entities`);
    return data.entities || [];
  } catch {
    const data = await fetchJson(`${API_BASE}/entities/cached`);
    return data.entities || [];
  }
}

// Statistics endpoints
export async function fetchStatistics(entityId, startTime, endTime) {
  const params = new URLSearchParams({ start_time: startTime, end_time: endTime });
  const data = await fetchJson(`${API_BASE}/statistics/${encodeURIComponent(entityId)}?${params}`);
  return data.data || [];
}

export async function fetchDailySummary(entityId, startTime, endTime) {
  const params = new URLSearchParams({ start_time: startTime, end_time: endTime });
  const data = await fetchJson(`${API_BASE}/statistics/${encodeURIComponent(entityId)}/daily?${params}`);
  return data.data || [];
}

export async function syncData(entityIds, startTime) {
  return fetchJson(`${API_BASE}/statistics/sync`, {
    method: 'POST',
    body: JSON.stringify({ entity_ids: entityIds, start_time: startTime, period: 'hour' }),
  });
}

// Settings endpoints
export async function fetchSettings() {
  return fetchJson(`${API_BASE}/settings`);
}

export async function saveHAConfig(url, token) {
  return fetchJson(`${API_BASE}/settings/home-assistant`, {
    method: 'POST',
    body: JSON.stringify({ url, token }),
  });
}

export async function testConnection() {
  return fetchJson(`${API_BASE}/settings/test-connection`, { method: 'POST' });
}

export async function discoverEntities() {
  return fetchJson(`${API_BASE}/settings/discover-entities`, { method: 'POST' });
}

export async function saveTrackedEntities(entityIds) {
  return fetchJson(`${API_BASE}/settings/tracked-entities`, {
    method: 'POST',
    body: JSON.stringify({ entity_ids: entityIds }),
  });
}

export async function fetchStatus() {
  return fetchJson(`${API_BASE}/status`);
}
```

### Settings Page

**File: `web/frontend/src/routes/settings.jsx`**
```jsx
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  fetchSettings,
  saveHAConfig,
  testConnection,
  discoverEntities,
  saveTrackedEntities
} from '@/lib/api';
import { Settings, Wifi, WifiOff, RefreshCw, Check, X } from 'lucide-react';

export const Route = createFileRoute('/settings')({
  component: SettingsPage,
});

function SettingsPage() {
  const queryClient = useQueryClient();
  const [haUrl, setHaUrl] = useState('');
  const [haToken, setHaToken] = useState('');
  const [selectedEntities, setSelectedEntities] = useState([]);

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: fetchSettings,
    onSuccess: (data) => {
      if (data.settings?.ha_url) {
        setHaUrl(data.settings.ha_url);
      }
    },
  });

  const saveConfigMutation = useMutation({
    mutationFn: () => saveHAConfig(haUrl, haToken),
    onSuccess: () => {
      queryClient.invalidateQueries(['settings']);
      setHaToken('');
    },
  });

  const testConnectionMutation = useMutation({
    mutationFn: testConnection,
  });

  const discoverMutation = useMutation({
    mutationFn: discoverEntities,
    onSuccess: () => {
      queryClient.invalidateQueries(['entities']);
    },
  });

  const saveEntitiesMutation = useMutation({
    mutationFn: () => saveTrackedEntities(selectedEntities),
  });

  if (isLoading) {
    return <div className="p-8">Loading...</div>;
  }

  return (
    <div className="container mx-auto p-8 max-w-4xl space-y-8">
      <div className="flex items-center gap-3">
        <Settings className="h-8 w-8" />
        <h1 className="text-3xl font-bold">Settings</h1>
      </div>

      {/* Connection Status */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {settings?.ha_connected ? (
              <Wifi className="h-5 w-5 text-green-500" />
            ) : (
              <WifiOff className="h-5 w-5 text-red-500" />
            )}
            Connection Status
          </CardTitle>
          <CardDescription>
            {settings?.ha_connected
              ? 'Connected to Home Assistant'
              : 'Not connected to Home Assistant'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button
            onClick={() => testConnectionMutation.mutate()}
            disabled={testConnectionMutation.isPending}
            variant="outline"
          >
            {testConnectionMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Test Connection
          </Button>
          {testConnectionMutation.data && (
            <p className="mt-2 text-sm">
              {testConnectionMutation.data.connected ? (
                <span className="text-green-600">
                  ✓ Connected ({testConnectionMutation.data.energy_sources} energy sources)
                </span>
              ) : (
                <span className="text-red-600">
                  ✗ {testConnectionMutation.data.error}
                </span>
              )}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Home Assistant Configuration */}
      <Card>
        <CardHeader>
          <CardTitle>Home Assistant Configuration</CardTitle>
          <CardDescription>
            Configure your Home Assistant connection. You can find your long-lived access token in
            Home Assistant under Profile → Long-Lived Access Tokens.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium">Home Assistant URL</label>
            <input
              type="text"
              value={haUrl}
              onChange={(e) => setHaUrl(e.target.value)}
              placeholder="homeassistant.local:8123"
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
            <p className="text-xs text-muted-foreground">
              Without http:// or ws:// prefix
            </p>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Access Token</label>
            <input
              type="password"
              value={haToken}
              onChange={(e) => setHaToken(e.target.value)}
              placeholder={settings?.settings?.ha_token ? '***configured***' : 'Enter token'}
              className="w-full px-3 py-2 border rounded-md bg-background"
            />
          </div>

          <Button
            onClick={() => saveConfigMutation.mutate()}
            disabled={saveConfigMutation.isPending || !haUrl || !haToken}
          >
            {saveConfigMutation.isPending ? 'Saving...' : 'Save Configuration'}
          </Button>

          {saveConfigMutation.isSuccess && (
            <p className="text-sm text-green-600">
              ✓ Configuration saved. Restart the server to apply.
            </p>
          )}
          {saveConfigMutation.isError && (
            <p className="text-sm text-red-600">
              ✗ {saveConfigMutation.error.message}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Entity Discovery */}
      <Card>
        <CardHeader>
          <CardTitle>Entity Discovery</CardTitle>
          <CardDescription>
            Automatically discover energy-related entities from Home Assistant.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending || !settings?.ha_connected}
          >
            {discoverMutation.isPending ? (
              <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
            ) : null}
            Discover Entities
          </Button>

          {discoverMutation.data && (
            <div className="mt-4">
              <p className="text-sm mb-2">
                Found {discoverMutation.data.discovered} entities:
              </p>
              <div className="max-h-64 overflow-y-auto border rounded-md">
                {discoverMutation.data.entities.map((entity) => (
                  <label
                    key={entity.entity_id}
                    className="flex items-center gap-3 p-3 border-b last:border-0 hover:bg-accent cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedEntities.includes(entity.entity_id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedEntities([...selectedEntities, entity.entity_id]);
                        } else {
                          setSelectedEntities(selectedEntities.filter(id => id !== entity.entity_id));
                        }
                      }}
                      className="h-4 w-4"
                    />
                    <div>
                      <div className="font-medium">{entity.friendly_name}</div>
                      <div className="text-xs text-muted-foreground">
                        {entity.entity_id} • {entity.device_class} • {entity.unit}
                      </div>
                    </div>
                  </label>
                ))}
              </div>

              {selectedEntities.length > 0 && (
                <Button
                  onClick={() => saveEntitiesMutation.mutate()}
                  disabled={saveEntitiesMutation.isPending}
                  className="mt-4"
                >
                  Track {selectedEntities.length} Entities
                </Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Database Info */}
      <Card>
        <CardHeader>
          <CardTitle>Database</CardTitle>
          <CardDescription>Current database configuration</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm">
            <span className="font-medium">Type:</span> {settings?.database_type || 'sqlite'}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

## API Package Dependencies

**File: `web/api/package.json`**
```json
{
  "name": "api",
  "version": "1.0.0",
  "type": "module",
  "main": "index.js",
  "scripts": {
    "start": "platformatic start"
  },
  "dependencies": {
    "@platformatic/service": "^3.29.1",
    "fastify-plugin": "^5.0.1",
    "ws": "^8.18.3",
    "mongodb": "^6.14.0",
    "@questdb/nodejs-client": "^4.2.2"
  }
}
```

---

## Root Configuration

**File: `watt.json`**
```json
{
  "$schema": "https://schemas.platformatic.dev/@platformatic/runtime/3.0.0.json",
  "autoload": {
    "path": "./web",
    "exclude": []
  },
  "entrypoint": "api",
  "server": {
    "hostname": "0.0.0.0",
    "port": "{PORT}"
  },
  "watch": true
}
```

**File: `package.json`**
```json
{
  "name": "energy-dashboard",
  "version": "1.0.0",
  "private": true,
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

---

## Getting Started

### 1. Install Dependencies

```bash
# Root
npm install

# API
cd web/api && npm install

# Frontend
cd ../frontend && npm install
```

### 2. Run Development Server

```bash
npm run dev
```

### 3. Configure Home Assistant

1. Open http://localhost:3042/dashboard/settings
2. Enter your Home Assistant URL (e.g., `homeassistant.local:8123`)
3. Create a Long-Lived Access Token in Home Assistant (Profile → Long-Lived Access Tokens)
4. Paste the token and save
5. Click "Discover Entities" to find energy-related sensors
6. Select entities to track

### 4. Access the Dashboard

Open http://localhost:3042/dashboard

---

## API Reference

### Entity & Statistics Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/entities` | GET | List energy entities from Home Assistant |
| `/api/entities/cached` | GET | List cached entities from database |
| `/api/statistics/:entity_id` | GET | Get statistics for an entity |
| `/api/statistics/:entity_id/daily` | GET | Get daily aggregated stats |
| `/api/statistics/:entity_id/monthly` | GET | Get monthly aggregated stats |
| `/api/statistics/sync` | POST | Sync data from Home Assistant (manual) |
| `/api/statistics/compare` | POST | Compare multiple entities |

### Real-Time Endpoints (Event-Driven Sync)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/readings/:entity_id` | GET | Get real-time readings from event stream |
| `/api/readings/:entity_id/hourly` | GET | Get hourly aggregation from raw readings |
| `/api/subscription/status` | GET | Get WebSocket subscription status |
| `/api/subscription/backfill` | POST | Force statistics backfill from HA |

### Settings Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/settings` | GET | Get application settings |
| `/api/settings/home-assistant` | POST | Configure HA connection |
| `/api/settings/test-connection` | POST | Test HA connection |
| `/api/settings/discover-entities` | POST | Auto-discover entities |
| `/api/settings/tracked-entities` | POST | Set tracked entities |

---

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Server port | `3042` |
| `DATABASE_TYPE` | Database type (sqlite/postgresql/mysql/questdb) | `sqlite` |
| `DATABASE_PATH` | SQLite database path | `./data/energy.db` |
| `DATABASE_HOST` | Database host (PG/MySQL) | `localhost` |
| `DATABASE_PORT` | Database port | `5432` (PG) / `3306` (MySQL) |
| `DATABASE_NAME` | Database name | `energy_dashboard` |
| `DATABASE_USER` | Database user | `energy` |
| `DATABASE_PASSWORD` | Database password | - |
| `QUESTDB_HOST` | QuestDB host | `localhost` |
| `QUESTDB_ILP_PORT` | QuestDB ILP port | `9009` |
| `QUESTDB_HTTP_PORT` | QuestDB HTTP port | `9000` |
| `HA_URL` | Home Assistant URL (fallback) | `homeassistant.local:8123` |
| `HA_TOKEN` | HA access token (fallback) | - |

---

## Docker Setup

The application includes a full Docker Compose setup for both development/testing and production deployment to a home lab.

### Project Docker Structure

```
energy-dashboard/
├── docker-compose.yml          # Development with all services
├── docker-compose.prod.yml     # Production deployment
├── Dockerfile                  # Multi-stage build
├── .dockerignore
└── docker/
    ├── nginx/
    │   └── nginx.conf          # Reverse proxy config
    └── questdb/
        └── server.conf         # QuestDB configuration
```

### Dockerfile (Multi-stage Build)

**File: `Dockerfile`**
```dockerfile
# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY web/api/package*.json ./web/api/
COPY web/frontend/package*.json ./web/frontend/

# Install dependencies
RUN npm ci --workspace=web/api --workspace=web/frontend
RUN npm ci

# Copy source code
COPY . .

# Build frontend
RUN npm run build --workspace=web/frontend

# Production stage
FROM node:22-alpine AS production

WORKDIR /app

# Install production dependencies only
COPY package*.json ./
COPY web/api/package*.json ./web/api/
RUN npm ci --omit=dev --workspace=web/api
RUN npm ci --omit=dev

# Copy built assets and source
COPY --from=builder /app/web/api ./web/api
COPY --from=builder /app/web/frontend/dist ./web/frontend/dist
COPY --from=builder /app/watt.json ./
COPY --from=builder /app/web/frontend/watt.json ./web/frontend/

# Create data directory
RUN mkdir -p /app/data

# Set environment
ENV NODE_ENV=production
ENV PORT=3042

EXPOSE 3042

CMD ["npm", "start"]
```

**File: `.dockerignore`**
```
node_modules
web/*/node_modules
.git
.env
*.log
data/*.db
.DS_Store
```

### Development Docker Compose

**File: `docker-compose.yml`**
```yaml
version: '3.8'

services:
  # Main application
  app:
    build:
      context: .
      target: builder
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
    volumes:
      - ./web:/app/web
      - ./data:/app/data
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

  # MongoDB (Application State Database)
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

  # QuestDB (Time-Series Database - Required)
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

  # Mongo Express for database management (development)
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

volumes:
  mongodb_data:
  questdb_data:

networks:
  energy-network:
    driver: bridge
```

### Production Docker Compose (Home Lab)

**File: `docker-compose.prod.yml`**
```yaml
version: '3.8'

services:
  # Main application
  app:
    build:
      context: .
      target: production
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - PORT=3042
      # MongoDB (Application State)
      - MONGODB_URI=mongodb://mongodb:27017/energy_dashboard
      # QuestDB (Time-Series Data)
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
      - "traefik.enable=true"
      - "traefik.http.routers.energy.rule=Host(`energy.local`)"
      - "traefik.http.services.energy.loadbalancer.server.port=3042"

  # MongoDB (Application State Database)
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

  # QuestDB (Time-Series Database - Required)
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

  # Nginx reverse proxy (alternative to Traefik)
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

  # MongoDB backup service
  mongo-backup:
    image: tiredofit/db-backup
    profiles:
      - backup
    restart: unless-stopped
    environment:
      - DB_TYPE=mongo
      - DB_HOST=mongodb
      - DB_NAME=energy_dashboard
      - DB_BACKUP_INTERVAL=1440  # Daily
      - DB_CLEANUP_TIME=10080     # Weekly cleanup
      - COMPRESSION=GZ
    volumes:
      - backup_data:/backup
    depends_on:
      - mongodb
    networks:
      - energy-network

  # Watchtower for automatic updates
  watchtower:
    image: containrrr/watchtower
    profiles:
      - auto-update
    restart: unless-stopped
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
    environment:
      - WATCHTOWER_CLEANUP=true
      - WATCHTOWER_SCHEDULE=0 4 * * *
      - WATCHTOWER_INCLUDE_STOPPED=true
    command: --interval 86400 energy-dashboard-app-1

volumes:
  app_data:
  mongodb_data:
  questdb_data:
  backup_data:

networks:
  energy-network:
    driver: bridge
```

### Nginx Configuration

**File: `docker/nginx/nginx.conf`**
```nginx
events {
    worker_connections 1024;
}

http {
    upstream app {
        server app:3042;
    }

    server {
        listen 80;
        server_name energy.local;

        # Redirect HTTP to HTTPS (uncomment for production)
        # return 301 https://$server_name$request_uri;

        location / {
            proxy_pass http://app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
        }

        # WebSocket support for HMR in development
        location /ws {
            proxy_pass http://app;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
        }
    }

    # HTTPS server (uncomment for production)
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

### QuestDB Configuration

**File: `docker/questdb/server.conf`**
```properties
# QuestDB Server Configuration

# HTTP server
http.bind.to=0.0.0.0:9000
http.min.worker.count=1
http.worker.count=2

# ILP (InfluxDB Line Protocol)
line.tcp.enabled=true
line.tcp.bind.to=0.0.0.0:9009
line.tcp.writer.worker.count=1

# PostgreSQL wire protocol
pg.enabled=true
pg.bind.to=0.0.0.0:8812
pg.net.connection.limit=64

# Memory settings for small home lab
shared.worker.count=2
cairo.sql.copy.buffer.size=2M
```

### Environment File Template

**File: `.env.example`**
```bash
# MongoDB Configuration (Application State)
MONGODB_URI=mongodb://localhost:27017/energy_dashboard

# QuestDB Configuration (Time-Series Data)
QUESTDB_HOST=localhost
QUESTDB_ILP_PORT=9009
QUESTDB_HTTP_PORT=9000

# Application
PORT=3042
NODE_ENV=production

# Home Assistant (optional - can be configured via UI)
HA_URL=homeassistant.local:8123
HA_TOKEN=your_long_lived_access_token
```

### Docker Commands

```bash
# Development (starts MongoDB + QuestDB + app)
docker compose up -d                    # Start all required services
docker compose --profile tools up -d    # Include Mongo Express for DB management

# Production (Home Lab)
docker compose -f docker-compose.prod.yml up -d           # Start all services
docker compose -f docker-compose.prod.yml --profile backup up -d   # With backups
docker compose -f docker-compose.prod.yml --profile nginx up -d    # With Nginx

# View logs
docker compose logs -f app
docker compose -f docker-compose.prod.yml logs -f

# Backup MongoDB manually
docker compose exec mongodb mongodump --db energy_dashboard --archive > backup.archive

# Restore MongoDB
docker compose exec -T mongodb mongorestore --archive < backup.archive

# Access QuestDB web console
# Open http://localhost:9000 in browser
```

### Home Lab Deployment Checklist

1. **Prerequisites**:
   - Docker and Docker Compose installed
   - Static IP or hostname for the server
   - Home Assistant accessible from the server

2. **Initial Setup**:
   ```bash
   git clone <repository> energy-dashboard
   cd energy-dashboard
   cp .env.example .env
   # Edit .env with your settings
   docker compose -f docker-compose.prod.yml up -d
   ```

3. **Configure Home Assistant**:
   - Open `http://<server-ip>:3042/dashboard/settings`
   - Enter Home Assistant URL and token
   - Discover and select entities

4. **Optional Enhancements**:
   - Enable automatic backups: `--profile backup`
   - Enable Nginx reverse proxy: `--profile nginx`
   - Enable Watchtower for auto-updates: `--profile auto-update`

5. **Database Management**:
   - MongoDB: Access via Mongo Express at `http://localhost:8081` (dev) or use `mongosh`
   - QuestDB: Access web console at `http://localhost:9000` for SQL queries

6. **DNS/Hostname** (optional):
   - Add `energy.local` to your router's DNS or `/etc/hosts`
   - Or use Traefik labels with your existing reverse proxy

---

## Future Enhancements

- **Solar production tracking**: Self-consumption ratio, grid import/export
- **Time-of-use tariffs**: Peak/off-peak/shoulder rate configuration
- **Cost tracking**: Energy cost calculations and forecasts
- **Export to CSV/PDF**: Generate reports for specific periods
- **Alerts**: Notify when consumption exceeds thresholds
- **Weather correlation**: Correlate energy usage with weather data
- **Mobile PWA**: Progressive Web App for mobile access
