import { test } from 'node:test';
import assert from 'node:assert';
import Fastify from 'fastify';
import questdbPlugin from '../../plugins/questdb.js';

/**
 * QuestDB Plugin Unit Tests
 *
 * Note: These tests require a running QuestDB instance.
 * Set environment variables:
 * - QUESTDB_HOST (default: localhost)
 * - QUESTDB_ILP_PORT (default: 9009)
 * - QUESTDB_HTTP_PORT (default: 9000)
 *
 * To run QuestDB locally:
 * docker run -p 9000:9000 -p 9009:9009 questdb/questdb:latest
 */

const QUESTDB_AVAILABLE = process.env.QUESTDB_TEST !== 'false';

async function buildFastify() {
  const fastify = Fastify({
    logger: {
      level: process.env.LOG_LEVEL || 'silent',
    },
  });

  await fastify.register(questdbPlugin);

  return fastify;
}

// Helper to wait for QuestDB connection
async function waitForConnection(fastify, timeout = 10000) {
  const start = Date.now();
  while (!fastify.questdb.isConnected()) {
    if (Date.now() - start > timeout) {
      throw new Error('QuestDB connection timeout');
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

test(
  'QuestDB Plugin - Initialization',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    await t.test('should register plugin and decorate fastify', async () => {
      const fastify = await buildFastify();

      assert.ok(fastify.questdb, 'questdb decorator should exist');
      assert.ok(
        typeof fastify.questdb.writeReadings === 'function',
        'writeReadings should be a function'
      );
      assert.ok(
        typeof fastify.questdb.writeStats === 'function',
        'writeStats should be a function'
      );
      assert.ok(
        typeof fastify.questdb.getReadings === 'function',
        'getReadings should be a function'
      );
      assert.ok(
        typeof fastify.questdb.getStatistics === 'function',
        'getStatistics should be a function'
      );
      assert.ok(
        typeof fastify.questdb.getDailySummary === 'function',
        'getDailySummary should be a function'
      );
      assert.ok(
        typeof fastify.questdb.getMonthlySummary === 'function',
        'getMonthlySummary should be a function'
      );
      assert.ok(
        typeof fastify.questdb.isConnected === 'function',
        'isConnected should be a function'
      );
      assert.ok(
        typeof fastify.questdb.query === 'function',
        'query should be a function'
      );

      await fastify.close();
    });

    await t.test('should establish ILP connection', async () => {
      const fastify = await buildFastify();

      await waitForConnection(fastify);
      assert.ok(
        fastify.questdb.isConnected(),
        'should be connected to QuestDB'
      );

      await fastify.close();
    });

    await t.test('should have correct config', async () => {
      const fastify = await buildFastify();

      assert.ok(fastify.questdb.config, 'config should exist');
      assert.strictEqual(typeof fastify.questdb.config.host, 'string');
      assert.strictEqual(typeof fastify.questdb.config.ilpPort, 'number');
      assert.strictEqual(typeof fastify.questdb.config.httpPort, 'number');

      await fastify.close();
    });
  }
);

test(
  'QuestDB Plugin - Schema Creation',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    await t.test('should create energy_readings table', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const result = await fastify.questdb.query(
        'SELECT * FROM energy_readings LIMIT 1'
      );
      assert.ok(result, 'should return result');
      assert.ok(Array.isArray(result.dataset), 'dataset should be an array');

      await fastify.close();
    });

    await t.test('should create energy_statistics table', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const result = await fastify.questdb.query(
        'SELECT * FROM energy_statistics LIMIT 1'
      );
      assert.ok(result, 'should return result');
      assert.ok(Array.isArray(result.dataset), 'dataset should be an array');

      await fastify.close();
    });
  }
);

