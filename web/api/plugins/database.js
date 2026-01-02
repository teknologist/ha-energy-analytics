import fp from 'fastify-plugin'
import Database from 'better-sqlite3'
import { mkdirSync, existsSync } from 'fs'
import { dirname } from 'path'

async function databasePlugin(fastify, options) {
  const dbPath = process.env.DATABASE_PATH || './data/energy.db'
  
  // Ensure directory exists
  const dir = dirname(dbPath)
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true })
  }

  const db = new Database(dbPath)
  
  // Enable WAL mode for better concurrent read performance
  db.pragma('journal_mode = WAL')

  // Initialize schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS energy_statistics (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      start_time TEXT NOT NULL,
      end_time TEXT,
      state REAL,
      sum REAL,
      mean REAL,
      min REAL,
      max REAL,
      period TEXT DEFAULT 'hour',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(entity_id, start_time, period)
    );

    CREATE INDEX IF NOT EXISTS idx_entity_time 
    ON energy_statistics(entity_id, start_time);

    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      last_sync TEXT NOT NULL,
      records_synced INTEGER DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS entities (
      entity_id TEXT PRIMARY KEY,
      friendly_name TEXT,
      device_class TEXT,
      unit_of_measurement TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
  `)

  // Prepared statements for common operations
  const statements = {
    insertStats: db.prepare(`
      INSERT OR REPLACE INTO energy_statistics 
      (entity_id, start_time, end_time, state, sum, mean, min, max, period)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    
    getStats: db.prepare(`
      SELECT * FROM energy_statistics 
      WHERE entity_id = ? AND start_time >= ? AND start_time <= ?
      ORDER BY start_time ASC
    `),

    getLatestSync: db.prepare(`
      SELECT MAX(start_time) as latest FROM energy_statistics WHERE entity_id = ?
    `),

    upsertEntity: db.prepare(`
      INSERT INTO entities (entity_id, friendly_name, device_class, unit_of_measurement, updated_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(entity_id) DO UPDATE SET
        friendly_name = excluded.friendly_name,
        device_class = excluded.device_class,
        unit_of_measurement = excluded.unit_of_measurement,
        updated_at = CURRENT_TIMESTAMP
    `),

    getEntities: db.prepare(`SELECT * FROM entities WHERE is_active = 1`),

    getDailySummary: db.prepare(`
      SELECT 
        entity_id,
        date(start_time) as date,
        SUM(CASE WHEN sum IS NOT NULL THEN sum ELSE state END) as total,
        AVG(mean) as avg_power,
        MAX(max) as peak,
        COUNT(*) as readings
      FROM energy_statistics
      WHERE entity_id = ? AND start_time >= ? AND start_time <= ?
      GROUP BY entity_id, date(start_time)
      ORDER BY date ASC
    `),

    getMonthlySummary: db.prepare(`
      SELECT 
        entity_id,
        strftime('%Y-%m', start_time) as month,
        SUM(CASE WHEN sum IS NOT NULL THEN sum ELSE state END) as total,
        AVG(mean) as avg_power,
        MAX(max) as peak,
        COUNT(*) as readings
      FROM energy_statistics
      WHERE entity_id = ? AND start_time >= ? AND start_time <= ?
      GROUP BY entity_id, strftime('%Y-%m', start_time)
      ORDER BY month ASC
    `)
  }

  const dbHelpers = {
    db,
    statements,
    
    insertStatsBatch(stats) {
      const insert = db.transaction((records) => {
        for (const record of records) {
          statements.insertStats.run(
            record.entity_id,
            record.start_time,
            record.end_time,
            record.state,
            record.sum,
            record.mean,
            record.min,
            record.max,
            record.period || 'hour'
          )
        }
      })
      insert(stats)
    },

    getStatistics(entityId, startTime, endTime) {
      return statements.getStats.all(entityId, startTime, endTime)
    },

    getDailySummary(entityId, startTime, endTime) {
      return statements.getDailySummary.all(entityId, startTime, endTime)
    },

    getMonthlySummary(entityId, startTime, endTime) {
      return statements.getMonthlySummary.all(entityId, startTime, endTime)
    },

    getLatestSyncTime(entityId) {
      const result = statements.getLatestSync.get(entityId)
      return result?.latest
    },

    upsertEntity(entity) {
      statements.upsertEntity.run(
        entity.entity_id,
        entity.friendly_name || entity.attributes?.friendly_name,
        entity.device_class || entity.attributes?.device_class,
        entity.unit_of_measurement || entity.attributes?.unit_of_measurement
      )
    },

    getEntities() {
      return statements.getEntities.all()
    }
  }

  fastify.decorate('db', dbHelpers)

  fastify.addHook('onClose', async () => {
    db.close()
  })
}

export default fp(databasePlugin, {
  name: 'database'
})
