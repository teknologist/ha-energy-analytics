/**
 * Unit tests for insights.js route handlers
 * Tests all route handlers directly with mocked dependencies
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import insightsRoutes from '../../routes/insights.js';

// Mock fastify instance with all required decorators
const createMockFastify = () => ({
  get: vi.fn(),
  log: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  mongo: {
    getEntities: vi.fn(),
  },
  questdb: {
    query: vi.fn(),
    sanitize: {
      timestamp: vi.fn((ts) => ts), // passthrough for tests
      limit: vi.fn((limit, max) =>
        Math.min(Math.max(1, parseInt(limit, 10) || 1), max)
      ),
    },
  },
});

// Mock reply object
const createMockReply = () => {
  const reply = {
    code: vi.fn(() => reply),
    send: vi.fn(() => reply),
    header: vi.fn(() => reply),
  };
  return reply;
};

// Mock request object
const createMockRequest = (query = {}) => ({
  query,
});

describe('insights.js - Route Handlers', () => {
  let mockFastify;
  let mockReply;
  let mockRequest;

  beforeEach(() => {
    mockFastify = createMockFastify();
    mockReply = createMockReply();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/insights/top-consumers', () => {
    let handler;

    beforeEach(async () => {
      // Register the route
      await insightsRoutes(mockFastify);

      // Get the handler that was registered
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2]; // The handler is the third argument
    });

    it('should return top consumers with enriched metadata', async () => {
      mockRequest = createMockRequest({ period: 'week', limit: 3 });

      const dataset = [
        ['sensor.energy_1', 500.5],
        ['sensor.power_1', 250.25],
        ['sensor.battery_1', 100.0],
      ];

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset }) // Top consumers query
        .mockResolvedValueOnce({ dataset: [[850.75]] }); // Total query

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.energy_1',
          friendlyName: 'Energy 1',
          unitOfMeasurement: 'kWh',
        },
        {
          entityId: 'sensor.power_1',
          friendlyName: 'Power 1',
          unitOfMeasurement: 'W',
        },
        {
          entityId: 'sensor.battery_1',
          friendlyName: 'Battery 1',
          unitOfMeasurement: 'Wh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(result.data.period).toBe('week');
      expect(result.data.total_consumption).toBe(850.75);
      expect(result.data.top_consumers).toHaveLength(3);
      expect(result.data.top_consumers[0]).toMatchObject({
        entity_id: 'sensor.energy_1',
        friendly_name: 'Energy 1',
        consumption: 500.5,
        unit_of_measurement: 'kWh',
      });
      expect(result.data.top_consumers[0].percentage).toBeCloseTo(58.83, 2);
      expect(mockReply.header).toHaveBeenCalledWith(
        'X-Response-Time',
        expect.any(String)
      );
    });

    it('should use entityId as fallback when entity not in map', async () => {
      mockRequest = createMockRequest({ period: 'day', limit: 2 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.unknown', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.top_consumers).toHaveLength(1);
      expect(result.data.top_consumers[0].friendly_name).toBe('sensor.unknown');
      expect(result.data.top_consumers[0].unit_of_measurement).toBe('kWh'); // fallback
    });

    it('should handle empty dataset', async () => {
      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [] })
        .mockResolvedValueOnce({ dataset: [[0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.top_consumers).toHaveLength(0);
      expect(result.data.total_consumption).toBe(0);
    });

    it('should calculate percentage as 0 when total is 0', async () => {
      mockRequest = createMockRequest({ period: 'day', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 50.0]] })
        .mockResolvedValueOnce({ dataset: [[0]] }); // Total is 0

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.top_consumers[0].percentage).toBe(0);
    });

    it('should handle percentage when total is null/undefined', async () => {
      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 50.0]] })
        .mockResolvedValueOnce({ dataset: [] }); // No total result

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.top_consumers[0].percentage).toBe(0);
    });

    it('should validate limit parameter and clamp to max', async () => {
      mockRequest = createMockRequest({ period: 'week', limit: 25 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      // Verify the SQL uses the clamped limit
      const sql = mockFastify.questdb.query.mock.calls[0][0];
      expect(sql).toContain('LIMIT 20'); // Clamped to max
    });

    it('should handle all valid periods', async () => {
      const periods = ['day', 'week', 'month'];

      for (const period of periods) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/insights/top-consumers'
        );
        handler = routeCall[2];

        mockRequest = createMockRequest({ period, limit: 5 });

        mockFastify.questdb.query
          .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
          .mockResolvedValueOnce({ dataset: [[100.0]] });

        mockFastify.mongo.getEntities.mockResolvedValue([
          {
            entityId: 'sensor.test',
            friendlyName: 'Test',
            unitOfMeasurement: 'kWh',
          },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.period).toBe(period);
        expect(result.data.time_range).toBeDefined();
      }
    });

    it('should return 500 on database error', async () => {
      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query.mockRejectedValue(
        new Error('Database connection failed')
      );

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Database connection failed',
      });
      expect(mockFastify.log.error).toHaveBeenCalled();
    });

    it('should return 500 on validatePeriod error', async () => {
      mockRequest = createMockRequest({ period: 'invalid', limit: 5 });

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid period: invalid. Must be one of: day, week, month',
      });
      expect(mockFastify.log.error).toHaveBeenCalled();
    });

    it('should sanitize timestamps in SQL queries', async () => {
      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      // Verify timestamp sanitization was called
      expect(mockFastify.questdb.sanitize.timestamp).toHaveBeenCalled();
    });
  });

  describe('GET /api/insights/peak', () => {
    let handler;

    beforeEach(async () => {
      await insightsRoutes(mockFastify);
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/peak'
      );
      handler = routeCall[2];
    });

    it('should return peak consumption with enriched data', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [['sensor.energy_1', 2500.5, 1705334400000]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.energy_1',
          friendlyName: 'Energy 1',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(result.data.peak).toMatchObject({
        entity_id: 'sensor.energy_1',
        friendly_name: 'Energy 1',
        value: 2500.5,
        unit: 'kWh',
        timestamp: 1705334400000,
      });
    });

    it('should return null when no peak data available', async () => {
      mockRequest = createMockRequest({ period: 'day' });

      mockFastify.questdb.query.mockResolvedValue({ dataset: [] });

      const result = await handler(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(result.data.peak).toBeNull();
    });

    it('should use entityId fallback when entity not found', async () => {
      mockRequest = createMockRequest({ period: 'month' });

      mockFastify.questdb.query.mockResolvedValue({
        dataset: [['sensor.unknown', 1000.0, 1705334400000]],
      });

      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.peak.friendly_name).toBe('sensor.unknown');
      expect(result.data.peak.unit).toBe('kWh'); // fallback
    });

    it('should handle all valid periods', async () => {
      const periods = ['day', 'week', 'month'];

      for (const period of periods) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/insights/peak'
        );
        handler = routeCall[2];

        mockRequest = createMockRequest({ period });

        mockFastify.questdb.query.mockResolvedValue({
          dataset: [['sensor.test', 500.0, 1705334400000]],
        });

        mockFastify.mongo.getEntities.mockResolvedValue([
          {
            entityId: 'sensor.test',
            friendlyName: 'Test',
            unitOfMeasurement: 'kWh',
          },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.period).toBe(period);
        expect(result.data.peak).toBeDefined();
      }
    });

    it('should return 500 on database error', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockRejectedValue(new Error('Query failed'));

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Query failed',
      });
      expect(mockFastify.log.error).toHaveBeenCalled();
    });

    it('should sanitize timestamps in SQL query', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockResolvedValue({
        dataset: [['sensor.test', 500.0, 1705334400000]],
      });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      expect(mockFastify.questdb.sanitize.timestamp).toHaveBeenCalled();
    });

    it('should handle validatePeriod error', async () => {
      mockRequest = createMockRequest({ period: 'invalid' });

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid period: invalid. Must be one of: day, week, month',
      });
    });
  });

  describe('GET /api/insights/patterns', () => {
    let handler;

    beforeEach(async () => {
      await insightsRoutes(mockFastify);
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/patterns'
      );
      handler = routeCall[2];
    });

    it('should classify consumers as burst when variance exceeds threshold', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [
        ['sensor.hvac', 500.5, 0.8, 2.5], // variance > 0.5, peak_to_avg > 2.0
        ['sensor.lights', 100.2, 0.3, 1.5], // both below threshold
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.hvac', friendlyName: 'HVAC' },
        { entityId: 'sensor.lights', friendlyName: 'Lights' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(result.data.burst_consumers).toHaveLength(1);
      expect(result.data.steady_consumers).toHaveLength(1);
      expect(result.data.burst_consumers[0].entity_id).toBe('sensor.hvac');
      expect(result.data.steady_consumers[0].entity_id).toBe('sensor.lights');
    });

    it('should classify consumers as burst when peak_to_avg exceeds threshold', async () => {
      mockRequest = createMockRequest({ period: 'day' });

      const dataset = [
        ['sensor.appliance', 300.0, 0.3, 2.8], // peak_to_avg > 2.0
        ['sensor.fridge', 150.0, 0.2, 1.2],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.appliance', friendlyName: 'Appliance' },
        { entityId: 'sensor.fridge', friendlyName: 'Fridge' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.burst_consumers).toHaveLength(1);
      expect(result.data.steady_consumers).toHaveLength(1);
    });

    it('should classify as steady when both thresholds not exceeded', async () => {
      mockRequest = createMockRequest({ period: 'month' });

      const dataset = [
        ['sensor.fan', 100.0, 0.3, 1.5],
        ['sensor.tv', 200.0, 0.4, 1.8],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.fan', friendlyName: 'Fan' },
        { entityId: 'sensor.tv', friendlyName: 'TV' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.burst_consumers).toHaveLength(0);
      expect(result.data.steady_consumers).toHaveLength(2);
    });

    it('should handle empty dataset', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockResolvedValue({ dataset: [] });
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.burst_consumers).toHaveLength(0);
      expect(result.data.steady_consumers).toHaveLength(0);
    });

    it('should use entityId fallback when entity not in map', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [['sensor.unknown', 100.0, 0.6, 1.5]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.burst_consumers[0].friendly_name).toBe(
        'sensor.unknown'
      );
    });

    it('should handle all valid periods', async () => {
      const periods = ['day', 'week', 'month'];

      for (const period of periods) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/insights/patterns'
        );
        handler = routeCall[2];

        mockRequest = createMockRequest({ period });

        mockFastify.questdb.query.mockResolvedValue({
          dataset: [['sensor.test', 100.0, 0.3, 1.5]],
        });

        mockFastify.mongo.getEntities.mockResolvedValue([
          { entityId: 'sensor.test', friendlyName: 'Test' },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.period).toBe(period);
      }
    });

    it('should return 500 on database error', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockRejectedValue(new Error('Query error'));

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Query error',
      });
    });

    it('should include variance and peak_to_avg_ratio in response', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [['sensor.test', 100.0, 0.6, 2.5]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.test', friendlyName: 'Test' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.burst_consumers[0]).toMatchObject({
        avg_consumption: 100.0,
        variance: 0.6,
        peak_to_avg_ratio: 2.5,
      });
    });

    it('should sanitize timestamps in SQL query', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockResolvedValue({
        dataset: [['sensor.test', 100.0, 0.3, 1.5]],
      });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.test', friendlyName: 'Test' },
      ]);

      await handler(mockRequest, mockReply);

      expect(mockFastify.questdb.sanitize.timestamp).toHaveBeenCalled();
    });
  });

  describe('GET /api/insights/breakdown', () => {
    let handler;

    beforeEach(async () => {
      await insightsRoutes(mockFastify);
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/breakdown'
      );
      handler = routeCall[2];
    });

    it('should return consumption breakdown with percentages', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [
        ['sensor.energy_1', 500],
        ['sensor.power_1', 500],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.energy_1',
          friendlyName: 'Energy 1',
          unitOfMeasurement: 'kWh',
        },
        {
          entityId: 'sensor.power_1',
          friendlyName: 'Power 1',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(result.data.total_consumption).toBe(1000);
      expect(result.data.breakdown).toHaveLength(2);
      expect(result.data.breakdown[0].percentage).toBe(50);
      expect(result.data.breakdown[1].percentage).toBe(50);
    });

    it('should handle empty dataset', async () => {
      mockRequest = createMockRequest({ period: 'day' });

      mockFastify.questdb.query.mockResolvedValue({ dataset: [] });
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.total_consumption).toBe(0);
      expect(result.data.breakdown).toHaveLength(0);
    });

    it('should calculate percentage as 0 when total is 0', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [['sensor.test', 50.0]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      // Mock reduce to return 0
      const originalReduce = Array.prototype.reduce;
      Array.prototype.reduce = vi.fn(() => 0);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.breakdown[0].percentage).toBe(0);

      Array.prototype.reduce = originalReduce;
    });

    it('should handle null/undefined consumption values', async () => {
      mockRequest = createMockRequest({ period: 'month' });

      const dataset = [
        ['sensor.test', null],
        ['sensor.test2', undefined],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
        {
          entityId: 'sensor.test2',
          friendlyName: 'Test2',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.total_consumption).toBe(0);
    });

    it('should use entityId fallback when entity not found', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [['sensor.unknown', 100.0]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.breakdown[0].friendly_name).toBe('sensor.unknown');
      expect(result.data.breakdown[0].unit_of_measurement).toBe('kWh');
    });

    it('should handle all valid periods', async () => {
      const periods = ['day', 'week', 'month'];

      for (const period of periods) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/insights/breakdown'
        );
        handler = routeCall[2];

        mockRequest = createMockRequest({ period });

        mockFastify.questdb.query.mockResolvedValue({
          dataset: [['sensor.test', 100.0]],
        });

        mockFastify.mongo.getEntities.mockResolvedValue([
          {
            entityId: 'sensor.test',
            friendlyName: 'Test',
            unitOfMeasurement: 'kWh',
          },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.period).toBe(period);
      }
    });

    it('should return 500 on database error', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockRejectedValue(new Error('DB error'));

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'DB error',
      });
    });

    it('should order breakdown by consumption DESC', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [
        ['sensor.low', 50],
        ['sensor.high', 500],
        ['sensor.medium', 200],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.low',
          friendlyName: 'Low',
          unitOfMeasurement: 'kWh',
        },
        {
          entityId: 'sensor.high',
          friendlyName: 'High',
          unitOfMeasurement: 'kWh',
        },
        {
          entityId: 'sensor.medium',
          friendlyName: 'Medium',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      // The SQL already orders by DESC, so the result should maintain order
      expect(result.data.breakdown[0].entity_id).toBe('sensor.low');
      expect(result.data.breakdown[1].entity_id).toBe('sensor.high');
      expect(result.data.breakdown[2].entity_id).toBe('sensor.medium');
    });

    it('should sanitize timestamps in SQL query', async () => {
      mockRequest = createMockRequest({ period: 'week' });

      mockFastify.questdb.query.mockResolvedValue({
        dataset: [['sensor.test', 100.0]],
      });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      expect(mockFastify.questdb.sanitize.timestamp).toHaveBeenCalled();
    });
  });

  describe('GET /api/insights/timeline', () => {
    let handler;

    beforeEach(async () => {
      await insightsRoutes(mockFastify);
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/timeline'
      );
      handler = routeCall[2];
    });

    it('should return timeline grouped by time bucket', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'hour' });

      const dataset = [
        [1705334400000, 'sensor.energy_1', 100.5],
        [1705334400000, 'sensor.power_1', 50.25],
        [1705338000000, 'sensor.energy_1', 75.0],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.energy_1', friendlyName: 'Energy 1' },
        { entityId: 'sensor.power_1', friendlyName: 'Power 1' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.success).toBe(true);
      expect(result.data.group_by).toBe('hour');
      expect(result.data.timeline).toHaveLength(2);
      expect(result.data.timeline[0].time).toBe(1705334400000);
      expect(result.data.timeline[0].total).toBe(150.75);
      expect(Object.keys(result.data.timeline[0].breakdown)).toHaveLength(2);
      expect(result.data.timeline[1].total).toBe(75.0);
    });

    it('should validate group_by parameter', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'invalid' });

      const result = await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(400);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid group_by: invalid. Must be one of: hour, day',
      });
    });

    it('should accept valid group_by values', async () => {
      const groupByValues = ['hour', 'day'];

      for (const groupBy of groupByValues) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/insights/timeline'
        );
        handler = routeCall[2];

        mockRequest = createMockRequest({ period: 'week', group_by: groupBy });

        mockFastify.questdb.query.mockResolvedValue({
          dataset: [[1705334400000, 'sensor.test', 100.0]],
        });

        mockFastify.mongo.getEntities.mockResolvedValue([
          { entityId: 'sensor.test', friendlyName: 'Test' },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.group_by).toBe(groupBy);
      }
    });

    it('should handle empty dataset', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'hour' });

      mockFastify.questdb.query.mockResolvedValue({ dataset: [] });
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.timeline).toHaveLength(0);
    });

    it('should use entityId fallback when entity not found', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'hour' });

      const dataset = [[1705334400000, 'sensor.unknown', 100.0]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(
        result.data.timeline[0].breakdown['sensor.unknown'].friendly_name
      ).toBe('sensor.unknown');
    });

    it('should handle all valid periods', async () => {
      const periods = ['day', 'week', 'month'];

      for (const period of periods) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/insights/timeline'
        );
        handler = routeCall[2];

        mockRequest = createMockRequest({ period, group_by: 'hour' });

        mockFastify.questdb.query.mockResolvedValue({
          dataset: [[1705334400000, 'sensor.test', 100.0]],
        });

        mockFastify.mongo.getEntities.mockResolvedValue([
          { entityId: 'sensor.test', friendlyName: 'Test' },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.period).toBe(period);
      }
    });

    it('should return 500 on database error', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'hour' });

      mockFastify.questdb.query.mockRejectedValue(new Error('Query failed'));

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'Query failed',
      });
    });

    it('should sanitize timestamps in SQL query', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'hour' });

      mockFastify.questdb.query.mockResolvedValue({
        dataset: [[1705334400000, 'sensor.test', 100.0]],
      });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.test', friendlyName: 'Test' },
      ]);

      await handler(mockRequest, mockReply);

      expect(mockFastify.questdb.sanitize.timestamp).toHaveBeenCalled();
    });

    it('should accumulate consumption for same time bucket', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'hour' });

      const dataset = [
        [1705334400000, 'sensor.entity1', 50.0],
        [1705334400000, 'sensor.entity2', 30.0],
        [1705334400000, 'sensor.entity3', 20.0],
      ];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.entity1', friendlyName: 'Entity 1' },
        { entityId: 'sensor.entity2', friendlyName: 'Entity 2' },
        { entityId: 'sensor.entity3', friendlyName: 'Entity 3' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.timeline).toHaveLength(1);
      expect(result.data.timeline[0].total).toBe(100.0);
      expect(Object.keys(result.data.timeline[0].breakdown)).toHaveLength(3);
    });

    it('should include friendly names in breakdown', async () => {
      mockRequest = createMockRequest({ period: 'week', group_by: 'day' });

      const dataset = [[1705334400000, 'sensor.test', 100.0]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.test', friendlyName: 'Test Entity' },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.timeline[0].breakdown['sensor.test']).toMatchObject({
        consumption: 100.0,
        friendly_name: 'Test Entity',
      });
    });
  });

  describe('Edge Cases and Error Handling', () => {
    let handler;

    beforeEach(async () => {
      await insightsRoutes(mockFastify);
    });

    it('should handle validateLimit edge cases', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2];

      // Test NaN
      mockRequest = createMockRequest({ period: 'week', limit: NaN });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      // Should use 1 as default for NaN
      const sql = mockFastify.questdb.query.mock.calls[0][0];
      expect(sql).toContain('LIMIT 1');
    });

    it('should handle negative limit values', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2];

      mockRequest = createMockRequest({ period: 'week', limit: -5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      // Should clamp to 1
      const sql = mockFastify.questdb.query.mock.calls[0][0];
      expect(sql).toContain('LIMIT 1');
    });

    it('should handle very large limit values', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2];

      mockRequest = createMockRequest({ period: 'week', limit: 9999 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      // Should clamp to max of 20
      const sql = mockFastify.questdb.query.mock.calls[0][0];
      expect(sql).toContain('LIMIT 20');
    });

    it('should set X-Response-Time header on success', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2];

      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      await handler(mockRequest, mockReply);

      expect(mockReply.header).toHaveBeenCalledWith(
        'X-Response-Time',
        expect.stringMatching(/^\d+ms$/)
      );
    });

    it('should handle mongo.getEntities returning empty array', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2];

      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.unknown', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.top_consumers[0].friendly_name).toBe('sensor.unknown');
      expect(result.data.top_consumers[0].unit_of_measurement).toBe('kWh');
    });

    it('should handle mongo.getEntities throwing error', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/top-consumers'
      );
      handler = routeCall[2];

      mockRequest = createMockRequest({ period: 'week', limit: 5 });

      mockFastify.questdb.query
        .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
        .mockResolvedValueOnce({ dataset: [[100.0]] });

      mockFastify.mongo.getEntities.mockRejectedValue(
        new Error('MongoDB error')
      );

      await handler(mockRequest, mockReply);

      expect(mockReply.code).toHaveBeenCalledWith(500);
      expect(mockReply.send).toHaveBeenCalledWith({
        success: false,
        error: 'MongoDB error',
      });
    });

    it('should handle dataset with null values', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/insights/breakdown'
      );
      handler = routeCall[2];

      mockRequest = createMockRequest({ period: 'week' });

      const dataset = [['sensor.test', null]];

      mockFastify.questdb.query.mockResolvedValue({ dataset });

      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.test',
          friendlyName: 'Test',
          unitOfMeasurement: 'kWh',
        },
      ]);

      const result = await handler(mockRequest, mockReply);

      expect(result.data.total_consumption).toBe(0);
    });
  });

  describe('Helper Function Integration', () => {
    let handler;

    beforeEach(async () => {
      await insightsRoutes(mockFastify);
    });

    it('should call validatePeriod for all endpoints', async () => {
      const endpoints = [
        {
          path: '/api/insights/top-consumers',
          query: { period: 'week', limit: 5 },
        },
        { path: '/api/insights/peak', query: { period: 'week' } },
        { path: '/api/insights/patterns', query: { period: 'week' } },
        { path: '/api/insights/breakdown', query: { period: 'week' } },
        {
          path: '/api/insights/timeline',
          query: { period: 'week', group_by: 'hour' },
        },
      ];

      for (const endpoint of endpoints) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === endpoint.path
        );
        handler = routeCall[2];

        mockRequest = createMockRequest(endpoint.query);

        if (endpoint.path === '/api/insights/top-consumers') {
          mockFastify.questdb.query
            .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
            .mockResolvedValueOnce({ dataset: [[100.0]] });
        } else if (endpoint.path === '/api/insights/peak') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [['sensor.test', 100.0, 1705334400000]],
          });
        } else if (endpoint.path === '/api/insights/patterns') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [['sensor.test', 100.0, 0.3, 1.5]],
          });
        } else if (endpoint.path === '/api/insights/breakdown') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [['sensor.test', 100.0]],
          });
        } else if (endpoint.path === '/api/insights/timeline') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [[1705334400000, 'sensor.test', 100.0]],
          });
        }

        mockFastify.mongo.getEntities.mockResolvedValue([
          {
            entityId: 'sensor.test',
            friendlyName: 'Test',
            unitOfMeasurement: 'kWh',
          },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.period).toBe('week');
      }
    });

    it('should call getTimeRange for all endpoints', async () => {
      const endpoints = [
        {
          path: '/api/insights/top-consumers',
          query: { period: 'day', limit: 5 },
        },
        { path: '/api/insights/peak', query: { period: 'month' } },
        { path: '/api/insights/patterns', query: { period: 'week' } },
        { path: '/api/insights/breakdown', query: { period: 'day' } },
      ];

      for (const endpoint of endpoints) {
        vi.clearAllMocks();
        mockFastify = createMockFastify();
        mockReply = createMockReply();
        await insightsRoutes(mockFastify);

        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === endpoint.path
        );
        handler = routeCall[2];

        mockRequest = createMockRequest(endpoint.query);

        if (endpoint.path === '/api/insights/top-consumers') {
          mockFastify.questdb.query
            .mockResolvedValueOnce({ dataset: [['sensor.test', 100.0]] })
            .mockResolvedValueOnce({ dataset: [[100.0]] });
        } else if (endpoint.path === '/api/insights/peak') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [['sensor.test', 100.0, 1705334400000]],
          });
        } else if (endpoint.path === '/api/insights/patterns') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [['sensor.test', 100.0, 0.3, 1.5]],
          });
        } else if (endpoint.path === '/api/insights/breakdown') {
          mockFastify.questdb.query.mockResolvedValue({
            dataset: [['sensor.test', 100.0]],
          });
        }

        mockFastify.mongo.getEntities.mockResolvedValue([
          {
            entityId: 'sensor.test',
            friendlyName: 'Test',
            unitOfMeasurement: 'kWh',
          },
        ]);

        const result = await handler(mockRequest, mockReply);

        expect(result.success).toBe(true);
        expect(result.data.time_range).toBeDefined();
        expect(result.data.time_range.start).toBeDefined();
        expect(result.data.time_range.end).toBeDefined();
      }
    });
  });
});
