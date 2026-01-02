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
  const RECONNECT_INTERVAL = 5000; // 5 seconds

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
      sender = Sender.fromConfig(
        `http::addr=${config.host}:${config.ilpPort};`
      );
      await sender.connect();
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
        sender
          .table('energy_readings')
          .symbol('entity_id', reading.entity_id)
          .floatColumn('state', reading.state)
          .floatColumn('previous_state', reading.previous_state || null)
          .stringColumn(
            'attributes',
            reading.attributes ? JSON.stringify(reading.attributes) : null
          )
          .at(reading.timestamp || Date.now() * 1000000, 'ns'); // Convert ms to ns
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
        sender
          .table('energy_statistics')
          .symbol('entity_id', stat.entity_id)
          .symbol('period', stat.period || 'hour')
          .floatColumn('state', stat.state || null)
          .floatColumn('sum', stat.sum || null)
          .floatColumn('mean', stat.mean || null)
          .floatColumn('min', stat.min || null)
          .floatColumn('max', stat.max || null)
          .at(stat.timestamp || Date.now() * 1000000, 'ns'); // Convert ms to ns
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
    const start =
      typeof startTime === 'string' ? startTime : startTime.toISOString();
    const end = typeof endTime === 'string' ? endTime : endTime.toISOString();

    const sql = `
      SELECT entity_id, state, previous_state, attributes, timestamp
      FROM energy_readings
      WHERE entity_id = '${entityId}'
        AND timestamp >= '${start}'
        AND timestamp < '${end}'
      ORDER BY timestamp DESC
      LIMIT ${limit}
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
    const start =
      typeof startTime === 'string' ? startTime : startTime.toISOString();
    const end = typeof endTime === 'string' ? endTime : endTime.toISOString();

    const periodFilter = period ? `AND period = '${period}'` : '';

    const sql = `
      SELECT entity_id, period, state, sum, mean, min, max, timestamp
      FROM energy_statistics
      WHERE entity_id = '${entityId}'
        AND timestamp >= '${start}'
        AND timestamp < '${end}'
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
    const start =
      typeof startTime === 'string' ? startTime : startTime.toISOString();
    const end = typeof endTime === 'string' ? endTime : endTime.toISOString();

    const sql = `
      SELECT
        entity_id,
        timestamp,
        sum(state) as total,
        avg(mean) as avg_power,
        max(max) as peak,
        count() as readings
      FROM energy_statistics
      WHERE entity_id = '${entityId}'
        AND timestamp >= '${start}'
        AND timestamp < '${end}'
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
    const start =
      typeof startTime === 'string' ? startTime : startTime.toISOString();
    const end = typeof endTime === 'string' ? endTime : endTime.toISOString();

    const sql = `
      SELECT
        entity_id,
        timestamp,
        sum(state) as total,
        avg(mean) as avg_power,
        max(max) as peak,
        count() as readings
      FROM energy_statistics
      WHERE entity_id = '${entityId}'
        AND timestamp >= '${start}'
        AND timestamp < '${end}'
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
    const sql = `
      SELECT max(timestamp) as latest
      FROM energy_readings
      WHERE entity_id = '${entityId}'
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
    const sql = `
      SELECT max(timestamp) as latest
      FROM energy_statistics
      WHERE entity_id = '${entityId}'
        AND period = '${period}'
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
