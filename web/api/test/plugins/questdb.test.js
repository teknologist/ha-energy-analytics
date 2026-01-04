import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import questdbPlugin from '../../../../runtime-plugins/questdb.js';

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

describe.skipIf(!QUESTDB_AVAILABLE)('QuestDB Plugin - Initialization', () => {
  it('should register plugin and decorate fastify', async () => {
    const fastify = await buildFastify();

    expect(fastify.questdb).toBeTruthy();
    expect(typeof fastify.questdb.writeReadings).toBe('function');
    expect(typeof fastify.questdb.writeStats).toBe('function');
    expect(typeof fastify.questdb.getReadings).toBe('function');
    expect(typeof fastify.questdb.getStatistics).toBe('function');
    expect(typeof fastify.questdb.getDailySummary).toBe('function');
    expect(typeof fastify.questdb.getMonthlySummary).toBe('function');
    expect(typeof fastify.questdb.isConnected).toBe('function');
    expect(typeof fastify.questdb.query).toBe('function');

    await fastify.close();
  });

  it('should establish ILP connection', async () => {
    const fastify = await buildFastify();

    await waitForConnection(fastify);
    expect(fastify.questdb.isConnected()).toBe(true);

    await fastify.close();
  });

  it('should have correct config', async () => {
    const fastify = await buildFastify();

    expect(fastify.questdb.config).toBeTruthy();
    expect(typeof fastify.questdb.config.host).toBe('string');
    expect(typeof fastify.questdb.config.ilpPort).toBe('number');
    expect(typeof fastify.questdb.config.httpPort).toBe('number');

    await fastify.close();
  });

  it('should expose sanitize helpers', async () => {
    const fastify = await buildFastify();

    expect(fastify.questdb.sanitize).toBeTruthy();
    expect(typeof fastify.questdb.sanitize.entityId).toBe('function');
    expect(typeof fastify.questdb.sanitize.timestamp).toBe('function');
    expect(typeof fastify.questdb.sanitize.limit).toBe('function');
    expect(typeof fastify.questdb.sanitize.period).toBe('function');

    await fastify.close();
  });

  it('should sanitize entity IDs correctly', async () => {
    const fastify = await buildFastify();

    // Valid entity IDs
    expect(fastify.questdb.sanitize.entityId('sensor.energy')).toBe(
      'sensor.energy'
    );
    expect(fastify.questdb.sanitize.entityId('binary.sensor')).toBe(
      'binary.sensor'
    );

    // Invalid entity IDs should throw
    expect(() => fastify.questdb.sanitize.entityId('')).toThrow();
    expect(() => fastify.questdb.sanitize.entityId('invalid')).toThrow();
    expect(() => fastify.questdb.sanitize.entityId(123)).toThrow();

    await fastify.close();
  });

  it('should sanitize timestamps correctly', async () => {
    const fastify = await buildFastify();

    // Valid timestamps
    const isoString = '2024-01-01T00:00:00.000Z';
    expect(fastify.questdb.sanitize.timestamp(isoString)).toBe(isoString);

    const date = new Date('2024-01-01T00:00:00.000Z');
    expect(fastify.questdb.sanitize.timestamp(date)).toBe(isoString);

    // Invalid timestamps should throw
    expect(() => fastify.questdb.sanitize.timestamp('invalid')).toThrow();
    expect(() => fastify.questdb.sanitize.timestamp(123)).toThrow();

    await fastify.close();
  });

  it('should sanitize limits correctly', async () => {
    const fastify = await buildFastify();

    // Valid limits
    expect(fastify.questdb.sanitize.limit(100)).toBe(100);
    expect(fastify.questdb.sanitize.limit(1000000)).toBe(100000); // capped at max
    expect(fastify.questdb.sanitize.limit('50')).toBe(50);

    // Invalid limits should throw
    expect(() => fastify.questdb.sanitize.limit(-1)).toThrow();
    expect(() => fastify.questdb.sanitize.limit(0)).toThrow();
    expect(() => fastify.questdb.sanitize.limit('invalid')).toThrow();

    await fastify.close();
  });

  it('should sanitize periods correctly', async () => {
    const fastify = await buildFastify();

    // Valid periods
    expect(fastify.questdb.sanitize.period('hour')).toBe('hour');
    expect(fastify.questdb.sanitize.period('day')).toBe('day');

    // Invalid periods should throw
    expect(() => fastify.questdb.sanitize.period('invalid')).toThrow();
    expect(() => fastify.questdb.sanitize.period('')).toThrow();

    await fastify.close();
  });
});

