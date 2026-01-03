import fp from 'fastify-plugin';
import { Sender } from '@questdb/nodejs-client';

/**
 * QuestDB Plugin for Energy Dashboard
 *
 * Provides high-performance time-series storage for:
 * - Real-time energy readings (via ILP protocol)
 * - Aggregated statistics (via ILP protocol)
 * - Time-series queries (via HTTP API)
 *
 * Tables:
 * - energy_readings: Real-time state_changed events
 * - energy_statistics: Hourly/daily aggregated statistics
 */

// ============================================================================
// Input Sanitization Helpers (SQL Injection Prevention)
// ============================================================================

/**
 * Sanitize entity ID - must match Home Assistant pattern: domain.object_id
 * @param {string} value - Entity ID to sanitize
 * @returns {string} Sanitized entity ID
 * @throws {Error} If invalid format
 */
function sanitizeEntityId(value) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error('Entity ID must be a non-empty string');
  }
  // Home Assistant entity IDs: domain.object_id (alphanumeric + underscore)
  if (!/^[a-z_]+\.[a-z0-9_]+$/i.test(value)) {
    throw new Error(`Invalid entity_id format: ${value}`);
  }
  return value;
}

/**
 * Sanitize timestamp - must be valid ISO 8601 or Date
 * @param {string|Date} value - Timestamp to sanitize
 * @returns {string} ISO 8601 timestamp string
 * @throws {Error} If invalid timestamp
 */
function sanitizeTimestamp(value) {
  let date;
  if (value instanceof Date) {
    date = value;
  } else if (typeof value === 'string') {
    date = new Date(value);
  } else {
    throw new Error(`Invalid timestamp type: ${typeof value}`);
  }

  if (isNaN(date.getTime())) {
    throw new Error(`Invalid timestamp: ${value}`);
  }
  return date.toISOString();
}

/**
 * Sanitize numeric limit - must be positive integer
 * @param {number} value - Limit value
 * @param {number} max - Maximum allowed value (default: 100000)
 * @returns {number} Sanitized limit
 * @throws {Error} If invalid number
 */
function sanitizeLimit(value, max = 100000) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < 1) {
    throw new Error(`Invalid limit: ${value}`);
  }
  return Math.min(num, max);
}

/**
 * Sanitize period - must be valid period string
 * @param {string} value - Period to sanitize
 * @returns {string} Sanitized period
 * @throws {Error} If invalid period
 */
function sanitizePeriod(value) {
  const validPeriods = ['hour', 'day', 'week', 'month', 'year'];
  if (!validPeriods.includes(value)) {
    throw new Error(
      `Invalid period: ${value}. Must be one of: ${validPeriods.join(', ')}`
    );
  }
  return value;
}

// ============================================================================
// Plugin Implementation
// ============================================================================