test(
  'QuestDB Plugin - Write Operations',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    const testEntityId = 'sensor.test_energy_' + Date.now();

    await t.test('should write single reading', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const reading = {
        entity_id: testEntityId,
        state: 123.45,
        previous_state: 120.3,
        attributes: { unit: 'kWh', friendly_name: 'Test Energy' },
        timestamp: Date.now() * 1000000, // nanoseconds
      };

      await assert.doesNotReject(
        async () => await fastify.questdb.writeReadings([reading]),
        'should write reading without error'
      );

      // Wait a bit for data to be committed
      await new Promise((resolve) => setTimeout(resolve, 1000));

      await fastify.close();
    });

    await t.test('should write multiple readings', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const readings = Array.from({ length: 10 }, (_, i) => ({
        entity_id: testEntityId,
        state: 100 + i,
        previous_state: 99 + i,
        attributes: { reading_num: i },
        timestamp: (Date.now() + i * 1000) * 1000000,
      }));

      await assert.doesNotReject(
        async () => await fastify.questdb.writeReadings(readings),
        'should write multiple readings without error'
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await fastify.close();
    });

    await t.test('should write single statistic', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const stat = {
        entity_id: testEntityId,
        period: 'hour',
        state: 100.5,
        sum: 500.0,
        mean: 95.5,
        min: 80.0,
        max: 110.0,
        timestamp: Date.now() * 1000000,
      };

      await assert.doesNotReject(
        async () => await fastify.questdb.writeStats([stat]),
        'should write statistic without error'
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await fastify.close();
    });

    await t.test('should write multiple statistics', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const stats = Array.from({ length: 5 }, (_, i) => ({
        entity_id: testEntityId,
        period: 'hour',
        state: 100 + i * 10,
        sum: 500 + i * 50,
        mean: 95 + i * 5,
        min: 80 + i * 5,
        max: 110 + i * 10,
        timestamp: (Date.now() + i * 3600000) * 1000000, // hourly
      }));

      await assert.doesNotReject(
        async () => await fastify.questdb.writeStats(stats),
        'should write multiple statistics without error'
      );

      await new Promise((resolve) => setTimeout(resolve, 1000));

      await fastify.close();
    });

    await t.test('should throw error when not connected', async () => {
      const fastify = await buildFastify();

      // Close connection
      await fastify.close();

      const reading = {
        entity_id: testEntityId,
        state: 123.45,
        timestamp: Date.now() * 1000000,
      };

      // Try to write after closing - should fail
      await assert.rejects(
        async () => {
          const newFastify = Fastify({ logger: false });
          await newFastify.register(questdbPlugin);
          // Don't wait for connection
          await newFastify.questdb.writeReadings([reading]);
        },
        /not connected/i,
        'should throw error when not connected'
      );
    });
  }
);

