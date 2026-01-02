# Implementation Plan: Energy Dashboard - Complete System Migration

**Date:** 2026-01-02
**Issue:** TEK-31 (Dashboard Page) + Complete System Implementation
**Scope:** Frontend (100% complete) + Backend Migration (MongoDB + QuestDB + Event Sync)

---

## Executive Summary

The **frontend dashboard is fully implemented** and working with the current SQLite-based API. However, the specification requires a **dual-database architecture** (MongoDB for application state + QuestDB for time-series data) with **event-driven real-time sync** from Home Assistant.

**Status:**
1. ✅ **Dashboard Page (TEK-31)**: Already complete and functional
2. 🔴 **Critical Backend Migration**: Implement MongoDB + QuestDB dual-database  
3. 🔴 **Event-Driven Sync**: Real-time WebSocket subscription to Home Assistant
4. 🔴 **Reconciliation System**: Heartbeat monitoring + hourly backfill
5. 🔴 **Settings Backend**: API routes for Home Assistant configuration
6. 🟡 **Docker Deployment**: Containerized deployment for home lab

---

## Phase 0: Dashboard Page Status (TEK-31)

### Current State: ✅ 100% COMPLETE

All deliverables for TEK-31 are already implemented. The dashboard is production-ready for the current SQLite backend.

**No changes needed to frontend files.**

---

## Phase 1: Database Architecture Migration

### Step 1.1: Install Database Drivers
```bash
cd /Users/eric/Dev/energy-tracker/web/api
npm install mongodb@^6.14.0 @questdb/nodejs-client@^4.2.2
```

### Step 1.2: Create MongoDB Plugin
**File:** `web/api/plugins/mongodb.js` (NEW)

Provides settings CRUD, entity management, subscription state, and sync logging.

### Step 1.3: Create QuestDB Plugin  
**File:** `web/api/plugins/questdb.js` (NEW)

Provides ILP writes, HTTP queries, and time-series aggregations.

### Step 1.4: Initialize QuestDB Tables
Create tables via QuestDB web console (http://localhost:9000):
- `energy_readings` (partitioned by DAY)
- `energy_statistics` (partitioned by MONTH)

### Step 1.5-1.10: Update Configuration
- Update Home Assistant plugin to depend on MongoDB
- Update Platformatic config with new plugins
- Update statistics/entities routes to use QuestDB/MongoDB
- Remove SQLite database plugin
- Update .env with MongoDB and QuestDB connection strings

---

## Phase 2: Event-Driven Real-Time Sync

### Step 2.1: Extend Home Assistant Plugin
Add subscription methods: `subscribeToStateChanges()`, `reconnect()`, `isEnergyEntity()`

### Step 2.2: Create Event Recorder Plugin
**File:** `web/api/plugins/event-recorder.js` (NEW)

Real-time event capture with heartbeat monitoring and reconciliation.

### Step 2.3: Create Real-Time API Routes
**File:** `web/api/routes/realtime.js` (NEW)

Endpoints for readings, subscription status, and manual backfill.

### Step 2.4: Update Root Route
Add `/api/status` endpoint for system health check.

---

## Phase 3: Settings Backend Integration

### Step 3.1: Create Settings API Routes
**File:** `web/api/routes/settings.js` (NEW)

HA configuration, connection testing, entity discovery, tracking preferences.

### Step 3.2: Verify Frontend Settings Page
Already complete. No changes needed.

---

## Phase 4: Docker Deployment

### Step 4.1-4.6: Create Docker Infrastructure
- Dockerfile (multi-stage build)
- docker-compose.yml (development)
- docker-compose.prod.yml (production with backups)
- QuestDB and Nginx configurations

---

## Implementation Order

**Must follow dependency chain:**

1. **Phase 1: Database Migration** (8-12 hours)
   - MongoDB + QuestDB plugins
   - Update routes to use new databases
   - Verify all endpoints working

2. **Phase 2: Event Sync** (10-15 hours)  
   - Event recorder plugin
   - Real-time routes
   - Verify live event capture

3. **Phase 3: Settings** (4-6 hours)
   - Settings routes
   - Test UI integration

4. **Phase 4: Docker** (6-8 hours)
   - Containerization
   - Production deployment

**Total: 28-41 hours**

---

## File Summary

### New Files (13)
1. `web/api/plugins/mongodb.js`
2. `web/api/plugins/questdb.js`
3. `web/api/plugins/event-recorder.js`
4. `web/api/routes/realtime.js`
5. `web/api/routes/settings.js`
6. `web/api/migrations/questdb-init.sql`
7-13. Docker files (Dockerfile, compose files, configs)

### Modified Files (7)
1. `web/api/plugins/home-assistant.js`
2. `web/api/routes/statistics.js`
3. `web/api/routes/entities.js`
4. `web/api/routes/root.js`
5. `web/api/platformatic.json`
6. `web/api/package.json`
7. `.env`

### Deleted Files (1)
1. `web/api/plugins/database.js` (replaced by MongoDB + QuestDB)

### No Changes (7 frontend files)
All dashboard components already complete.

---

## Success Criteria

**Phase 1:**
- ✅ MongoDB and QuestDB connected
- ✅ All API endpoints return data from new databases
- ✅ Dashboard renders with QuestDB data

**Phase 2:**
- ✅ Event recorder subscribed to HA
- ✅ Real-time readings captured in QuestDB
- ✅ Heartbeat monitoring active
- ✅ Hourly reconciliation working

**Phase 3:**
- ✅ Settings UI can update HA configuration
- ✅ Entity discovery and tracking functional

**Phase 4:**
- ✅ Docker stack starts all services
- ✅ Data persists across restarts
- ✅ Production deployment successful

---

## Next Steps

1. Review plan and confirm dual-database requirement
2. Start Phase 1 implementation
3. Verify each phase before proceeding to next
4. Deploy to home lab using Docker