async function questdbPlugin(fastify, options) {
  const config = {
    host: process.env.QUESTDB_HOST || 'localhost',
    ilpPort: parseInt(process.env.QUESTDB_ILP_PORT || '9009', 10),
    httpPort: parseInt(process.env.QUESTDB_HTTP_PORT || '9000', 10),
  };

  fastify.log.info({ config }, 'Initializing QuestDB plugin');

  // ILP Sender for high-performance writes
  let sender = null;
  let isConnected = false;
  let reconnectTimer = null;
  const RECONNECT_INTERVAL = parseInt(
    process.env.QUESTDB_RECONNECT_INTERVAL || '5000',
    10
  );

  /**
   * Initialize ILP connection with retry logic
   */
  async function connectILP() {
    if (sender) {
      try {
        await sender.close();
      } catch (err) {
        fastify.log.warn({ err }, 'Error closing existing sender');
      }
      sender = null;
    }

    try {
      sender = await Sender.fromConfig(
        `http::addr=${config.host}:${config.httpPort};`
      );
      isConnected = true;
      fastify.log.info('QuestDB ILP connection established');

      // Clear any pending reconnect timer
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
    } catch (err) {
      isConnected = false;
      fastify.log.error(
        { err },
        'Failed to connect to QuestDB ILP, will retry'
      );

      // Schedule reconnection
      reconnectTimer = setTimeout(() => {
        connectILP();
      }, RECONNECT_INTERVAL);
    }
  }

  /**
   * Execute HTTP query against QuestDB
   */
  async function executeQuery(sql) {
    const url = `http://${config.host}:${config.httpPort}/exec?query=${encodeURIComponent(sql)}`;

    try {
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
      });

      if (!response.ok) {
        const text = await response.text();
        throw new Error(`QuestDB query failed: ${response.status} ${text}`);
      }

      const data = await response.json();
      return data;
    } catch (err) {
      fastify.log.error({ err, sql }, 'QuestDB HTTP query error');
      throw err;
    }
  }

  /**
   * Initialize database schema
   */
  async function initializeSchema() {
    const schemas = [
      // Real-time readings from state_changed events
      `CREATE TABLE IF NOT EXISTS energy_readings (
        entity_id SYMBOL,
        state DOUBLE,
        previous_state DOUBLE,
        attributes STRING,
        timestamp TIMESTAMP
      ) TIMESTAMP(timestamp) PARTITION BY DAY;`,

      // Aggregated hourly/daily statistics
      `CREATE TABLE IF NOT EXISTS energy_statistics (
        entity_id SYMBOL,
        period SYMBOL,
        state DOUBLE,
        sum DOUBLE,
        mean DOUBLE,
        min DOUBLE,
        max DOUBLE,
        timestamp TIMESTAMP
      ) TIMESTAMP(timestamp) PARTITION BY MONTH;`,
    ];

    for (const schema of schemas) {
      try {
        await executeQuery(schema);
        fastify.log.info(
          { schema: schema.split('\n')[0] },
          'Schema initialized'
        );
      } catch (err) {
        fastify.log.error({ err, schema }, 'Failed to create table');
        throw err;
      }
    }
  }

  // Initialize connection and schema
  await connectILP();
  await initializeSchema();

  /**
   * Write energy readings in batch
   * @param {Array} readings - Array of reading objects
   * @returns {Promise<void>}
   */
  async function writeReadings(readings) {
    if (!isConnected || !sender) {
      throw new Error('QuestDB ILP not connected');
    }

    try {
      for (const reading of readings) {
        const row = sender
          .table('energy_readings')
          .symbol('entity_id', reading.entity_id)
          .floatColumn('state', reading.state);

        // Only add optional columns if they have values (avoid null in ILP)
        if (reading.previous_state != null) {
          row.floatColumn('previous_state', reading.previous_state);
        }

        if (reading.attributes) {
          row.stringColumn('attributes', JSON.stringify(reading.attributes));
        }

        row.at(reading.timestamp || Date.now() * 1000000, 'ns');
      }

      await sender.flush();
      fastify.log.debug({ count: readings.length }, 'Wrote energy readings');
    } catch (err) {
      fastify.log.error(
        { err, count: readings.length },
        'Failed to write readings'
      );

      // Attempt reconnection on write failure
      isConnected = false;
      connectILP();

      throw err;
    }
  }

  /**
   * Write energy statistics in batch
   * @param {Array} stats - Array of statistics objects
   * @returns {Promise<void>}
   */
  async function writeStats(stats) {
    if (!isConnected || !sender) {
      throw new Error('QuestDB ILP not connected');
    }

    try {
      for (const stat of stats) {
        const row = sender
          .table('energy_statistics')
          .symbol('entity_id', stat.entity_id)
          .symbol('period', stat.period || 'hour');

        // Only add optional columns if they have values (avoid null in ILP)
        if (stat.state != null) {
          row.floatColumn('state', stat.state);
        }
        if (stat.sum != null) {
          row.floatColumn('sum', stat.sum);
        }
        if (stat.mean != null) {
          row.floatColumn('mean', stat.mean);
        }
        if (stat.min != null) {
          row.floatColumn('min', stat.min);
        }
        if (stat.max != null) {
          row.floatColumn('max', stat.max);
        }

        row.at(stat.timestamp || Date.now() * 1000000, 'ns');
      }

      await sender.flush();
      fastify.log.debug({ count: stats.length }, 'Wrote energy statistics');
    } catch (err) {
      fastify.log.error(
        { err, count: stats.length },
        'Failed to write statistics'
      );

      // Attempt reconnection on write failure
      isConnected = false;
      connectILP();

      throw err;
    }
  }

  /**
   * Query energy readings for a specific entity and time range
   * @param {string} entityId - Entity ID
   * @param {string|Date} startTime - Start timestamp (ISO string or Date)
   * @param {string|Date} endTime - End timestamp (ISO string or Date)
   * @param {number} limit - Maximum number of results (default: 10000)
   * @returns {Promise<Array>}
   */
  async function getReadings(entityId, startTime, endTime, limit = 10000) {
    // Sanitize all inputs to prevent SQL injection
    const safeEntityId = sanitizeEntityId(entityId);
    const safeStart = sanitizeTimestamp(startTime);
    const safeEnd = sanitizeTimestamp(endTime);
    const safeLimit = sanitizeLimit(limit);

    const sql = `
      SELECT entity_id, state, previous_state, attributes, timestamp
      FROM energy_readings
      WHERE entity_id = '${safeEntityId}'
        AND timestamp >= '${safeStart}'
        AND timestamp < '${safeEnd}'
      ORDER BY timestamp DESC
      LIMIT ${safeLimit}
    `;

    const result = await executeQuery(sql);
    return result.dataset || [];
  }

  /**
   * Query energy statistics for a specific entity and time range
   * @param {string} entityId - Entity ID
   * @param {string|Date} startTime - Start timestamp
   * @param {string|Date} endTime - End timestamp
   * @param {string} period - Period filter ('hour', 'day', 'month')
   * @returns {Promise<Array>}
   */
  async function getStatistics(entityId, startTime, endTime, period = null) {
    // Sanitize all inputs to prevent SQL injection
    const safeEntityId = sanitizeEntityId(entityId);
    const safeStart = sanitizeTimestamp(startTime);
    const safeEnd = sanitizeTimestamp(endTime);
    const periodFilter = period
      ? `AND period = '${sanitizePeriod(period)}'`
      : '';

    const sql = `
      SELECT entity_id, period, state, sum, mean, min, max, timestamp
      FROM energy_statistics
      WHERE entity_id = '${safeEntityId}'
        AND timestamp >= '${safeStart}'
        AND timestamp < '${safeEnd}'
        ${periodFilter}
      ORDER BY timestamp ASC
    `;

    const result = await executeQuery(sql);
    return result.dataset || [];
  }

  /**
   * Get daily summary using QuestDB's SAMPLE BY
   * @param {string} entityId - Entity ID
   * @param {string|Date} startTime - Start date
   * @param {string|Date} endTime - End date
   * @returns {Promise<Array>}
   */
  async function getDailySummary(entityId, startTime, endTime) {
    // Sanitize all inputs to prevent SQL injection
    const safeEntityId = sanitizeEntityId(entityId);
    const safeStart = sanitizeTimestamp(startTime);
    const safeEnd = sanitizeTimestamp(endTime);

    const sql = `
      SELECT
        entity_id,
        timestamp,
        sum(state) as total,
        avg(mean) as avg_power,
        max(max) as peak,
        count() as readings
      FROM energy_statistics
      WHERE entity_id = '${safeEntityId}'
        AND timestamp >= '${safeStart}'
        AND timestamp < '${safeEnd}'
      SAMPLE BY 1d ALIGN TO CALENDAR
    `;

    const result = await executeQuery(sql);
    return result.dataset || [];
  }

  /**
   * Get monthly summary using QuestDB's SAMPLE BY
   * @param {string} entityId - Entity ID
   * @param {string|Date} startTime - Start date
   * @param {string|Date} endTime - End date
   * @returns {Promise<Array>}
   */
  async function getMonthlySummary(entityId, startTime, endTime) {
    // Sanitize all inputs to prevent SQL injection
    const safeEntityId = sanitizeEntityId(entityId);
    const safeStart = sanitizeTimestamp(startTime);
    const safeEnd = sanitizeTimestamp(endTime);

    const sql = `
      SELECT
        entity_id,
        timestamp,
        sum(state) as total,
        avg(mean) as avg_power,
        max(max) as peak,
        count() as readings
      FROM energy_statistics
      WHERE entity_id = '${safeEntityId}'
        AND timestamp >= '${safeStart}'
        AND timestamp < '${safeEnd}'
      SAMPLE BY 1M ALIGN TO CALENDAR
    `;

    const result = await executeQuery(sql);
    return result.dataset || [];
  }

  /**
   * Get the latest reading timestamp for an entity
   * @param {string} entityId - Entity ID
   * @returns {Promise<string|null>}
   */
  async function getLatestReadingTime(entityId) {
    const safeEntityId = sanitizeEntityId(entityId);

    const sql = `
      SELECT max(timestamp) as latest
      FROM energy_readings
      WHERE entity_id = '${safeEntityId}'
    `;

    const result = await executeQuery(sql);
    const dataset = result.dataset || [];
    return dataset[0]?.[0] || null;
  }

  /**
   * Get the latest statistics timestamp for an entity
   * @param {string} entityId - Entity ID
   * @param {string} period - Period ('hour', 'day', 'month')
   * @returns {Promise<string|null>}
   */
  async function getLatestStatsTime(entityId, period = 'hour') {
    const safeEntityId = sanitizeEntityId(entityId);
    const safePeriod = sanitizePeriod(period);

    const sql = `
      SELECT max(timestamp) as latest
      FROM energy_statistics
      WHERE entity_id = '${safeEntityId}'
        AND period = '${safePeriod}'
    `;

    const result = await executeQuery(sql);
    const dataset = result.dataset || [];
    return dataset[0]?.[0] || null;
  }

  /**
   * Health check for QuestDB connection
   * @returns {boolean}
   */
  function isQuestDBConnected() {
    return isConnected;
  }

  /**
   * Execute raw SQL query (for advanced usage)
   * @param {string} sql - SQL query
   * @returns {Promise<Object>}
   */
  async function query(sql) {
    return executeQuery(sql);
  }

  // Decorate Fastify instance with QuestDB helpers
  const questdb = {
    writeReadings,
    writeStats,
    getReadings,
    getStatistics,
    getDailySummary,
    getMonthlySummary,
    getLatestReadingTime,
    getLatestStatsTime,
    isConnected: isQuestDBConnected,
    query,
    config,
    // Expose sanitization helpers for use by other routes
    sanitize: {
      entityId: sanitizeEntityId,
      timestamp: sanitizeTimestamp,
      limit: sanitizeLimit,
      period: sanitizePeriod,
    },
  };

  fastify.decorate('questdb', questdb);

  // Cleanup on shutdown
  fastify.addHook('onClose', async () => {
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (sender) {
      try {
        await sender.close();
        fastify.log.info('QuestDB ILP connection closed');
      } catch (err) {
        fastify.log.error({ err }, 'Error closing QuestDB connection');
      }
    }
  });
}

export default fp(questdbPlugin, {
  name: 'questdb',
});