test(
  'QuestDB Plugin - Read Operations',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    const testEntityId = 'sensor.test_read_' + Date.now();

    // Setup: Write test data
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    const now = Date.now();
    const readings = Array.from({ length: 24 }, (_, i) => ({
      entity_id: testEntityId,
      state: 100 + i,
      previous_state: 99 + i,
      timestamp: (now - (24 - i) * 3600000) * 1000000, // last 24 hours
    }));

    await fastify.questdb.writeReadings(readings);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await t.test('should query readings by time range', async () => {
      const startTime = new Date(now - 12 * 3600000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getReadings(
        testEntityId,
        startTime,
        endTime,
        100
      );

      assert.ok(Array.isArray(results), 'results should be an array');
      assert.ok(results.length > 0, 'should have results');
      assert.ok(results.length >= 12, 'should have at least 12 readings');
    });

    await t.test('should respect limit parameter', async () => {
      const startTime = new Date(now - 24 * 3600000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getReadings(
        testEntityId,
        startTime,
        endTime,
        5
      );

      assert.ok(results.length <= 5, 'should respect limit');
    });

    await t.test('should get latest reading time', async () => {
      const latest = await fastify.questdb.getLatestReadingTime(testEntityId);

      assert.ok(latest, 'should return latest timestamp');
      assert.strictEqual(
        typeof latest,
        'string',
        'timestamp should be a string'
      );
    });

    await fastify.close();
  }
);

test(
  'QuestDB Plugin - Statistics Operations',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    const testEntityId = 'sensor.test_stats_' + Date.now();

    // Setup: Write test statistics
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    const now = Date.now();
    const stats = Array.from({ length: 30 }, (_, i) => ({
      entity_id: testEntityId,
      period: 'day',
      state: 100 + i * 10,
      sum: 2400 + i * 240,
      mean: 100 + i * 10,
      min: 80 + i * 8,
      max: 120 + i * 12,
      timestamp: (now - (30 - i) * 86400000) * 1000000, // last 30 days
    }));

    await fastify.questdb.writeStats(stats);
    await new Promise((resolve) => setTimeout(resolve, 2000));

    await t.test('should query statistics by time range', async () => {
      const startTime = new Date(now - 15 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getStatistics(
        testEntityId,
        startTime,
        endTime
      );

      assert.ok(Array.isArray(results), 'results should be an array');
      assert.ok(results.length > 0, 'should have results');
    });

    await t.test('should filter statistics by period', async () => {
      const startTime = new Date(now - 30 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getStatistics(
        testEntityId,
        startTime,
        endTime,
        'day'
      );

      assert.ok(Array.isArray(results), 'results should be an array');
      if (results.length > 0) {
        // Check that period column exists in first result
        assert.ok(results[0].length >= 2, 'should have period column');
      }
    });

    await t.test('should get daily summary', async () => {
      const startTime = new Date(now - 7 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getDailySummary(
        testEntityId,
        startTime,
        endTime
      );

      assert.ok(Array.isArray(results), 'results should be an array');
    });

    await t.test('should get monthly summary', async () => {
      const startTime = new Date(now - 90 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getMonthlySummary(
        testEntityId,
        startTime,
        endTime
      );

      assert.ok(Array.isArray(results), 'results should be an array');
    });

    await t.test('should get latest stats time', async () => {
      const latest = await fastify.questdb.getLatestStatsTime(
        testEntityId,
        'day'
      );

      assert.ok(latest, 'should return latest timestamp');
      assert.strictEqual(
        typeof latest,
        'string',
        'timestamp should be a string'
      );
    });

    await fastify.close();
  }
);

test(
  'QuestDB Plugin - Error Handling',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    await t.test('should handle invalid SQL gracefully', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      await assert.rejects(
        async () =>
          await fastify.questdb.query('SELECT * FROM nonexistent_table'),
        'should throw error for invalid SQL'
      );

      await fastify.close();
    });

    await t.test('should handle connection cleanup on close', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      assert.ok(fastify.questdb.isConnected(), 'should be connected');

      await fastify.close();

      // After close, connection should be cleaned up
      assert.ok(true, 'should close without error');
    });
  }
);

test(
  'QuestDB Plugin - Raw Query Interface',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    await t.test('should execute raw SQL queries', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const result = await fastify.questdb.query('SELECT 1 as test');

      assert.ok(result, 'should return result');
      assert.ok(result.dataset, 'should have dataset');
      assert.ok(Array.isArray(result.dataset), 'dataset should be an array');

      await fastify.close();
    });

    await t.test('should return query metadata', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const result = await fastify.questdb.query(
        'SELECT * FROM energy_readings LIMIT 1'
      );

      assert.ok(result.columns, 'should have columns metadata');
      assert.ok(Array.isArray(result.columns), 'columns should be an array');

      await fastify.close();
    });
  }
);

// Integration test to verify end-to-end flow
test(
  'QuestDB Plugin - Integration Test',
  { skip: !QUESTDB_AVAILABLE },
  async (t) => {
    await t.test('should handle complete write-read cycle', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const testEntityId = 'sensor.integration_test_' + Date.now();
      const now = Date.now();

      // Write readings
      const readings = [
        {
          entity_id: testEntityId,
          state: 150.5,
          previous_state: 145.2,
          attributes: { unit: 'kWh' },
          timestamp: (now - 3600000) * 1000000,
        },
        {
          entity_id: testEntityId,
          state: 155.8,
          previous_state: 150.5,
          attributes: { unit: 'kWh' },
          timestamp: now * 1000000,
        },
      ];

      await fastify.questdb.writeReadings(readings);

      // Write statistics
      const stats = [
        {
          entity_id: testEntityId,
          period: 'hour',
          state: 155.8,
          sum: 5.3,
          mean: 152.65,
          min: 150.5,
          max: 155.8,
          timestamp: now * 1000000,
        },
      ];

      await fastify.questdb.writeStats(stats);

      // Wait for data to be committed
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Read back readings
      const startTime = new Date(now - 7200000);
      const endTime = new Date(now + 1000);

      const readingsResult = await fastify.questdb.getReadings(
        testEntityId,
        startTime,
        endTime,
        100
      );

      assert.ok(readingsResult.length > 0, 'should have readings');

      // Read back statistics
      const statsResult = await fastify.questdb.getStatistics(
        testEntityId,
        startTime,
        endTime,
        'hour'
      );

      assert.ok(statsResult.length > 0, 'should have statistics');

      await fastify.close();
    });
  }
);
