# TEK-36 Implementation Summary

## P2.1 Home Assistant Plugin - WebSocket Integration

**Status:** ✅ Complete
**Date:** 2026-01-02

## Overview

Successfully implemented a runtime-level Home Assistant WebSocket plugin that provides shared connectivity across all services in the Platformatic Watt application.

## What Was Implemented

### 1. Runtime-Level Plugin Architecture

Created `/runtime-plugins/` directory with three shared plugins:

#### `/runtime-plugins/home-assistant.js`
- **New Implementation** - Enhanced WebSocket client with:
  - Token-based authentication
  - Automatic reconnection with exponential backoff (1s initial → 30s max, 2x multiplier)
  - Entity discovery with energy-related filtering
  - Statistics fetching via `recorder/statistics_during_period`
  - Event subscription for `state_changed` events with callback support
  - Graceful degradation when `HA_TOKEN` is not set
  - Comprehensive error handling and logging

**Key Methods:**
- `connect()` - Establish WebSocket connection
- `isConnected()` - Check connection status (authenticated + open socket)
- `reconnect()` - Force reconnection
- `discoverEntities()` - Get all energy-related entities
- `isEnergyEntity(state)` - Filter entities by keywords, device_class, units
- `getStatistics(ids, start, end, period)` - Fetch recorder statistics
- `subscribeToStateChanges(callback, entityId?)` - Subscribe to events
- `unsubscribeFromStateChanges(entityId?)` - Unsubscribe from events
- `getEnergyPreferences()` - Fetch HA energy preferences

**Entity Filtering Keywords:**
- Entity ID: energy, power, consumption, solar, battery, production, grid
- Device Class: energy, power, battery, current, voltage
- Units: kWh, Wh, W, kW

#### `/runtime-plugins/mongodb.js`
- Migrated from `/web/api/plugins/mongodb.js`
- No changes to functionality
- Now shared across all services

#### `/runtime-plugins/questdb.js`
- Migrated from `/web/api/plugins/questdb.js`
- No changes to functionality
- Now shared across all services

### 2. Watt Runtime Configuration

**Updated `/watt.json`:**
```json
{
  "plugins": {
    "paths": [
      { "path": "./runtime-plugins/mongodb.js", "encapsulate": false },
      { "path": "./runtime-plugins/questdb.js", "encapsulate": false },
      { "path": "./runtime-plugins/home-assistant.js", "encapsulate": false }
    ]
  }
}
```

### 3. API Service Configuration

**Updated `/web/api/platformatic.json`:**
- Removed duplicate plugin registrations
- Kept only routes with `encapsulate: false`
- Plugins now inherited from runtime level

**Deleted duplicate plugins:**
- `/web/api/plugins/home-assistant.js` (old basic implementation)
- `/web/api/plugins/mongodb.js`
- `/web/api/plugins/questdb.js`

### 4. Health Check Updates

**Updated `/web/api/routes/root.js`:**
- Changed `fastify.ha?.connected` to `fastify.ha?.isConnected()`
- Proper method call for enhanced client
- Used in both `/api/health` and `/api/status` endpoints

### 5. Dependencies

**Added to root `package.json`:**
- `ws@8.18.3` - WebSocket client library
- `fastify-plugin@5.1.0` - Plugin wrapper
- `mongodb@7.0.0` - MongoDB driver
- `@questdb/nodejs-client@4.2.0` - QuestDB client

### 6. Documentation

**Created `/runtime-plugins/README.md`:**
- Architecture overview with Mermaid diagram
- Plugin usage examples
- Environment variable reference
- Troubleshooting guide

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `HA_URL` | Home Assistant host:port | `homeassistant.local:8123` |
| `HA_TOKEN` | Long-lived access token | (required for HA integration) |
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/energy_dashboard` |
| `QUESTDB_HOST` | QuestDB hostname | `localhost` |
| `QUESTDB_ILP_PORT` | QuestDB ILP ingestion port | `9009` |
| `QUESTDB_HTTP_PORT` | QuestDB HTTP API port | `9000` |

## Key Features Implemented

### Automatic Reconnection
- Exponential backoff: 1s → 2s → 4s → 8s → ... → 30s (max)
- Resets attempt counter on successful connection
- Resubscribes to all active subscriptions after reconnection
- Clears pending requests on disconnect

### Event Subscription
- Subscribe to `state_changed` events globally or per-entity
- Automatic resubscription after reconnection
- Callback-based event handling
- Graceful unsubscribe with cleanup

### Connection Management
- 30-second timeout for authentication
- Connection state tracking (`connected`, `authenticated`)
- Health check via `isConnected()` method
- Graceful shutdown cleanup

### Error Handling
- Request timeout (30s per request)
- Invalid token detection
- WebSocket error handling
- Callback error isolation (one callback failure doesn't affect others)

## File Structure

```
energy-tracker/
├── watt.json                           # Updated with runtime plugins
├── package.json                        # Added ws, fastify-plugin, mongodb, @questdb/nodejs-client
├── runtime-plugins/                    # NEW DIRECTORY
│   ├── README.md                       # Plugin documentation
│   ├── home-assistant.js               # NEW - Enhanced WebSocket client
│   ├── mongodb.js                      # Migrated from web/api/plugins/
│   └── questdb.js                      # Migrated from web/api/plugins/
└── web/
    └── api/
        ├── platformatic.json           # Updated - removed duplicate plugins
        ├── plugins/
        │   ├── README.md               # (kept)
        │   └── questdb.example.js      # (kept)
        └── routes/
            └── root.js                 # Updated - use isConnected() method