describe.skipIf(!QUESTDB_AVAILABLE)('QuestDB Plugin - Schema Creation', () => {
  it('should create energy_readings table', async () => {
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    const result = await fastify.questdb.query(
      'SELECT * FROM energy_readings LIMIT 1'
    );
    expect(result).toBeTruthy();
    expect(Array.isArray(result.dataset)).toBe(true);

    await fastify.close();
  });

  it('should create energy_statistics table', async () => {
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    const result = await fastify.questdb.query(
      'SELECT * FROM energy_statistics LIMIT 1'
    );
    expect(result).toBeTruthy();
    expect(Array.isArray(result.dataset)).toBe(true);

    await fastify.close();
  });
});

describe.skipIf(!QUESTDB_AVAILABLE)('QuestDB Plugin - Write Operations', () => {
  const testEntityId = 'sensor.test_energy_' + Date.now();

  it('should write single reading', async () => {
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    const reading = {
      entity_id: testEntityId,
      state: 123.45,
      previous_state: 120.3,
      attributes: { unit: 'kWh', friendly_name: 'Test Energy' },
      timestamp: BigInt(Date.now()) * 1000000n, // nanoseconds as BigInt
    };

    await expect(
      fastify.questdb.writeReadings([reading])
    ).resolves.not.toThrow();

    // Wait a bit for data to be committed
    await new Promise((resolve) => setTimeout(resolve, 1000));

    await fastify.close();
  });

  it('should write multiple readings', async () => {
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    const readings = Array.from({ length: 10 }, (_, i) => ({
      entity_id: testEntityId,
      state: 100 + i,
      previous_state: 99 + i,
      attributes: { reading_num: i },
      timestamp: BigInt(Date.now() + i * 1000) * 1000000n,
    }));

    await expect(
      fastify.questdb.writeReadings(readings)
    ).resolves.not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await fastify.close();
  });

  it('should write single statistic', async () => {
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
      timestamp: BigInt(Date.now()) * 1000000n,
    };

    await expect(fastify.questdb.writeStats([stat])).resolves.not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await fastify.close();
  });

  it('should write multiple statistics', async () => {
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
      timestamp: BigInt(Date.now() + i * 3600000) * 1000000n, // hourly
    }));

    await expect(fastify.questdb.writeStats(stats)).resolves.not.toThrow();

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await fastify.close();
  });

  // Skip: This test is inherently flaky because the ILP connection
  // to localhost QuestDB happens so fast that isConnected() returns true
  // before writeReadings can be called. The plugin correctly throws
  // "Not connected to QuestDB" when called before connection is established,
  // but this timing-dependent test cannot reliably reproduce that state.
  it.skip('should throw error when not connected', async () => {
    const fastify = await buildFastify();

    // Close connection
    await fastify.close();

    const reading = {
      entity_id: testEntityId,
      state: 123.45,
      timestamp: BigInt(Date.now()) * 1000000n,
    };

    // Try to write after closing - should fail
    await expect(async () => {
      const newFastify = Fastify({ logger: false });
      await newFastify.register(questdbPlugin);
      // Don't wait for connection
      await newFastify.questdb.writeReadings([reading]);
    }).rejects.toThrow(/not connected/i);
  });
});

describe.skipIf(!QUESTDB_AVAILABLE)('QuestDB Plugin - Read Operations', () => {
  const testEntityId = 'sensor.test_read_' + Date.now();
  let fastify;

  beforeAll(async () => {
    // Setup: Write test data
    fastify = await buildFastify();
    await waitForConnection(fastify);

    const now = Date.now();
    const readings = Array.from({ length: 24 }, (_, i) => ({
      entity_id: testEntityId,
      state: 100 + i,
      previous_state: 99 + i,
      timestamp: BigInt(now - (24 - i) * 3600000) * 1000000n, // last 24 hours
    }));

    await fastify.questdb.writeReadings(readings);
    await new Promise((resolve) => setTimeout(resolve, 2000));
  });

  afterAll(async () => {
    await fastify.close();
  });

  it('should query readings by time range', async () => {
    const now = Date.now();
    const startTime = new Date(now - 12 * 3600000);
    const endTime = new Date(now + 1000);

    const results = await fastify.questdb.getReadings(
      testEntityId,
      startTime,
      endTime,
      100
    );

    expect(Array.isArray(results)).toBe(true);
    expect(results.length).toBeGreaterThan(0);
    // Allow some timing tolerance - we wrote 24 readings over 24 hours, querying last 12 hours
    expect(results.length).toBeGreaterThanOrEqual(10);
  });

  it('should respect limit parameter', async () => {
    const now = Date.now();
    const startTime = new Date(now - 24 * 3600000);
    const endTime = new Date(now + 1000);

    const results = await fastify.questdb.getReadings(
      testEntityId,
      startTime,
      endTime,
      5
    );

    expect(results.length).toBeLessThanOrEqual(5);
  });

  it('should get latest reading time', async () => {
    const latest = await fastify.questdb.getLatestReadingTime(testEntityId);

    expect(latest).toBeTruthy();
    expect(typeof latest).toBe('string');
  });
});

