/**
 * Unit tests for root.js routes
 * Tests /api/health and /api/status endpoints
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import rootRoutes from '../../routes/root.js';

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
    healthCheck: vi.fn(),
    getEntities: vi.fn(),
    getStats: vi.fn(),
    getSyncStats: vi.fn(),
  },
  questdb: {
    isConnected: vi.fn(),
  },
  ha: {
    isConnected: vi.fn(),
  },
});

// Mock reply object
const createMockReply = () => {
  const reply = {
    code: vi.fn(function () {
      return this;
    }),
    send: vi.fn(function () {
      return this;
    }),
  };
  return reply;
};

// Mock request object
const createMockRequest = () => ({});

describe('root.js - Routes', () => {
  let mockFastify;
  let mockReply;
  let mockRequest;

  beforeEach(() => {
    mockFastify = createMockFastify();
    mockReply = createMockReply();
    mockRequest = createMockRequest();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/health', () => {
    let handler;

    beforeEach(async () => {
      // Register the route
      await rootRoutes(mockFastify);

      // Get the handler that was registered
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/health'
      );
      handler = routeCall[2]; // The handler is the third argument
    });

    it('should register /api/health route with correct schema', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/health'
      );
      expect(routeCall).toBeDefined();
      expect(routeCall[1]).toMatchObject({
        schema: {
          description: 'Health check endpoint',
          tags: ['system'],
          response: expect.any(Object),
        },
      });
    });

    describe('when all services are healthy', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: true,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        });
        mockFastify.questdb.isConnected.mockReturnValue(true);
        mockFastify.ha.isConnected.mockReturnValue(true);
      });

      it('should return 200 with ok status', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result).toMatchObject({
          status: 'ok',
          homeAssistant: true,
          mongodb: true,
          questdb: true,
          timestamp: expect.any(String),
        });
        expect(mockReply.code).not.toHaveBeenCalled();
      });

      it('should call mongo.healthCheck', async () => {
        await handler(mockRequest, mockReply);

        expect(mockFastify.mongo.healthCheck).toHaveBeenCalledOnce();
      });

      it('should call questdb.isConnected', async () => {
        await handler(mockRequest, mockReply);

        expect(mockFastify.questdb.isConnected).toHaveBeenCalledOnce();
      });

      it('should call ha.isConnected', async () => {
        await handler(mockRequest, mockReply);

        expect(mockFastify.ha.isConnected).toHaveBeenCalledOnce();
      });

      it('should return ISO timestamp', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.timestamp).toMatch(
          /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        );
      });
    });

    describe('when MongoDB is unhealthy', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: false,
          error: 'Connection failed',
          timestamp: new Date('2024-01-01T00:00:00Z'),
        });
        mockFastify.questdb.isConnected.mockReturnValue(true);
        mockFastify.ha.isConnected.mockReturnValue(true);
      });

      it('should return 503 with degraded status', async () => {
        await handler(mockRequest, mockReply);

        expect(mockReply.code).toHaveBeenCalledWith(503);
        expect(mockReply.send).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'degraded',
            mongodb: false,
          })
        );
      });

      it('should still report other service statuses', async () => {
        await handler(mockRequest, mockReply);

        expect(mockReply.send).toHaveBeenCalledWith(
          expect.objectContaining({
            homeAssistant: true,
            questdb: true,
          })
        );
      });
    });

    describe('when QuestDB is disconnected', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: true,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        });
        mockFastify.questdb.isConnected.mockReturnValue(false);
        mockFastify.ha.isConnected.mockReturnValue(true);
      });

      it('should return 503 with degraded status', async () => {
        await handler(mockRequest, mockReply);

        expect(mockReply.code).toHaveBeenCalledWith(503);
        expect(mockReply.send).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'degraded',
            questdb: false,
          })
        );
      });
    });

    describe('when both core services are unhealthy', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: false,
          error: 'Connection failed',
        });
        mockFastify.questdb.isConnected.mockReturnValue(false);
        mockFastify.ha.isConnected.mockReturnValue(false);
      });

      it('should return 503 with all services false', async () => {
        await handler(mockRequest, mockReply);

        expect(mockReply.code).toHaveBeenCalledWith(503);
        expect(mockReply.send).toHaveBeenCalledWith(
          expect.objectContaining({
            status: 'degraded',
            homeAssistant: false,
            mongodb: false,
            questdb: false,
          })
        );
      });
    });

    describe('when questdb is undefined', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: true,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        });
        mockFastify.questdb = undefined;
        mockFastify.ha.isConnected.mockReturnValue(true);
      });

      it('should handle undefined questdb gracefully', async () => {
        // Re-register route with undefined questdb
        await rootRoutes(mockFastify);
        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/health'
        );
        const handler = routeCall[2];

        await handler(mockRequest, mockReply);

        expect(mockReply.send).toHaveBeenCalledWith(
          expect.objectContaining({
            questdb: false,
          })
        );
      });
    });

    describe('when ha is undefined', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: true,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        });
        mockFastify.questdb.isConnected.mockReturnValue(true);
        mockFastify.ha = undefined;
      });

      it('should handle undefined ha gracefully', async () => {
        // Re-register route with undefined ha
        await rootRoutes(mockFastify);
        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/health'
        );
        const handler = routeCall[2];

        const result = await handler(mockRequest, mockReply);

        expect(result.homeAssistant).toBe(false);
        expect(result.mongodb).toBe(true);
        expect(result.questdb).toBe(true);
      });
    });

    describe('when both MongoDB and QuestDB are healthy but HA is not', () => {
      beforeEach(() => {
        mockFastify.mongo.healthCheck.mockResolvedValue({
          healthy: true,
          timestamp: new Date('2024-01-01T00:00:00Z'),
        });
        mockFastify.questdb.isConnected.mockReturnValue(true);
        mockFastify.ha.isConnected.mockReturnValue(false);
      });

      it('should return 200 since core services are healthy', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.status).toBe('ok');
        expect(result.homeAssistant).toBe(false);
        expect(result.mongodb).toBe(true);
        expect(result.questdb).toBe(true);
        expect(mockReply.code).not.toHaveBeenCalled();
      });
    });

    describe('error handling', () => {
      it('should propagate MongoDB healthCheck errors', async () => {
        mockFastify.mongo.healthCheck.mockRejectedValue(
          new Error('Database connection failed')
        );
        mockFastify.questdb.isConnected.mockReturnValue(true);

        await expect(handler(mockRequest, mockReply)).rejects.toThrow(
          'Database connection failed'
        );
      });
    });
  });

  describe('GET /api/status', () => {
    let handler;

    beforeEach(async () => {
      // Register the route
      await rootRoutes(mockFastify);

      // Get the handler that was registered
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/status'
      );
      handler = routeCall[2]; // The handler is the third argument
    });

    it('should register /api/status route with correct schema', async () => {
      const routeCall = mockFastify.get.mock.calls.find(
        (call) => call[0] === '/api/status'
      );
      expect(routeCall).toBeDefined();
      expect(routeCall[1]).toMatchObject({
        schema: {
          description: 'Detailed system status',
          tags: ['system'],
        },
      });
    });

    describe('when all services are available', () => {
      beforeEach(() => {
        mockFastify.mongo.getEntities.mockResolvedValue([
          {
            entityId: 'sensor.energy_1',
            friendlyName: 'Energy Sensor',
            isTracked: true,
          },
          {
            entityId: 'sensor.power_1',
            friendlyName: 'Power Sensor',
            isTracked: true,
          },
        ]);

        mockFastify.mongo.getStats.mockResolvedValue({
          database: 'energy_dashboard',
          collections: {
            settings: 5,
            entities: 2,
            subscriptionState: 1,
            syncLog: 100,
          },
          dataSize: 1024000,
          indexSize: 512000,
          totalSize: 1536000,
        });

        mockFastify.mongo.getSyncStats.mockResolvedValue({
          totalSyncs: 100,
          successfulSyncs: 95,
          failedSyncs: 5,
          totalRecordsSynced: 50000,
          lastSync: new Date('2024-01-15T10:30:00Z'),
        });

        mockFastify.ha.isConnected.mockReturnValue(true);
        process.env.HA_URL = 'http://homeassistant.local:8123';
      });

      afterEach(() => {
        delete process.env.HA_URL;
      });

      it('should return complete system status', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result).toMatchObject({
          system: {
            status: 'running',
            uptime: expect.any(Number),
            memory: expect.any(Object),
          },
          homeAssistant: {
            connected: true,
            url: 'http://homeassistant.local:8123',
          },
          database: {
            mongodb: expect.any(Object),
            sync: expect.any(Object),
          },
          cache: {
            entities: 2,
          },
        });
      });

      it('should include system uptime', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.system.uptime).toBeGreaterThanOrEqual(0);
        expect(typeof result.system.uptime).toBe('number');
      });

      it('should include memory usage', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.system.memory).toMatchObject({
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number),
          external: expect.any(Number),
        });
      });

      it('should include MongoDB stats', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.database.mongodb).toMatchObject({
          collections: {
            settings: 5,
            entities: 2,
            subscriptionState: 1,
            syncLog: 100,
          },
          dataSize: 1024000,
          indexSize: 512000,
        });
      });

      it('should include sync stats', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.database.sync).toMatchObject({
          totalSyncs: 100,
          successfulSyncs: 95,
          failedSyncs: 5,
          totalRecordsSynced: 50000,
        });
        // lastSync is a Date object from MongoDB, not an ISO string
        expect(result.database.sync.lastSync).toBeInstanceOf(Date);
        expect(result.database.sync.lastSync.toISOString()).toBe(
          '2024-01-15T10:30:00.000Z'
        );
      });

      it('should include cached entities count', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.cache.entities).toBe(2);
      });

      it('should call mongo.getEntities with isTracked filter', async () => {
        await handler(mockRequest, mockReply);

        expect(mockFastify.mongo.getEntities).toHaveBeenCalledWith({
          isTracked: true,
        });
      });
    });

    describe('when HA_URL is not configured', () => {
      beforeEach(() => {
        delete process.env.HA_URL;
        mockFastify.mongo.getEntities.mockResolvedValue([]);
        mockFastify.mongo.getStats.mockResolvedValue({
          collections: {},
          dataSize: 0,
          indexSize: 0,
        });
        mockFastify.mongo.getSyncStats.mockResolvedValue({
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRecordsSynced: 0,
          lastSync: null,
        });
        mockFastify.ha = undefined;
      });

      it('should show "not configured" for HA URL', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.homeAssistant.url).toBe('not configured');
      });
    });

    describe('when no entities are cached', () => {
      beforeEach(() => {
        mockFastify.mongo.getEntities.mockResolvedValue([]);
        mockFastify.mongo.getStats.mockResolvedValue({
          collections: {},
          dataSize: 0,
          indexSize: 0,
        });
        mockFastify.mongo.getSyncStats.mockResolvedValue({
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRecordsSynced: 0,
          lastSync: null,
        });
        mockFastify.ha.isConnected.mockReturnValue(false);
      });

      it('should show zero cached entities', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.cache.entities).toBe(0);
      });

      it('should show HA as disconnected', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.homeAssistant.connected).toBe(false);
      });
    });

    describe('when ha is undefined', () => {
      beforeEach(() => {
        mockFastify.mongo.getEntities.mockResolvedValue([]);
        mockFastify.mongo.getStats.mockResolvedValue({
          collections: {},
          dataSize: 0,
          indexSize: 0,
        });
        mockFastify.mongo.getSyncStats.mockResolvedValue({
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRecordsSynced: 0,
          lastSync: null,
        });
        mockFastify.ha = undefined;
      });

      it('should handle undefined ha gracefully', async () => {
        // Re-register route with undefined ha
        await rootRoutes(mockFastify);
        const routeCall = mockFastify.get.mock.calls.find(
          (call) => call[0] === '/api/status'
        );
        const handler = routeCall[2];

        const result = await handler(mockRequest, mockReply);

        expect(result.homeAssistant.connected).toBe(false);
      });
    });

    describe('when no syncs have occurred', () => {
      beforeEach(() => {
        mockFastify.mongo.getEntities.mockResolvedValue([]);
        mockFastify.mongo.getStats.mockResolvedValue({
          collections: {},
          dataSize: 0,
          indexSize: 0,
        });
        mockFastify.mongo.getSyncStats.mockResolvedValue({
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRecordsSynced: 0,
          lastSync: null,
        });
        mockFastify.ha = undefined;
      });

      it('should show zero sync stats', async () => {
        const result = await handler(mockRequest, mockReply);

        expect(result.database.sync).toMatchObject({
          totalSyncs: 0,
          successfulSyncs: 0,
          failedSyncs: 0,
          totalRecordsSynced: 0,
          lastSync: null,
        });
      });
    });

    describe('error handling', () => {
      it('should propagate getEntities errors', async () => {
        mockFastify.mongo.getEntities.mockRejectedValue(
          new Error('Database query failed')
        );

        await expect(handler(mockRequest, mockReply)).rejects.toThrow(
          'Database query failed'
        );
      });

      it('should propagate getStats errors', async () => {
        mockFastify.mongo.getEntities.mockResolvedValue([]);
        mockFastify.mongo.getStats.mockRejectedValue(
          new Error('Stats query failed')
        );

        await expect(handler(mockRequest, mockReply)).rejects.toThrow(
          'Stats query failed'
        );
      });

      it('should propagate getSyncStats errors', async () => {
        mockFastify.mongo.getEntities.mockResolvedValue([]);
        mockFastify.mongo.getStats.mockResolvedValue({
          collections: {},
          dataSize: 0,
          indexSize: 0,
        });
        mockFastify.mongo.getSyncStats.mockRejectedValue(
          new Error('Sync stats query failed')
        );

        await expect(handler(mockRequest, mockReply)).rejects.toThrow(
          'Sync stats query failed'
        );
      });
    });
  });

  describe('route registration', () => {
    it('should register both routes', async () => {
      await rootRoutes(mockFastify);

      expect(mockFastify.get).toHaveBeenCalledTimes(2);
      expect(mockFastify.get).toHaveBeenCalledWith(
        '/api/health',
        expect.any(Object),
        expect.any(Function)
      );
      expect(mockFastify.get).toHaveBeenCalledWith(
        '/api/status',
        expect.any(Object),
        expect.any(Function)
      );
    });

    it('should be a function that exports a default function', () => {
      expect(typeof rootRoutes).toBe('function');
      expect(rootRoutes.default).toBeUndefined();
    });
  });
});
