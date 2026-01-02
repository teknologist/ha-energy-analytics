# Implementation Plan: P1.2 MongoDB Plugin - Application State Storage

**Linear Issue:** TEK-35
**Phase:** 1.2 - Database Layer (Dual-Database Architecture)
**Priority:** Critical (Blocker for event-driven sync)
**Estimated Effort:** 4-6 hours

---

## Overview

This plan implements the MongoDB plugin for application state storage as part of the dual-database architecture. MongoDB will handle all mutable configuration data (settings, entity metadata, subscription state, sync logs) while QuestDB (implemented in P1.3) will handle time-series energy data.

**Key Principle:** MongoDB is for *configuration and state*, QuestDB is for *time-series data*. This separation enables:
- Flexible schema evolution for settings without migrations
- ACID compliance for configuration changes
- Natural document storage for complex entity attributes
- Efficient key-value access for settings

---

## Prerequisites

### Required Dependencies

1. **MongoDB Server Running**
   - Local: MongoDB 7.x installed and running on localhost:27017
   - Docker: Use docker-compose.yml with MongoDB service
   - Verify: `mongosh --eval "db.version()"`

2. **NPM Package Installation**
   ```bash
   cd /Users/eric/Dev/energy-tracker/web/api
   npm install mongodb@^6.14.0
   ```

3. **Environment Configuration**
   - Add `MONGODB_URI` to `.env` file
   - Default: `mongodb://localhost:27017/energy_dashboard`

---

## Implementation Steps

### Step 1: Create MongoDB Plugin File

**File:** `/Users/eric/Dev/energy-tracker/web/api/plugins/mongodb.js`

See detailed implementation in INVESTIGATION_REPORT.md and spec file (lines 352-478)

### Step 2: Update Platformatic Configuration

**File:** `/Users/eric/Dev/energy-tracker/web/api/platformatic.json`

Add `mongodb.js` FIRST in plugins array (before home-assistant.js)

### Step 3: Update Home Assistant Plugin Dependencies

**File:** `/Users/eric/Dev/energy-tracker/web/api/plugins/home-assistant.js`

- Add `dependencies: ['mongodb']` to plugin export
- Update to read settings from MongoDB first, fallback to env
- Save discovered entities to MongoDB

### Step 4: Update Environment Configuration

**File:** `/Users/eric/Dev/energy-tracker/.env`

Add:
```bash
MONGODB_URI=mongodb://localhost:27017/energy_dashboard
```

### Step 5: Update API Package Dependencies

**File:** `/Users/eric/Dev/energy-tracker/web/api/package.json`

Add:
```json
"mongodb": "^6.14.0"
```

### Step 6: Verification & Testing

Run:
```bash
npm run dev
```

Expected logs:
- "Connected to MongoDB"
- "MongoDB indexes created"

---

## Success Criteria

- [ ] MongoDB plugin loads successfully on app startup
- [ ] Settings CRUD operations work (get, set, delete, getAll)
- [ ] Entity management functions work (upsert, get, setTracked)
- [ ] Subscription state operations work (get, update, reset)
- [ ] Sync logging works (log, getRecent, getStats)
- [ ] Indexes created automatically on startup
- [ ] Home Assistant plugin uses MongoDB for settings
- [ ] Graceful shutdown closes MongoDB connection

---

## Complete File Manifest

**Files to Create:**
- `/Users/eric/Dev/energy-tracker/web/api/plugins/mongodb.js` ✨ **NEW**

**Files to Modify:**
- `/Users/eric/Dev/energy-tracker/web/api/platformatic.json` ✏️
- `/Users/eric/Dev/energy-tracker/web/api/plugins/home-assistant.js` ✏️
- `/Users/eric/Dev/energy-tracker/web/api/package.json` ✏️
- `/Users/eric/Dev/energy-tracker/.env` ✏️

---

**For full implementation details, see:**
- `/Users/eric/Dev/energy-tracker/specs/energy-dashboard-spec.md` (Lines 213-478)
- `/Users/eric/Dev/energy-tracker/claude-instance/INVESTIGATION_REPORT.md` (MongoDB sections)

**End of Plan**
