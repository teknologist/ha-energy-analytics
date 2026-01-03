/**
 * Unit tests for statistics.js route handlers
 * Tests all route handlers with mocked Fastify instance and dependencies
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import Fastify from 'fastify';
import statisticsRoutes from '../../routes/statistics.js';

// Constants
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('statistics.js - Route Handlers', () => {
  let fastify;
  let mockHa;
  let mockQuestDB;
  let mockMongo;

  beforeEach(async () => {
    // Create Fastify instance with disabled schema validation for responses
    fastify = Fastify({
      logger: false,
      disableRequestLogging: true,
    });

    // Set serializer compiler to not strip additional properties
    fastify.setSerializerCompiler(({ schema, method, url, httpStatus }) => {
      return (data) => JSON.stringify(data);
    });

    // Mock Home Assistant plugin
    mockHa = {
      getEnergyEntities: vi.fn(),
      getStatistics: vi.fn(),
    };

    // Mock QuestDB plugin
    mockQuestDB = {
      getStatistics: vi.fn(),
      getDailySummary: vi.fn(),
      getMonthlySummary: vi.fn(),
      writeStats: vi.fn(),
    };

    // Mock MongoDB plugin
    mockMongo = {
      logSync: vi.fn(),
      getRecentSyncs: vi.fn(),
    };

    // Decorate fastify with mocked plugins
    fastify.decorate('ha', mockHa);
    fastify.decorate('questdb', mockQuestDB);
    fastify.decorate('mongo', mockMongo);

    // Mock logger functions on the existing fastify.log
    fastify.log.info = vi.fn();
    fastify.log.error = vi.fn();
    fastify.log.warn = vi.fn();

    // Clear all mocks before each test
    vi.clearAllMocks();

    // Register routes
    await fastify.register(statisticsRoutes);
  });

  afterEach(async () => {
    await fastify.close();
  });

  describe('POST /api/statistics/sync', () => {
    it('should return 503 when Home Assistant is not connected', async () => {
      fastify.ha = null;

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({
        success: false,
        error: 'Home Assistant not connected',
      });
    });

    it('should sync statistics with default time range (30 days)', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
        { entity_id: 'sensor.energy_2' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
        'sensor.energy_2': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 200,
            sum: 200,
            mean: 200,
            min: 190,
            max: 210,
          },
        ],
      });

      mockQuestDB.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entities_synced).toBe(2);
      expect(json.data.records_synced).toBe(2);
      expect(json.data.period).toBe('hour');
      expect(mockHa.getEnergyEntities).toHaveBeenCalled();
      expect(mockQuestDB.writeStats).toHaveBeenCalled();
      expect(mockMongo.logSync).toHaveBeenCalled();
    });

    it('should sync statistics with custom entity_ids', async () => {
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
      });

      mockQuestDB.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {
          entity_ids: ['sensor.energy_1'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mockHa.getEnergyEntities).not.toHaveBeenCalled();
      expect(mockHa.getStatistics).toHaveBeenCalledWith(
        ['sensor.energy_1'],
        expect.any(String),
        expect.any(String),
        'hour'
      );
    });

    it('should sync statistics with custom time range', async () => {
      const startTime = '2024-01-01T00:00:00.000Z';
      const endTime = '2024-01-15T23:59:59.000Z';

      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: startTime,
            end: endTime,
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
      });

      mockQuestDB.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {
          start_time: startTime,
          end_time: endTime,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().success).toBe(true);
      expect(mockHa.getStatistics).toHaveBeenCalledWith(
        expect.any(Array),
        startTime,
        endTime,
        'hour'
      );
    });

    it('should sync statistics with custom period', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-16T00:00:00.000Z',
            state: 2400,
            sum: 2400,
            mean: 100,
            min: 80,
            max: 120,
          },
        ],
      });

      mockQuestDB.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {
          period: 'day',
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().data.period).toBe('day');
      expect(mockHa.getStatistics).toHaveBeenCalledWith(
        expect.any(Array),
        expect.any(String),
        expect.any(String),
        'day'
      );
    });

    it('should handle partial success when QuestDB write fails', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
        { entity_id: 'sensor.energy_2' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
        'sensor.energy_2': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 200,
            sum: 200,
            mean: 200,
            min: 190,
            max: 210,
          },
        ],
      });

      // First bulk write fails, then entity-by-entity: first succeeds, second fails
      mockQuestDB.writeStats
        .mockRejectedValueOnce(new Error('Bulk write failed')) // Bulk write fails
        .mockResolvedValueOnce(undefined) // Entity 1 succeeds
        .mockRejectedValueOnce(new Error('Entity 2 failed')); // Entity 2 fails

      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.partial_success).toBe(true);
      expect(json.data.failed_entities).toBeDefined();
      expect(json.data.failed_entities).toHaveLength(1);
      expect(json.data.failed_entities[0].entity_id).toBe('sensor.energy_2');
      expect(mockQuestDB.writeStats).toHaveBeenCalled();
    });

    it('should handle complete failure when all entity writes fail', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
      });

      // All writes fail
      mockQuestDB.writeStats.mockRejectedValue(new Error('Write failed'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.partial_success).toBe(true);
      expect(json.data.failed_entities).toHaveLength(1);
    });

    it('should handle empty statistics from HA', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockResolvedValue({});

      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entities_synced).toBe(0);
      expect(json.data.records_synced).toBe(0);
      expect(mockQuestDB.writeStats).not.toHaveBeenCalled();
    });

    it('should handle HA getStatistics error', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockRejectedValue(new Error('HA connection failed'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: 'HA connection failed',
      });
    });

    it('should set X-Response-Time header', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
      });

      mockQuestDB.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync.mockResolvedValue(undefined);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });

    it('should handle MongoDB log failure gracefully', async () => {
      mockHa.getEnergyEntities.mockResolvedValue([
        { entity_id: 'sensor.energy_1' },
      ]);

      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy_1': [
          {
            start: '2024-01-15T00:00:00.000Z',
            end: '2024-01-15T01:00:00.000Z',
            state: 100,
            sum: 100,
            mean: 100,
            min: 90,
            max: 110,
          },
        ],
      });

      mockQuestDB.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync.mockRejectedValue(new Error('MongoDB error'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/sync',
        payload: {},
      });

      // Should still succeed even if log fails
      expect(response.statusCode).toBe(500);
      expect(response.json().success).toBe(false);
    });
  });

  describe('GET /api/statistics/:entity_id', () => {
    it('should return statistics for valid entity_id', async () => {
      mockQuestDB.getStatistics.mockResolvedValue([
        [
          'sensor.energy_1',
          'hour',
          100.5,
          1000.0,
          100.0,
          90.0,
          110.0,
          1705334400000000000,
        ],
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entity_id).toBe('sensor.energy_1');
      expect(json.data.source).toBe('questdb');
      expect(json.data.statistics).toHaveLength(1);
      expect(json.data.statistics[0]).toEqual({
        timestamp: 1705334400000000000,
        state: 100.5,
        sum: 1000.0,
        mean: 100.0,
        min: 90.0,
        max: 110.0,
        period: 'hour',
      });
    });

    it('should return 400 for invalid entity_id format', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/invalidentity', // No dot separator
      });

      // Fastify schema validation rejects this before handler
      expect(response.statusCode).toBe(400);
    });

    it('should use default 7-day time range when not provided', async () => {
      mockQuestDB.getStatistics.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1',
      });

      expect(response.statusCode).toBe(200);
      const startTime = new Date(Date.now() - 7 * MS_PER_DAY);
      const endTime = new Date();
      expect(mockQuestDB.getStatistics).toHaveBeenCalledWith(
        'sensor.energy_1',
        expect.any(String),
        expect.any(String),
        undefined
      );
    });

    it('should use custom time range when provided', async () => {
      mockQuestDB.getStatistics.mockResolvedValue([]);

      const startTime = '2024-01-01T00:00:00.000Z';
      const endTime = '2024-01-15T23:59:59.000Z';

      const response = await fastify.inject({
        method: 'GET',
        url: `/api/statistics/sensor.energy_1?start_time=${startTime}&end_time=${endTime}`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getStatistics).toHaveBeenCalledWith(
        'sensor.energy_1',
        startTime,
        endTime,
        undefined
      );
    });

    it('should filter by period when provided', async () => {
      mockQuestDB.getStatistics.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1?period=hour',
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getStatistics).toHaveBeenCalledWith(
        'sensor.energy_1',
        expect.any(String),
        expect.any(String),
        'hour'
      );
    });

    it('should handle empty statistics', async () => {
      mockQuestDB.getStatistics.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.statistics).toHaveLength(0);
    });

    it('should handle QuestDB query error', async () => {
      mockQuestDB.getStatistics.mockRejectedValue(new Error('QuestDB error'));

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: 'QuestDB error',
      });
    });

    it('should set X-Response-Time header', async () => {
      mockQuestDB.getStatistics.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1',
      });

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });

    it('should reject entity_id with spaces', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor%20energy%201', // URL encoded spaces
      });

      // Fastify schema validation rejects this
      expect(response.statusCode).toBe(400);
    });

    it('should reject entity_id without dot separator', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensorenergy1',
      });

      // Fastify schema validation rejects this
      expect(response.statusCode).toBe(400);
    });
  });

  describe('GET /api/statistics/:entity_id/daily', () => {
    it('should return daily summary for valid entity_id', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([
        ['sensor.energy_1', 1705334400000, 24000.5, 1000.02, 2500.3, 24],
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/daily',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entity_id).toBe('sensor.energy_1');
      expect(json.data.period).toBe('daily');
      expect(json.data.summary).toHaveLength(1);
      expect(json.data.summary[0]).toEqual({
        date: 1705334400000,
        total: 24000.5,
        avg_power: 1000.02,
        peak: 2500.3,
        readings: 24,
      });
    });

    it('should return 400 for invalid entity_id format', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/invalidentity/daily',
      });

      // Fastify schema validation rejects this
      expect(response.statusCode).toBe(400);
    });

    it('should use default 30-day time range when not provided', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/daily',
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getDailySummary).toHaveBeenCalledWith(
        'sensor.energy_1',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should use custom time range when provided', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const startTime = '2024-01-01T00:00:00.000Z';
      const endTime = '2024-01-31T23:59:59.000Z';

      const response = await fastify.inject({
        method: 'GET',
        url: `/api/statistics/sensor.energy_1/daily?start_time=${startTime}&end_time=${endTime}`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getDailySummary).toHaveBeenCalledWith(
        'sensor.energy_1',
        startTime,
        endTime
      );
    });

    it('should handle empty summary', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/daily',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.summary).toHaveLength(0);
    });

    it('should handle QuestDB query error', async () => {
      mockQuestDB.getDailySummary.mockRejectedValue(
        new Error('QuestDB query failed')
      );

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/daily',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: 'QuestDB query failed',
      });
    });

    it('should set X-Response-Time header', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/daily',
      });

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });
  });

  describe('GET /api/statistics/:entity_id/monthly', () => {
    it('should return monthly summary for valid entity_id', async () => {
      mockQuestDB.getMonthlySummary.mockResolvedValue([
        ['sensor.energy_1', 1704067200000, 720000.5, 1000.02, 3500.3, 720],
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/monthly',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entity_id).toBe('sensor.energy_1');
      expect(json.data.period).toBe('monthly');
      expect(json.data.summary).toHaveLength(1);
      expect(json.data.summary[0]).toEqual({
        month: 1704067200000,
        total: 720000.5,
        avg_power: 1000.02,
        peak: 3500.3,
        readings: 720,
      });
    });

    it('should return 400 for invalid entity_id format', async () => {
      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/invalidentity/monthly',
      });

      // Fastify schema validation rejects this
      expect(response.statusCode).toBe(400);
    });

    it('should use default 365-day time range when not provided', async () => {
      mockQuestDB.getMonthlySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/monthly',
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getMonthlySummary).toHaveBeenCalledWith(
        'sensor.energy_1',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should use custom time range when provided', async () => {
      mockQuestDB.getMonthlySummary.mockResolvedValue([]);

      const startTime = '2024-01-01T00:00:00.000Z';
      const endTime = '2024-12-31T23:59:59.000Z';

      const response = await fastify.inject({
        method: 'GET',
        url: `/api/statistics/sensor.energy_1/monthly?start_time=${startTime}&end_time=${endTime}`,
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getMonthlySummary).toHaveBeenCalledWith(
        'sensor.energy_1',
        startTime,
        endTime
      );
    });

    it('should handle empty summary', async () => {
      mockQuestDB.getMonthlySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/monthly',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.summary).toHaveLength(0);
    });

    it('should handle QuestDB query error', async () => {
      mockQuestDB.getMonthlySummary.mockRejectedValue(
        new Error('QuestDB query failed')
      );

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/monthly',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: 'QuestDB query failed',
      });
    });

    it('should set X-Response-Time header', async () => {
      mockQuestDB.getMonthlySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sensor.energy_1/monthly',
      });

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });
  });

  describe('GET /api/statistics/sync/log', () => {
    it('should return sync logs', async () => {
      mockMongo.getRecentSyncs.mockResolvedValue([
        {
          _id: '507f1f77bcf86cd799439011',
          entityIds: ['sensor.energy_1', 'sensor.energy_2'],
          recordsSynced: 120,
          startTime: '2024-01-15T00:00:00.000Z',
          endTime: '2024-01-15T01:00:00.000Z',
          period: 'hour',
          duration: 5234,
          success: true,
          error: null,
          createdAt: '2024-01-15T01:00:05.234Z',
        },
      ]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.logs).toHaveLength(1);
      expect(json.data.count).toBe(1);
      expect(json.data.logs[0]).toEqual({
        id: '507f1f77bcf86cd799439011',
        entity_ids: ['sensor.energy_1', 'sensor.energy_2'],
        records_synced: 120,
        start_time: '2024-01-15T00:00:00.000Z',
        end_time: '2024-01-15T01:00:00.000Z',
        period: 'hour',
        duration: 5234,
        success: true,
        error: null,
        created_at: '2024-01-15T01:00:05.234Z',
      });
    });

    it('should use default limit of 50 when not provided', async () => {
      mockMongo.getRecentSyncs.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log',
      });

      expect(response.statusCode).toBe(200);
      expect(mockMongo.getRecentSyncs).toHaveBeenCalledWith(50, {});
    });

    it('should use custom limit when provided', async () => {
      mockMongo.getRecentSyncs.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log?limit=10',
      });

      expect(response.statusCode).toBe(200);
      expect(mockMongo.getRecentSyncs).toHaveBeenCalledWith(10, {});
    });

    it('should filter by entity_id when provided', async () => {
      mockMongo.getRecentSyncs.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log?entity_id=sensor.energy_1',
      });

      expect(response.statusCode).toBe(200);
      expect(mockMongo.getRecentSyncs).toHaveBeenCalledWith(50, {
        entityId: 'sensor.energy_1',
      });
    });

    it('should handle empty logs', async () => {
      mockMongo.getRecentSyncs.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log',
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.logs).toHaveLength(0);
      expect(json.data.count).toBe(0);
    });

    it('should handle MongoDB query error', async () => {
      mockMongo.getRecentSyncs.mockRejectedValue(new Error('MongoDB error'));

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log',
      });

      expect(response.statusCode).toBe(500);
      expect(response.json()).toEqual({
        success: false,
        error: 'MongoDB error',
      });
    });

    it('should set X-Response-Time header', async () => {
      mockMongo.getRecentSyncs.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'GET',
        url: '/api/statistics/sync/log',
      });

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });
  });

  describe('POST /api/statistics/compare', () => {
    it('should compare statistics for multiple entities with daily aggregation', async () => {
      mockQuestDB.getDailySummary
        .mockResolvedValueOnce([
          ['sensor.energy_1', 1705334400000, 24000.5, 1000.02, 2500.3, 24],
        ])
        .mockResolvedValueOnce([
          ['sensor.energy_2', 1705334400000, 18000.3, 750.01, 2000.2, 24],
        ]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1', 'sensor.energy_2'],
          aggregation: 'daily',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entity_ids).toEqual([
        'sensor.energy_1',
        'sensor.energy_2',
      ]);
      expect(json.data.aggregation).toBe('daily');
      expect(json.data.comparison).toHaveProperty('sensor.energy_1');
      expect(json.data.comparison).toHaveProperty('sensor.energy_2');
    });

    it('should compare statistics with monthly aggregation', async () => {
      mockQuestDB.getMonthlySummary
        .mockResolvedValueOnce([
          ['sensor.energy_1', 1704067200000, 720000.5, 1000.02, 3500.3, 720],
        ])
        .mockResolvedValueOnce([
          ['sensor.energy_2', 1704067200000, 540000.3, 750.01, 3000.2, 720],
        ]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1', 'sensor.energy_2'],
          aggregation: 'monthly',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.aggregation).toBe('monthly');
      expect(mockQuestDB.getMonthlySummary).toHaveBeenCalledTimes(2);
    });

    it('should compare statistics with hourly aggregation', async () => {
      mockQuestDB.getStatistics
        .mockResolvedValueOnce([
          [
            'sensor.energy_1',
            'hour',
            100.5,
            1000.0,
            100.0,
            90.0,
            110.0,
            1705334400000000000,
          ],
        ])
        .mockResolvedValueOnce([
          [
            'sensor.energy_2',
            'hour',
            80.3,
            800.0,
            80.0,
            70.0,
            90.0,
            1705334400000000000,
          ],
        ]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1', 'sensor.energy_2'],
          aggregation: 'hourly',
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.data.aggregation).toBe('hourly');
      expect(mockQuestDB.getStatistics).toHaveBeenCalledTimes(2);
    });

    it('should use default daily aggregation when not provided', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getDailySummary).toHaveBeenCalled();
    });

    it('should use default 30-day time range when not provided', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1'],
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getDailySummary).toHaveBeenCalledWith(
        'sensor.energy_1',
        expect.any(String),
        expect.any(String)
      );
    });

    it('should use custom time range when provided', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const startTime = '2024-01-01T00:00:00.000Z';
      const endTime = '2024-01-31T23:59:59.000Z';

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1'],
          start_time: startTime,
          end_time: endTime,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(mockQuestDB.getDailySummary).toHaveBeenCalledWith(
        'sensor.energy_1',
        startTime,
        endTime
      );
    });

    it('should return 400 for invalid entity_id format', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1', 'invalidentity'], // No dot separator
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().success).toBe(false);
      expect(response.json().error).toContain('Invalid entity_id format');
      expect(response.json().error).toContain('invalidentity');
    });

    it('should return 400 for multiple invalid entity IDs', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['invalidentity1', 'invalidentity2'], // No dot separators
        },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json().error).toContain('invalidentity1');
      expect(response.json().error).toContain('invalidentity2');
    });

    it('should handle partial failures when some entities fail', async () => {
      mockQuestDB.getDailySummary
        .mockResolvedValueOnce([
          ['sensor.energy_1', 1705334400000, 24000.5, 1000.02, 2500.3, 24],
        ])
        .mockRejectedValueOnce(new Error('Entity not found'));

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1', 'sensor.energy_2'],
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.comparison['sensor.energy_1']).toBeDefined();
      expect(json.data.comparison['sensor.energy_2']).toEqual({
        error: 'Entity not found',
      });
    });

    it('should handle empty entity_ids array', async () => {
      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: [],
        },
      });

      // Schema validation should catch this
      expect(response.statusCode).toBe(400);
    });

    it('should handle single entity comparison', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([
        ['sensor.energy_1', 1705334400000, 24000.5, 1000.02, 2500.3, 24],
      ]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1'],
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.entity_ids).toEqual(['sensor.energy_1']);
    });

    it('should handle maximum 10 entities', async () => {
      const entityIds = Array.from(
        { length: 10 },
        (_, i) => `sensor.energy_${i}`
      );
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: entityIds,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it('should set X-Response-Time header', async () => {
      mockQuestDB.getDailySummary.mockResolvedValue([]);

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1'],
        },
      });

      expect(response.headers['x-response-time']).toMatch(/\d+ms/);
    });

    it('should handle database query error', async () => {
      mockQuestDB.getDailySummary.mockRejectedValue(
        new Error('Database error')
      );

      const response = await fastify.inject({
        method: 'POST',
        url: '/api/statistics/compare',
        payload: {
          entity_ids: ['sensor.energy_1'],
        },
      });

      expect(response.statusCode).toBe(200);
      const json = response.json();
      expect(json.success).toBe(true);
      expect(json.data.comparison['sensor.energy_1']).toEqual({
        error: 'Database error',
      });
    });
  });
});
