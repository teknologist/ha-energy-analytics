import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { MongoClient } from 'mongodb';
import mongodbPlugin from '../../../../runtime-plugins/mongodb.js';

// Use a test database
const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI ||
  'mongodb://localhost:27017/energy_dashboard_test';

describe('MongoDB Plugin', () => {
  let fastify;
  let mongoClient;

  beforeAll(async () => {
    // Create a fresh fastify instance
    fastify = Fastify({ logger: false });

    // Set test database URI
    process.env.MONGODB_URI = TEST_MONGODB_URI;

    // Register plugin
    await fastify.register(mongodbPlugin);
    await fastify.ready();
  });

  afterAll(async () => {
    // Clean up test database
    try {
      mongoClient = new MongoClient(TEST_MONGODB_URI);
      await mongoClient.connect();
      await mongoClient.db().dropDatabase();
      await mongoClient.close();
    } catch (error) {
      // Ignore cleanup errors
    }

    await fastify.close();
  });

  describe('Health Check', () => {
    it('should return healthy status', async () => {
      const health = await fastify.mongo.healthCheck();
      expect(health.healthy).toBe(true);
      expect(health.timestamp).toBeInstanceOf(Date);
    });
  });

  describe('Settings CRUD', () => {
    it('should set and get a setting', async () => {
      const result = await fastify.mongo.setSetting('test_key', 'test_value');
      expect(result.key).toBe('test_key');
      expect(result.value).toBe('test_value');

      const value = await fastify.mongo.getSetting('test_key');
      expect(value).toBe('test_value');
    });

    it('should return undefined for non-existent setting', async () => {
      const value = await fastify.mongo.getSetting('non_existent');
      expect(value).toBeUndefined();
    });

    it('should update existing setting', async () => {
      await fastify.mongo.setSetting('update_test', 'initial');
      await fastify.mongo.setSetting('update_test', 'updated');

      const value = await fastify.mongo.getSetting('update_test');
      expect(value).toBe('updated');
    });

    it('should get all settings', async () => {
      await fastify.mongo.setSetting('setting1', 'value1');
      await fastify.mongo.setSetting('setting2', 'value2');

      const settings = await fastify.mongo.getAllSettings();
      expect(settings.setting1).toBeTruthy();
      expect(settings.setting2).toBeTruthy();
    });

    it('should delete a setting', async () => {
      await fastify.mongo.setSetting('delete_test', 'value');
      const deleted = await fastify.mongo.deleteSetting('delete_test');
      expect(deleted).toBe(true);

      const value = await fastify.mongo.getSetting('delete_test');
      expect(value).toBeUndefined();
    });

    it('should return false when deleting non-existent setting', async () => {
      const deleted = await fastify.mongo.deleteSetting('non_existent');
      expect(deleted).toBe(false);
    });
  });

  describe('Entity Management', () => {
    it('should upsert a new entity', async () => {
      const entity = {
        entity_id: 'sensor.test_power',
        friendly_name: 'Test Power Sensor',
        device_class: 'power',
        unit_of_measurement: 'W',
        state: '100',
      };

      const result = await fastify.mongo.upsertEntity(entity);
      expect(result.entityId).toBe('sensor.test_power');
      expect(result.friendlyName).toBe('Test Power Sensor');
      expect(result.deviceClass).toBe('power');
      expect(result.unitOfMeasurement).toBe('W');
      expect(result.isTracked).toBe(true);
    });

    it('should update existing entity', async () => {
      const entity1 = {
        entity_id: 'sensor.update_test',
        friendly_name: 'Original Name',
        state: '50',
      };

      await fastify.mongo.upsertEntity(entity1);

      const entity2 = {
        entity_id: 'sensor.update_test',
        friendly_name: 'Updated Name',
        state: '75',
      };

      await fastify.mongo.upsertEntity(entity2);

      const fetched = await fastify.mongo.getEntity('sensor.update_test');
      expect(fetched.friendlyName).toBe('Updated Name');
      expect(fetched.state).toBe('75');
    });

    it('should get all entities', async () => {
      const entities = await fastify.mongo.getEntities();
      expect(Array.isArray(entities)).toBe(true);
      expect(entities.length).toBeGreaterThan(0);
    });

    it('should filter entities by isTracked', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.tracked',
        isTracked: true,
      });

      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.untracked',
        isTracked: false,
      });

      const tracked = await fastify.mongo.getEntities({ isTracked: true });
      const untracked = await fastify.mongo.getEntities({ isTracked: false });

      expect(tracked.some((e) => e.entityId === 'sensor.tracked')).toBe(true);
      expect(tracked.some((e) => e.entityId === 'sensor.untracked')).toBe(
        false
      );
      expect(untracked.some((e) => e.entityId === 'sensor.untracked')).toBe(
        true
      );
    });

    it('should filter entities by deviceClass', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.energy_device',
        device_class: 'energy',
      });

      const energyEntities = await fastify.mongo.getEntities({
        deviceClass: 'energy',
      });
      expect(
        energyEntities.some((e) => e.entityId === 'sensor.energy_device')
      ).toBe(true);
    });

    it('should get single entity by ID', async () => {
      const entity = await fastify.mongo.getEntity('sensor.test_power');
      expect(entity.entityId).toBe('sensor.test_power');
    });

    it('should return null for non-existent entity', async () => {
      const entity = await fastify.mongo.getEntity('sensor.non_existent');
      expect(entity).toBeNull();
    });

    it('should set entity tracked status', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.track_test',
        isTracked: true,
      });

      const updated = await fastify.mongo.setEntityTracked(
        'sensor.track_test',
        false
      );
      expect(updated).toBe(true);

      const entity = await fastify.mongo.getEntity('sensor.track_test');
      expect(entity.isTracked).toBe(false);
    });

    it('should delete entity', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.delete_test',
      });

      const deleted = await fastify.mongo.deleteEntity('sensor.delete_test');
      expect(deleted).toBe(true);

      const entity = await fastify.mongo.getEntity('sensor.delete_test');
      expect(entity).toBeNull();
    });
  });

  describe('Subscription State Management', () => {
    it('should create subscription state', async () => {
      const state = {
        subscriptionId: 'sub_123',
        isActive: true,
        eventCount: 10,
      };

      const result = await fastify.mongo.updateSubscriptionState(
        'sensor.test_power',
        state
      );
      expect(result.entityId).toBe('sensor.test_power');
      expect(result.subscriptionId).toBe('sub_123');
      expect(result.isActive).toBe(true);
      expect(result.eventCount).toBe(10);
    });

    it('should get subscription state for entity', async () => {
      const state =
        await fastify.mongo.getSubscriptionState('sensor.test_power');
      expect(state.entityId).toBe('sensor.test_power');
      expect(state.subscriptionId).toBe('sub_123');
    });

    it('should get all subscription states', async () => {
      const states = await fastify.mongo.getSubscriptionState();
      expect(Array.isArray(states)).toBe(true);
      expect(states.length).toBeGreaterThan(0);
    });

    it('should increment event count', async () => {
      const initialState =
        await fastify.mongo.getSubscriptionState('sensor.test_power');
      const initialCount = initialState.eventCount;

      await fastify.mongo.incrementEventCount('sensor.test_power');

      const updatedState =
        await fastify.mongo.getSubscriptionState('sensor.test_power');
      expect(updatedState.eventCount).toBe(initialCount + 1);
      expect(updatedState.lastEventAt).toBeInstanceOf(Date);
    });

    it('should clear subscription state for specific entity', async () => {
      await fastify.mongo.updateSubscriptionState('sensor.clear_test', {
        subscriptionId: 'sub_clear',
      });

      const cleared =
        await fastify.mongo.clearSubscriptionState('sensor.clear_test');
      expect(cleared).toBe(true);

      const state =
        await fastify.mongo.getSubscriptionState('sensor.clear_test');
      expect(state).toBeNull();
    });

    it('should clear all subscription states', async () => {
      await fastify.mongo.updateSubscriptionState('sensor.clear_all_1', {
        subscriptionId: 'sub1',
      });
      await fastify.mongo.updateSubscriptionState('sensor.clear_all_2', {
        subscriptionId: 'sub2',
      });

      const count = await fastify.mongo.clearSubscriptionState();
      expect(count).toBeGreaterThanOrEqual(2);

      const states = await fastify.mongo.getSubscriptionState();
      expect(states.length).toBe(0);
    });
  });

  describe('Sync Log Management', () => {
    it('should log a successful sync', async () => {
      const syncData = {
        entityIds: ['sensor.test1', 'sensor.test2'],
        recordsSynced: 100,
        startTime: new Date('2024-01-01T00:00:00Z'),
        endTime: new Date('2024-01-02T00:00:00Z'),
        period: 'hour',
        duration: 1500,
        success: true,
      };

      const result = await fastify.mongo.logSync(syncData);
      expect(result._id).toBeTruthy();
      expect(result.entityIds).toEqual(syncData.entityIds);
      expect(result.recordsSynced).toBe(100);
      expect(result.success).toBe(true);
    });

    it('should log a failed sync', async () => {
      const syncData = {
        entityIds: ['sensor.fail'],
        recordsSynced: 0,
        success: false,
        error: 'Connection timeout',
      };

      const result = await fastify.mongo.logSync(syncData);
      expect(result.success).toBe(false);
      expect(result.error).toBe('Connection timeout');
    });

    it('should get recent syncs', async () => {
      const syncs = await fastify.mongo.getRecentSyncs(10);
      expect(Array.isArray(syncs)).toBe(true);
      expect(syncs.length).toBeGreaterThan(0);
      // Should be in descending order by createdAt
      if (syncs.length > 1) {
        expect(syncs[0].createdAt >= syncs[1].createdAt).toBe(true);
      }
    });

    it('should filter syncs by entity ID', async () => {
      await fastify.mongo.logSync({
        entityIds: ['sensor.filter_test'],
        recordsSynced: 50,
        success: true,
      });

      const syncs = await fastify.mongo.getRecentSyncs(10, {
        entityId: 'sensor.filter_test',
      });
      expect(
        syncs.every((s) => s.entityIds.includes('sensor.filter_test'))
      ).toBe(true);
    });

    it('should filter syncs by success status', async () => {
      const successfulSyncs = await fastify.mongo.getRecentSyncs(10, {
        success: true,
      });
      const failedSyncs = await fastify.mongo.getRecentSyncs(10, {
        success: false,
      });

      expect(successfulSyncs.every((s) => s.success === true)).toBe(true);
      expect(failedSyncs.every((s) => s.success === false)).toBe(true);
    });

    it('should get last successful sync', async () => {
      const lastSync = await fastify.mongo.getLastSuccessfulSync();
      expect(lastSync).toBeTruthy();
      expect(lastSync.success).toBe(true);
    });

    it('should get last successful sync for specific entity', async () => {
      await fastify.mongo.logSync({
        entityIds: ['sensor.specific_entity'],
        recordsSynced: 25,
        success: true,
      });

      const lastSync = await fastify.mongo.getLastSuccessfulSync(
        'sensor.specific_entity'
      );
      expect(lastSync).toBeTruthy();
      expect(lastSync.entityIds.includes('sensor.specific_entity')).toBe(true);
    });

    it('should get sync statistics', async () => {
      const stats = await fastify.mongo.getSyncStats();
      expect(stats.totalSyncs).toBeGreaterThanOrEqual(0);
      expect(stats.successfulSyncs).toBeGreaterThanOrEqual(0);
      expect(stats.failedSyncs).toBeGreaterThanOrEqual(0);
      expect(stats.totalRecordsSynced).toBeGreaterThanOrEqual(0);
      expect(stats.totalSyncs).toBe(stats.successfulSyncs + stats.failedSyncs);
    });
  });

  describe('Database Statistics', () => {
    it('should get database stats', async () => {
      const stats = await fastify.mongo.getStats();
      expect(stats.database).toBeTruthy();
      expect(stats.collections).toBeTruthy();
      expect(stats.collections.settings).toBeDefined();
      expect(stats.collections.entities).toBeDefined();
      expect(stats.collections.subscriptionState).toBeDefined();
      expect(stats.collections.syncLog).toBeDefined();
      expect(stats.dataSize).toBeGreaterThanOrEqual(0);
      expect(stats.indexSize).toBeGreaterThanOrEqual(0);
      expect(stats.totalSize).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Plugin Integration', () => {
    it('should decorate fastify instance with mongo', async () => {
      expect(fastify.mongo).toBeTruthy();
      expect(typeof fastify.mongo.healthCheck).toBe('function');
      expect(typeof fastify.mongo.getSetting).toBe('function');
      expect(typeof fastify.mongo.upsertEntity).toBe('function');
    });

    it('should provide access to collections', async () => {
      expect(fastify.mongo.collections).toBeTruthy();
      expect(fastify.mongo.collections.settings).toBeTruthy();
      expect(fastify.mongo.collections.entities).toBeTruthy();
      expect(fastify.mongo.collections.subscriptionState).toBeTruthy();
      expect(fastify.mongo.collections.syncLog).toBeTruthy();
    });

    it('should provide access to db and client', async () => {
      expect(fastify.mongo.db).toBeTruthy();
      expect(fastify.mongo.client).toBeTruthy();
    });
  });
});