```

## Testing Instructions

### 1. Health Check
```bash
curl http://localhost:3042/api/health
```

Expected response:
```json
{
  "status": "ok",
  "homeAssistant": true,
  "mongodb": true,
  "questdb": true,
  "timestamp": "2026-01-02T20:00:00.000Z"
}
```

### 2. Detailed Status
```bash
curl http://localhost:3042/api/status
```

Should show:
```json
{
  "system": { "status": "running", ... },
  "homeAssistant": {
    "connected": true,
    "url": "homeassistant.local:8123"
  },
  ...
}
```

### 3. Entity Discovery (once routes are implemented)
```javascript
// In any service route
const entities = await fastify.ha.discoverEntities();
console.log(entities.length + ' energy entities found');
```

### 4. Event Subscription (for Recorder service)
```javascript
// Subscribe to all state_changed events
await fastify.ha.subscribeToStateChanges((event) => {
  console.log('State changed:', event.data.entity_id);
  // Write to QuestDB
  await fastify.questdb.writeReadings([{
    entity_id: event.data.entity_id,
    state: parseFloat(event.data.new_state.state),
    timestamp: new Date(event.data.new_state.last_updated)
  }]);
});

// Subscribe to specific entity
await fastify.ha.subscribeToStateChanges(
  (event) => console.log('Solar power changed:', event.data),
  'sensor.solar_power'
);
```

## Next Steps

This implementation provides the foundation for:

1. **TEK-37** - Recorder Service (can now use `fastify.ha` for event subscriptions)
2. **TEK-38** - API Routes (can use `fastify.ha` for entity discovery and statistics)
3. **TEK-39** - Frontend Integration (API routes will expose HA data)

## Migration Notes

### For Existing Code

Replace:
```javascript
// OLD (service-level plugin)
if (fastify.ha?.connected) { ... }

// NEW (runtime-level plugin)
if (fastify.ha?.isConnected()) { ... }
```

### For New Services

All services automatically have access to:
- `fastify.ha` - Home Assistant client
- `fastify.mongo` - MongoDB helpers
- `fastify.questdb` - QuestDB helpers

No plugin registration needed in service-level `platformatic.json`.

## Technical Decisions

### Why Runtime-Level Plugins?

1. **Single Connection**: One WebSocket connection shared across all services (more efficient)
2. **Consistent State**: All services see the same connection state
3. **Simplified Config**: No duplicate plugin registration per service
4. **Resource Efficiency**: Single MongoDB pool, single QuestDB ILP sender

### Why Exponential Backoff?

1. **Network Resilience**: Handles temporary network outages
2. **Resource Conservation**: Prevents connection spam during outages
3. **Home Assistant Protection**: Doesn't overwhelm HA with reconnection attempts
4. **User Experience**: Transparent recovery without manual intervention

### Why Callback-Based Events?

1. **Flexibility**: Multiple subscribers to same events
2. **Separation of Concerns**: Recorder service handles persistence, API handles real-time updates
3. **Error Isolation**: One callback failure doesn't affect others
4. **Future-Proof**: Easy to add new event handlers

## Success Criteria

- ✅ Runtime plugins created and registered
- ✅ WebSocket client with all required features
- ✅ Automatic reconnection with exponential backoff
- ✅ Entity discovery and filtering
- ✅ Statistics fetching support
- ✅ Event subscription support
- ✅ Health check updated
- ✅ Duplicate plugins removed
- ✅ Dependencies installed
- ✅ Documentation created

## Files Changed/Created

**Created:**
- `/runtime-plugins/home-assistant.js` (413 lines)
- `/runtime-plugins/mongodb.js` (migrated)
- `/runtime-plugins/questdb.js` (migrated)
- `/runtime-plugins/README.md` (documentation)
- `/IMPLEMENTATION_TEK-36.md` (this file)

**Modified:**
- `/watt.json` (added plugins configuration)
- `/package.json` (added dependencies)
- `/web/api/platformatic.json` (removed duplicate plugins)
- `/web/api/routes/root.js` (updated health checks)

**Deleted:**
- `/web/api/plugins/home-assistant.js`
- `/web/api/plugins/mongodb.js`
- `/web/api/plugins/questdb.js`

## Absolute File Paths

Key implementation files:
- `/Users/eric/Dev/energy-tracker/runtime-plugins/home-assistant.js`
- `/Users/eric/Dev/energy-tracker/runtime-plugins/mongodb.js`
- `/Users/eric/Dev/energy-tracker/runtime-plugins/questdb.js`
- `/Users/eric/Dev/energy-tracker/runtime-plugins/README.md`
- `/Users/eric/Dev/energy-tracker/watt.json`
- `/Users/eric/Dev/energy-tracker/web/api/routes/root.js`