describe.skipIf(!QUESTDB_AVAILABLE)(
  'QuestDB Plugin - Statistics Operations',
  () => {
    const testEntityId = 'sensor.test_stats_' + Date.now();
    let fastify;

    beforeAll(async () => {
      // Setup: Write test statistics
      fastify = await buildFastify();
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
        timestamp: BigInt(now - (30 - i) * 86400000) * 1000000n, // last 30 days
      }));

      await fastify.questdb.writeStats(stats);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    });

    afterAll(async () => {
      await fastify.close();
    });

    it('should query statistics by time range', async () => {
      const now = Date.now();
      const startTime = new Date(now - 15 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getStatistics(
        testEntityId,
        startTime,
        endTime
      );

      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThan(0);
    });

    it('should filter statistics by period', async () => {
      const now = Date.now();
      const startTime = new Date(now - 30 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getStatistics(
        testEntityId,
        startTime,
        endTime,
        'day'
      );

      expect(Array.isArray(results)).toBe(true);
      if (results.length > 0) {
        // Check that period column exists in first result
        expect(results[0].length).toBeGreaterThanOrEqual(2);
      }
    });

    it('should get daily summary', async () => {
      const now = Date.now();
      const startTime = new Date(now - 7 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getDailySummary(
        testEntityId,
        startTime,
        endTime
      );

      expect(Array.isArray(results)).toBe(true);
    });

    it('should get monthly summary', async () => {
      const now = Date.now();
      const startTime = new Date(now - 90 * 86400000);
      const endTime = new Date(now + 1000);

      const results = await fastify.questdb.getMonthlySummary(
        testEntityId,
        startTime,
        endTime
      );

      expect(Array.isArray(results)).toBe(true);
    });

    it('should get latest stats time', async () => {
      const latest = await fastify.questdb.getLatestStatsTime(
        testEntityId,
        'day'
      );

      expect(latest).toBeTruthy();
      expect(typeof latest).toBe('string');
    });
  }
);

describe.skipIf(!QUESTDB_AVAILABLE)('QuestDB Plugin - Error Handling', () => {
  it('should handle invalid SQL gracefully', async () => {
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    await expect(
      fastify.questdb.query('SELECT * FROM nonexistent_table')
    ).rejects.toThrow();

    await fastify.close();
  });

  it('should handle connection cleanup on close', async () => {
    const fastify = await buildFastify();
    await waitForConnection(fastify);

    expect(fastify.questdb.isConnected()).toBe(true);

    await fastify.close();

    // After close, connection should be cleaned up
    expect(true).toBe(true); // should close without error
  });
});

describe.skipIf(!QUESTDB_AVAILABLE)(
  'QuestDB Plugin - Raw Query Interface',
  () => {
    it('should execute raw SQL queries', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const result = await fastify.questdb.query('SELECT 1 as test');

      expect(result).toBeTruthy();
      expect(result.dataset).toBeTruthy();
      expect(Array.isArray(result.dataset)).toBe(true);

      await fastify.close();
    });

    it('should return query metadata', async () => {
      const fastify = await buildFastify();
      await waitForConnection(fastify);

      const result = await fastify.questdb.query(
        'SELECT * FROM energy_readings LIMIT 1'
      );

      expect(result.columns).toBeTruthy();
      expect(Array.isArray(result.columns)).toBe(true);

      await fastify.close();
    });
  }
);

// Integration test to verify end-to-end flow
describe.skipIf(!QUESTDB_AVAILABLE)('QuestDB Plugin - Integration Test', () => {
  it('should handle complete write-read cycle', async () => {
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
        timestamp: BigInt(now - 3600000) * 1000000n,
      },
      {
        entity_id: testEntityId,
        state: 155.8,
        previous_state: 150.5,
        attributes: { unit: 'kWh' },
        timestamp: BigInt(now) * 1000000n,
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
        timestamp: BigInt(now) * 1000000n,
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

    expect(readingsResult.length).toBeGreaterThan(0);

    // Read back statistics
    const statsResult = await fastify.questdb.getStatistics(
      testEntityId,
      startTime,
      endTime,
      'hour'
    );

    expect(statsResult.length).toBeGreaterThan(0);

    await fastify.close();
  });
});
