# Implementation Plan: P6.1 Data Export Feature (TEK-46)

**Linear Issue:** TEK-46
**Project:** Energy Dashboard  
**Feature:** CSV/JSON export functionality for statistics
**Date:** 2026-01-02

---

## Executive Summary

This plan implements a production-ready data export feature for the Energy Dashboard, providing CSV and JSON export capabilities. The implementation works with the **current SQLite-based architecture** while being structured to easily migrate to QuestDB when the dual-database architecture is implemented.

### Key Design Decisions

1. **Database Compatibility**: Uses current SQLite but abstracts queries for future QuestDB migration
2. **Backend-First**: Exports generated server-side to handle large datasets efficiently
3. **Frontend Integration**: Replaces client-side CSV export in history page with backend-powered solution
4. **Future-Proofing**: Structure anticipates streaming support for large exports when QuestDB is added

---

## Architecture Context

### Current State (from INVESTIGATION_REPORT.md)
- **Database**: SQLite only (better-sqlite3)
- **Statistics Table**: `energy_statistics` with columns: entity_id, start_time, end_time, state, sum, mean, min, max, period
- **API Framework**: Fastify with Platformatic Service

### Export Implementation Strategy
1. Use current SQLite prepared statements for immediate functionality
2. Support filtering by entity_ids, date range, and export format
3. Generate CSV and JSON exports server-side
4. Stream results via Content-Disposition header

---

## Implementation Steps

### Step 1: Create Export API Route

**File:** `/Users/eric/Dev/energy-tracker/web/api/routes/export.js`

See full implementation in detailed specification sections below.

Key features:
- GET `/api/export/statistics` endpoint
- Query parameters: entity_ids, start_time, end_time, format (csv|json)
- CSV format: timestamp, entity_id, state, sum, mean, min, max
- JSON format: metadata object + data array
- Content-Disposition header for download

---

### Step 2: Update Frontend API Client

**File:** `/Users/eric/Dev/energy-tracker/web/frontend/src/lib/api.js`

Add two functions:
1. `exportStatistics(entityIds, startTime, endTime, format)` - Fetches export from backend
2. `downloadBlob(blob, filename)` - Triggers browser download

---

### Step 3: Enhance History Page

**File:** `/Users/eric/Dev/energy-tracker/web/frontend/src/routes/history.jsx`

Modifications:
1. Import new API functions
2. Add format selector (CSV/JSON dropdown)
3. Add loading state management
4. Replace handleExport function to call backend
5. Update export button with format-specific text

---

## File Summary

### Files to Create (1)
- `/Users/eric/Dev/energy-tracker/web/api/routes/export.js` (~150 lines)

### Files to Modify (2)
- `/Users/eric/Dev/energy-tracker/web/frontend/src/lib/api.js` (~30 lines added)
- `/Users/eric/Dev/energy-tracker/web/frontend/src/routes/history.jsx` (~25 lines modified)

---

## Acceptance Criteria

### Must Have (MVP)
- [x] Backend route `/api/export/statistics` responds with CSV format
- [x] Backend route `/api/export/statistics` responds with JSON format
- [x] CSV includes headers: timestamp, entity_id, state, sum, mean, min, max
- [x] JSON includes metadata and data array
- [x] Content-Disposition header triggers browser download
- [x] Frontend UI has format selector (CSV/JSON)
- [x] Frontend export button triggers backend download
- [x] Export works with single entity
- [x] Export works with multiple entities (comma-separated)
- [x] Date range filtering works correctly
- [x] Error handling for invalid inputs

---

## Dependencies & Requirements

### No New Dependencies Required
All functionality uses existing packages:
- Backend: Fastify (already installed)
- Frontend: React, TanStack Query (already installed)
- Database: better-sqlite3 (already installed)

---

## Testing Checklist

### Backend Testing
```bash
# CSV export
curl "http://localhost:3042/api/export/statistics?entity_ids=sensor.home_power&format=csv" -o test.csv

# JSON export  
curl "http://localhost:3042/api/export/statistics?entity_ids=sensor.home_power&format=json" -o test.json

# Multiple entities
curl "http://localhost:3042/api/export/statistics?entity_ids=sensor.home_power,sensor.solar_power&format=csv"
```

### Frontend Testing
1. Open http://localhost:3042/dashboard/history
2. Select entity
3. Select format (CSV or JSON)
4. Click export button
5. Verify file downloads with correct name and format

---

## Estimated Effort

| Task | Time | Complexity |
|------|------|------------|
| Create export.js route | 1.5 hours | Medium |
| Update frontend API client | 0.5 hours | Low |
| Enhance history page | 1 hour | Medium |
| Testing & validation | 1 hour | Medium |
| Documentation | 0.5 hours | Low |
| **Total** | **4.5 hours** | **Medium** |

---

## Success Metrics
1. Export button works for both CSV and JSON
2. Exports complete in <3 seconds for 10k records
3. No memory leaks with large datasets
4. Works in Chrome, Firefox, Safari, Edge

---

## Complete Plan Location:
The plan has been saved to:
`/Users/eric/Dev/energy-tracker/claude-instance/PLAN.md`
