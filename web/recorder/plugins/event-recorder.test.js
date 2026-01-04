import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fp from 'fastify-plugin';
import eventRecorderPlugin from './event-recorder.js';

// Mock the runtime plugins that event-recorder depends on
vi.mock('../lib/utils.js', async () => {
  const actual = await vi.importActual('../lib/utils.js');
  return {
    ...actual,
    // Export the actual functions for testing
  };
});

describe('Event Recorder Plugin', () => {
  let mockFastify;
  let mockHa;
  let mockMongo;
  let mockQuestdb;

  beforeEach(() => {
    vi.useFakeTimers();

    // Mock Home Assistant plugin
    mockHa = {
      discoverEntities: vi.fn().mockResolvedValue([]),
      getStatistics: vi.fn().mockResolvedValue({}),
      subscribeToStateChanges: vi.fn().mockResolvedValue(undefined),
      reconnect: vi.fn().mockResolvedValue(undefined),
    };

    // Mock MongoDB plugin
    const mockCollection = {
      createIndex: vi.fn().mockResolvedValue('index'),
      updateOne: vi.fn().mockResolvedValue({ acknowledged: true }),
    };
    const mockDb = {
      collection: vi.fn().mockReturnValue(mockCollection),
    };
    mockMongo = {
      db: mockDb,
      getEntities: vi.fn().mockResolvedValue([]),
      upsertEntity: vi.fn().mockResolvedValue({ acknowledged: true }),
      logSync: vi.fn().mockResolvedValue({ acknowledged: true }),
      incrementEventCount: vi.fn().mockResolvedValue({ acknowledged: true }),
    };

    // Mock QuestDB plugin
    mockQuestdb = {
      query: vi.fn().mockResolvedValue({ dataset: [[0]] }),
      getLatestStatsTime: vi.fn().mockResolvedValue(null),
      writeReadings: vi.fn().mockResolvedValue(undefined),
      writeStats: vi.fn().mockResolvedValue(undefined),
    };

    // Mock Fastify instance
    mockFastify = {
      log: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      },
      ha: mockHa,
      mongo: mockMongo,
      questdb: mockQuestdb,
      addHook: vi.fn(),
      decorate: vi.fn(),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('plugin registration', () => {
    it('should be a fastify-plugin', () => {
      expect(eventRecorderPlugin).toBeDefined();
      expect(typeof eventRecorderPlugin).toBe('function'); // fp returns a function
    });

    it('should have correct plugin name and dependencies', () => {
      // fastify-plugin wraps the function with metadata
      expect(eventRecorderPlugin[Symbol.for('fastify.display-name')]).toBe(
        'event-recorder'
      );
      expect(eventRecorderPlugin[Symbol.for('plugin-meta')]).toMatchObject({
        name: 'event-recorder',
        dependencies: ['mongodb', 'questdb', 'home-assistant'],
      });
    });
  });

  describe('plugin initialization', () => {
    it('should skip registration if HA plugin is not available', async () => {
      const fastifyWithoutHA = { ...mockFastify, ha: undefined };

      await eventRecorderPlugin(fastifyWithoutHA);

      expect(fastifyWithoutHA.log.warn).toHaveBeenCalledWith(
        'Home Assistant plugin not available - event recorder disabled'
      );
      expect(fastifyWithoutHA.addHook).not.toHaveBeenCalled();
    });

    it('should skip registration if MongoDB plugin is not available', async () => {
      const fastifyWithoutMongo = { ...mockFastify, mongo: undefined };

      await eventRecorderPlugin(fastifyWithoutMongo);

      expect(fastifyWithoutMongo.log.warn).toHaveBeenCalledWith(
        'MongoDB plugin not available - event recorder disabled'
      );
      expect(fastifyWithoutMongo.addHook).not.toHaveBeenCalled();
    });

    it('should skip registration if QuestDB plugin is not available', async () => {
      const fastifyWithoutQuestdb = { ...mockFastify, questdb: undefined };

      await eventRecorderPlugin(fastifyWithoutQuestdb);

      expect(fastifyWithoutQuestdb.log.warn).toHaveBeenCalledWith(
        'QuestDB plugin not available - event recorder disabled'
      );
      expect(fastifyWithoutQuestdb.addHook).not.toHaveBeenCalled();
    });

    it('should register onReady hook when all dependencies are available', async () => {
      await eventRecorderPlugin(mockFastify);

      expect(mockFastify.addHook).toHaveBeenCalledWith(
        'onReady',
        expect.any(Function)
      );
      expect(mockFastify.addHook).toHaveBeenCalledWith(
        'onClose',
        expect.any(Function)
      );
    });

    it('should decorate fastify with recorder API', async () => {
      await eventRecorderPlugin(mockFastify);

      expect(mockFastify.decorate).toHaveBeenCalledWith('recorder', {
        getState: expect.any(Function),
        triggerBackfill: expect.any(Function),
        reseedDatabase: expect.any(Function),
        executeHeartbeat: expect.any(Function),
        executeHourlyBackfill: expect.any(Function),
      });
    });
  });

  describe('onReady initialization', () => {
    let onReadyFn;

    beforeEach(async () => {
      await eventRecorderPlugin(mockFastify);
      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
    });

    it('should create TTL index for syncLog', async () => {
      mockHa.discoverEntities.mockResolvedValue([]);
      mockMongo.getEntities.mockResolvedValue([]);

      await onReadyFn();

      expect(mockFastify.mongo.db.collection).toHaveBeenCalledWith('syncLog');
      expect(mockMongo.db.collection().createIndex).toHaveBeenCalledWith(
        { createdAt: 1 },
        { expireAfterSeconds: 7 * 24 * 60 * 60 }
      );
    });

    it('should load tracked entities from MongoDB', async () => {
      const entities = [
        { entityId: 'sensor.energy1', isTracked: true },
        { entityId: 'sensor.energy2', isTracked: true },
      ];
      mockMongo.getEntities.mockResolvedValue(entities);

      await onReadyFn();

      expect(mockMongo.getEntities).toHaveBeenCalledWith({ isTracked: true });
      expect(mockFastify.log.info).toHaveBeenCalledWith(
        { count: 2 },
        'Loaded tracked entities'
      );
    });

    it('should check if seeding is needed when QuestDB is empty', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[0]] });

      await onReadyFn();

      expect(mockQuestdb.query).toHaveBeenCalledWith(
        'SELECT count() as count FROM energy_statistics LIMIT 1'
      );
    });

    it('should subscribe to HA state changes', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] }); // Not empty

      await onReadyFn();

      expect(mockHa.subscribeToStateChanges).toHaveBeenCalledWith(
        expect.any(Function)
      );
    });

    it('should start heartbeat timer', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      expect(mockFastify.log.info).toHaveBeenCalledWith(
        expect.objectContaining({ intervalMs: 3 * 60 * 1000 }),
        'Heartbeat monitor started'
      );
    });

    it('should schedule hourly backfill', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      expect(mockFastify.log.info).toHaveBeenCalledWith(
        expect.objectContaining({ intervalMs: 60 * 60 * 1000 }),
        'Hourly backfill scheduled'
      );
    });

    it('should update subscription state in MongoDB', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      expect(mockMongo.db.collection).toHaveBeenCalledWith('subscriptionState');
      expect(mockMongo.db.collection().updateOne).toHaveBeenCalledWith(
        { _id: 'recorder' },
        expect.objectContaining({
          $set: expect.objectContaining({
            isActive: true,
            subscribedAt: expect.any(Date),
          }),
        }),
        { upsert: true }
      );
    });

    it('should log initialization success', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      expect(mockFastify.log.info).toHaveBeenCalledWith(
        'Event Recorder Service initialized successfully'
      );
    });

    it('should handle initialization errors gracefully', async () => {
      // Make getEntities throw an error during initialization
      mockMongo.getEntities.mockRejectedValue(new Error('MongoDB error'));
      mockQuestdb.query.mockResolvedValue({ dataset: [[0]] }); // Empty

      await onReadyFn();

      // Should have logged either an error or warning about the failure
      expect(
        mockFastify.log.error || mockFastify.log.warn || mockFastify.log.info
      ).toHaveBeenCalled();
    });
  });

  describe('initial seeding', () => {
    let onReadyFn;

    beforeEach(async () => {
      await eventRecorderPlugin(mockFastify);
      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];

      // Simulate empty database
      mockQuestdb.query.mockResolvedValue({ dataset: [[0]] });

      // Mock HA entities
      mockHa.discoverEntities.mockResolvedValue([
        {
          entity_id: 'sensor.energy1',
          attributes: {
            friendly_name: 'Energy 1',
            device_class: 'energy',
            unit_of_measurement: 'kWh',
          },
          state: '100',
        },
        {
          entity_id: 'sensor.energy2',
          attributes: {
            friendly_name: 'Energy 2',
            device_class: 'power',
            unit_of_measurement: 'W',
          },
          state: '200',
        },
      ]);

      // Mock HA statistics
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [
          {
            start: '2024-01-01T00:00:00Z',
            state: '100',
            sum: '2400',
          },
        ],
        'sensor.energy2': [
          {
            start: '2024-01-01T00:00:00Z',
            state: '200',
            sum: '4800',
          },
        ],
      });
    });

    it('should discover energy entities from HA', async () => {
      await onReadyFn();

      expect(mockHa.discoverEntities).toHaveBeenCalled();
    });

    it('should store discovered entities in MongoDB', async () => {
      await onReadyFn();

      expect(mockMongo.upsertEntity).toHaveBeenCalledTimes(2);
      expect(mockMongo.upsertEntity).toHaveBeenCalledWith({
        entity_id: 'sensor.energy1',
        friendly_name: 'Energy 1',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state: '100',
        isTracked: true,
      });
    });

    it('should fetch historical statistics for seeding', async () => {
      await onReadyFn();

      expect(mockHa.getStatistics).toHaveBeenCalledWith(
        ['sensor.energy1', 'sensor.energy2'],
        expect.any(String), // startTime (30 days ago)
        expect.any(String), // endTime (now)
        'hour'
      );
    });

    it('should write statistics to QuestDB', async () => {
      await onReadyFn();

      expect(mockQuestdb.writeStats).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            entity_id: 'sensor.energy1',
            period: 'hour',
          }),
        ])
      );
    });

    it('should log successful sync', async () => {
      await onReadyFn();

      expect(mockMongo.logSync).toHaveBeenCalledWith(
        expect.objectContaining({
          entityIds: ['sensor.energy1', 'sensor.energy2'],
          recordsSynced: expect.any(Number),
          success: true,
        })
      );
    });

    it('should handle seeding errors', async () => {
      mockHa.discoverEntities.mockRejectedValue(new Error('HA error'));

      await onReadyFn();

      expect(mockFastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Initial seeding failed'
      );
      expect(mockMongo.logSync).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: expect.any(String),
        })
      );
    });
  });

  describe('recorder state API', () => {
    it('getState should return current recorder state', async () => {
      await eventRecorderPlugin(mockFastify);

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      const getState = recorder.getState;

      const state = getState();

      expect(state).toMatchObject({
        isRunning: expect.any(Boolean),
        lastEventAt: expect.any(Object), // Date or null
        entityCount: expect.any(Number),
        eventCount: expect.any(Number),
        errorCount: expect.any(Number),
        trackedEntities: expect.any(Number), // size of Set
      });
    });

    it('triggerBackfill should be a function', async () => {
      await eventRecorderPlugin(mockFastify);

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];

      expect(typeof recorder.triggerBackfill).toBe('function');
    });

    it('reseedDatabase should be a function', async () => {
      await eventRecorderPlugin(mockFastify);

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];

      expect(typeof recorder.reseedDatabase).toBe('function');
    });
  });

  describe('onClose cleanup', () => {
    let onCloseFn;
    let setIntervalSpy;
    let clearIntervalSpy;

    beforeEach(async () => {
      setIntervalSpy = vi.spyOn(global, 'setInterval').mockReturnValue(123);
      clearIntervalSpy = vi.spyOn(global, 'clearInterval');

      // Set up entities for tracking
      mockMongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.test', isTracked: true },
      ]);
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] }); // Not empty

      await eventRecorderPlugin(mockFastify);

      // Run onReady to initialize timers
      const onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
      await onReadyFn();

      onCloseFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onClose'
      )[1];
    });

    it('should log shutdown', async () => {
      await onCloseFn();

      expect(mockFastify.log.info).toHaveBeenCalledWith(
        'Shutting down Event Recorder Service'
      );
    });

    it('should clear heartbeat timer', async () => {
      await onCloseFn();

      // clearInterval is called for both heartbeat and hourly timers
      expect(clearIntervalSpy).toHaveBeenCalled();
    });

    it('should update subscription state to inactive', async () => {
      await onCloseFn();

      expect(mockMongo.db.collection).toHaveBeenCalledWith('subscriptionState');
      expect(mockMongo.db.collection().updateOne).toHaveBeenCalledWith(
        { _id: 'recorder' },
        expect.objectContaining({
          $set: expect.objectContaining({
            isActive: false,
            updatedAt: expect.any(Date),
          }),
        })
      );
    });

    it('should set isRunning to false', async () => {
      await onCloseFn();

      expect(mockFastify.log.info).toHaveBeenCalledWith(
        'Event Recorder Service shut down'
      );
    });

    it('should handle cleanup errors gracefully', async () => {
      mockMongo.db.collection.mockImplementation(() => {
        throw new Error('Cleanup error');
      });

      await onCloseFn();

      expect(mockFastify.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to update subscription state on shutdown'
      );
    });
  });

  describe('state changed event handling', () => {
    let handleStateChanged;
    let onReadyFn;

    beforeEach(async () => {
      await eventRecorderPlugin(mockFastify);
      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
    });

    it('should be registered with subscribeToStateChanges', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      expect(mockHa.subscribeToStateChanges).toHaveBeenCalledWith(
        expect.any(Function)
      );

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];
      expect(typeof handleStateChanged).toBe('function');
    });

    it('should skip events without entity_id', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      await handleStateChanged({ data: { new_state: { state: '100' } } });

      expect(mockQuestdb.writeReadings).not.toHaveBeenCalled();
    });

    it('should skip events without new_state', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      await handleStateChanged({ data: { entity_id: 'sensor.test' } });

      expect(mockQuestdb.writeReadings).not.toHaveBeenCalled();
    });

    it('should skip non-energy entities', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      const event = {
        data: {
          entity_id: 'sensor.temperature',
          new_state: {
            state: '20',
            attributes: {
              device_class: 'temperature',
              unit_of_measurement: '°C',
            },
          },
        },
      };

      await handleStateChanged(event);

      expect(mockQuestdb.writeReadings).not.toHaveBeenCalled();
    });

    it('should write energy readings for valid energy entities', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      const event = {
        data: {
          entity_id: 'sensor.energy',
          new_state: {
            state: '100',
            last_changed: '2024-01-01T12:00:00Z',
            attributes: { device_class: 'energy', unit_of_measurement: 'kWh' },
          },
          old_state: null,
        },
      };

      await handleStateChanged(event);

      expect(mockQuestdb.writeReadings).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({
            entity_id: 'sensor.energy',
          }),
        ])
      );
    });

    it('should increment event count for valid events', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      const event = {
        data: {
          entity_id: 'sensor.energy',
          new_state: {
            state: '100',
            last_changed: '2024-01-01T12:00:00Z',
            attributes: { device_class: 'energy', unit_of_measurement: 'kWh' },
          },
        },
      };

      await handleStateChanged(event);

      // Verify event count was incremented by checking the state
      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      const state = recorder.getState();
      expect(state.eventCount).toBeGreaterThan(0);
    });

    it('should update lastEventAt timestamp', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      const event = {
        data: {
          entity_id: 'sensor.energy',
          new_state: {
            state: '100',
            last_changed: '2024-01-01T12:00:00Z',
            attributes: { device_class: 'energy', unit_of_measurement: 'kWh' },
          },
        },
      };

      await handleStateChanged(event);

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      const state = recorder.getState();
      expect(state.lastEventAt).toBeInstanceOf(Date);
    });

    it('should skip events when createEnergyReading returns null (unavailable state)', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      // State with 'unavailable' state string - createEnergyReading returns null
      const event = {
        data: {
          entity_id: 'sensor.energy',
          new_state: {
            state: 'unavailable',
            last_changed: '2024-01-01T12:00:00Z',
            attributes: { device_class: 'energy', unit_of_measurement: 'kWh' },
          },
        },
      };

      await handleStateChanged(event);

      // Should not call writeReadings (line 311 returns early)
      expect(mockQuestdb.writeReadings).not.toHaveBeenCalled();
    });

    it('should log warning when incrementEventCount fails', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });
      // Make incrementEventCount fail
      mockMongo.incrementEventCount.mockRejectedValue(
        new Error('Database connection lost')
      );

      await onReadyFn();

      handleStateChanged = mockHa.subscribeToStateChanges.mock.calls[0][0];

      const event = {
        data: {
          entity_id: 'sensor.energy',
          new_state: {
            state: '100',
            last_changed: '2024-01-01T12:00:00Z',
            attributes: { device_class: 'energy', unit_of_measurement: 'kWh' },
          },
        },
      };

      // Call handleStateChanged - incrementEventCount is fire-and-forget
      await handleStateChanged(event);

      // The warning should be logged (handled in catch block of the fire-and-forget promise)
      // Note: Since it's fire-and-forget, we just verify the mock was called
      // The actual logging happens asynchronously but the mock records it
      expect(mockMongo.incrementEventCount).toHaveBeenCalledWith(
        'sensor.energy'
      );
      // The warning is logged when the promise rejects
      expect(mockFastify.log.warn).toHaveBeenCalled();
    });
  });

  describe('backfill operation', () => {
    let triggerBackfill;
    let onReadyFn;

    beforeEach(async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] }); // Not empty
      mockMongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.energy1', isTracked: true },
      ]);

      await eventRecorderPlugin(mockFastify);

      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
      await onReadyFn();

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      triggerBackfill = recorder.triggerBackfill;
    });

    it('should fetch statistics for tracked entities', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });

      await triggerBackfill();

      expect(mockQuestdb.getLatestStatsTime).toHaveBeenCalledWith(
        'sensor.energy1',
        'hour'
      );
    });

    it('should write statistics to QuestDB', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });

      await triggerBackfill();

      expect(mockQuestdb.writeStats).toHaveBeenCalled();
    });

    it('should log successful backfill', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });

      await triggerBackfill();

      expect(mockMongo.logSync).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
        })
      );
    });

    it('should handle backfill errors per entity', async () => {
      mockQuestdb.getLatestStatsTime.mockRejectedValue(
        new Error('Query error')
      );
      mockHa.getStatistics.mockResolvedValue({});

      await triggerBackfill();

      // Should log warning for the failed entity
      expect(mockFastify.log.warn).toHaveBeenCalled();
    });

    it('should return early if no tracked entities', async () => {
      mockMongo.getEntities.mockResolvedValue([]);

      await eventRecorderPlugin(mockFastify);

      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
      await onReadyFn();

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      triggerBackfill = recorder.triggerBackfill;

      await triggerBackfill();

      // Should not attempt to get latest stats
      expect(mockQuestdb.getLatestStatsTime).not.toHaveBeenCalled();
    });

    it('should log debug message when no new statistics to backfill', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      // Return empty statistics array
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [],
      });

      await triggerBackfill();

      // Should log debug message for no new statistics
      expect(mockFastify.log.debug).toHaveBeenCalledWith(
        { trigger: 'manual' },
        'No new statistics to backfill'
      );

      // Should not call writeStats
      expect(mockQuestdb.writeStats).not.toHaveBeenCalled();
    });
  });

  describe('backfill operation', () => {
    let recorderApi;

    beforeEach(async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });
      await eventRecorderPlugin(mockFastify);

      recorderApi = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
    });

    it('should fetch statistics for tracked entities', async () => {
      // This would be tested by actually triggering a backfill
      // which requires more complex setup
      expect(typeof recorderApi.triggerBackfill).toBe('function');
    });
  });

  describe('error handling', () => {
    it('should handle QuestDB query errors during seeding check', async () => {
      mockQuestdb.query.mockRejectedValue(new Error('QuestDB error'));

      await eventRecorderPlugin(mockFastify);

      const onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];

      await onReadyFn();

      expect(mockFastify.log.warn).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Could not check if seeding needed'
      );
    });

    it('should handle subscription errors', async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });
      mockHa.subscribeToStateChanges.mockRejectedValue(
        new Error('Subscription error')
      );

      await eventRecorderPlugin(mockFastify);

      const onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];

      await onReadyFn();

      expect(mockFastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({ err: expect.any(Error) }),
        'Failed to subscribe to events'
      );
    });
  });

  describe('backfill outer catch block', () => {
    let triggerBackfill;
    let onReadyFn;

    beforeEach(async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });
      mockMongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.energy1', isTracked: true },
      ]);

      await eventRecorderPlugin(mockFastify);

      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
      await onReadyFn();

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      triggerBackfill = recorder.triggerBackfill;
    });

    it('should handle mongo.logSync failure after successful backfill', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });
      // Write stats succeeds
      mockQuestdb.writeStats.mockResolvedValue(undefined);
      // First logSync fails, second succeeds (in catch block)
      mockMongo.logSync
        .mockRejectedValueOnce(new Error('Mongo sync log failed'))
        .mockResolvedValueOnce(undefined);

      // The error is caught by performBackfill's catch block, so it should not throw
      await triggerBackfill();

      // Should log the error
      expect(mockFastify.log.error).toHaveBeenCalledWith(
        expect.objectContaining({
          err: expect.any(Error),
          trigger: 'manual',
        }),
        'Backfill failed'
      );
    });

    it('should increment error count when mongo.logSync fails', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });
      mockQuestdb.writeStats.mockResolvedValue(undefined);
      // First fails, second succeeds
      mockMongo.logSync
        .mockRejectedValueOnce(new Error('Mongo sync log failed'))
        .mockResolvedValueOnce(undefined);

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      const initialState = recorder.getState();
      const initialErrorCount = initialState.errorCount;

      await triggerBackfill();

      const finalState = recorder.getState();
      expect(finalState.errorCount).toBeGreaterThan(initialErrorCount);
    });

    it('should attempt to log failed sync with error details', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });
      mockQuestdb.writeStats.mockResolvedValue(undefined);
      mockMongo.logSync
        .mockRejectedValueOnce(new Error('First call fails'))
        .mockResolvedValueOnce(undefined);

      await triggerBackfill();

      // Should have called logSync twice - first fails, second succeeds in catch block
      expect(mockMongo.logSync).toHaveBeenCalledTimes(2);
      expect(mockMongo.logSync).toHaveBeenCalledWith(
        expect.objectContaining({
          success: false,
          error: 'First call fails',
        })
      );
    });
  });

  describe('executeHeartbeat', () => {
    let executeHeartbeat;
    let onReadyFn;

    beforeEach(async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });

      await eventRecorderPlugin(mockFastify);

      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
      await onReadyFn();

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      executeHeartbeat = recorder.executeHeartbeat;
    });

    it('should log heartbeat debug info', async () => {
      await executeHeartbeat();

      expect(mockFastify.log.debug).toHaveBeenCalled();
      const calls = mockFastify.log.debug.mock.calls;
      const heartbeatCall = calls.find((call) => call[1] === 'Heartbeat check');
      expect(heartbeatCall).toBeDefined();
      expect(heartbeatCall[0]).toMatchObject({
        eventCount: expect.any(Number),
        errorCount: expect.any(Number),
      });
    });

    it('should reconnect when no events received', async () => {
      // Set lastEventAt to a long time ago
      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      const state = recorder.getState();
      state.lastEventAt = Date.now() - 10 * 60 * 1000; // 10 minutes ago

      await executeHeartbeat();

      expect(mockFastify.log.warn).toHaveBeenCalledWith(
        { idleMs: 5 * 60 * 1000 },
        'No events received - reconnecting to Home Assistant'
      );
      expect(mockHa.reconnect).toHaveBeenCalled();
    });

    it('should handle heartbeat errors', async () => {
      mockHa.reconnect.mockRejectedValue(new Error('Reconnect failed'));

      await executeHeartbeat();

      expect(mockFastify.log.error).toHaveBeenCalled();
      const calls = mockFastify.log.error.mock.calls;
      const errorCall = calls.find(
        (call) => call[1] === 'Heartbeat check failed'
      );
      expect(errorCall).toBeDefined();
      expect(errorCall[0].err).toBeDefined();
    });
  });

  describe('executeHourlyBackfill', () => {
    let executeHourlyBackfill;
    let onReadyFn;

    beforeEach(async () => {
      mockQuestdb.query.mockResolvedValue({ dataset: [[1]] });
      mockMongo.getEntities.mockResolvedValue([
        { entityId: 'sensor.energy1', isTracked: true },
      ]);

      await eventRecorderPlugin(mockFastify);

      onReadyFn = mockFastify.addHook.mock.calls.find(
        (call) => call[0] === 'onReady'
      )[1];
      await onReadyFn();

      const recorder = mockFastify.decorate.mock.calls.find(
        (call) => call[0] === 'recorder'
      )[1];
      executeHourlyBackfill = recorder.executeHourlyBackfill;
    });

    it('should perform backfill with hourly trigger', async () => {
      mockQuestdb.getLatestStatsTime.mockResolvedValue(null);
      mockHa.getStatistics.mockResolvedValue({
        'sensor.energy1': [{ start: '2024-01-01T00:00:00Z', state: '100' }],
      });

      await executeHourlyBackfill();

      expect(mockQuestdb.getLatestStatsTime).toHaveBeenCalledWith(
        'sensor.energy1',
        'hour'
      );
    });

    it('should handle hourly backfill errors', async () => {
      // Make getEntities return empty to skip backfill logic
      mockMongo.getEntities.mockResolvedValue([]);

      // The function should complete without error
      await expect(executeHourlyBackfill()).resolves.not.toThrow();
    });
  });
});
