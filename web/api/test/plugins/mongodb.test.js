import { test, describe, before, after } from 'node:test';
import assert from 'node:assert';
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

  before(async () => {
    // Create a fresh fastify instance
    fastify = Fastify({ logger: false });

    // Set test database URI
    process.env.MONGODB_URI = TEST_MONGODB_URI;

    // Register plugin
    await fastify.register(mongodbPlugin);
    await fastify.ready();
  });

  after(async () => {
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
    test('should return healthy status', async () => {
      const health = await fastify.mongo.healthCheck();
      assert.strictEqual(health.healthy, true);
      assert.ok(health.timestamp instanceof Date);
    });
  });

  describe('Settings CRUD', () => {
    test('should set and get a setting', async () => {
      const result = await fastify.mongo.setSetting('test_key', 'test_value');
      assert.strictEqual(result.key, 'test_key');
      assert.strictEqual(result.value, 'test_value');

      const value = await fastify.mongo.getSetting('test_key');
      assert.strictEqual(value, 'test_value');
    });

    test('should return undefined for non-existent setting', async () => {
      const value = await fastify.mongo.getSetting('non_existent');
      assert.strictEqual(value, undefined);
    });

    test('should update existing setting', async () => {
      await fastify.mongo.setSetting('update_test', 'initial');
      await fastify.mongo.setSetting('update_test', 'updated');

      const value = await fastify.mongo.getSetting('update_test');
      assert.strictEqual(value, 'updated');
    });

    test('should get all settings', async () => {
      await fastify.mongo.setSetting('setting1', 'value1');
      await fastify.mongo.setSetting('setting2', 'value2');

      const settings = await fastify.mongo.getAllSettings();
      assert.ok(settings.setting1);
      assert.ok(settings.setting2);
    });

    test('should delete a setting', async () => {
      await fastify.mongo.setSetting('delete_test', 'value');
      const deleted = await fastify.mongo.deleteSetting('delete_test');
      assert.strictEqual(deleted, true);

      const value = await fastify.mongo.getSetting('delete_test');
      assert.strictEqual(value, undefined);
    });

    test('should return false when deleting non-existent setting', async () => {
      const deleted = await fastify.mongo.deleteSetting('non_existent');
      assert.strictEqual(deleted, false);
    });
  });

  describe('Entity Management', () => {
    test('should upsert a new entity', async () => {
      const entity = {
        entity_id: 'sensor.test_power',
        friendly_name: 'Test Power Sensor',
        device_class: 'power',
        unit_of_measurement: 'W',
        state: '100',
      };

      const result = await fastify.mongo.upsertEntity(entity);
      assert.strictEqual(result.entityId, 'sensor.test_power');
      assert.strictEqual(result.friendlyName, 'Test Power Sensor');
      assert.strictEqual(result.deviceClass, 'power');
      assert.strictEqual(result.unitOfMeasurement, 'W');
      assert.strictEqual(result.isTracked, true);
    });

    test('should update existing entity', async () => {
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
      assert.strictEqual(fetched.friendlyName, 'Updated Name');
      assert.strictEqual(fetched.state, '75');
    });

    test('should get all entities', async () => {
      const entities = await fastify.mongo.getEntities();
      assert.ok(Array.isArray(entities));
      assert.ok(entities.length > 0);
    });

    test('should filter entities by isTracked', async () => {
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

      assert.ok(tracked.some((e) => e.entityId === 'sensor.tracked'));
      assert.ok(!tracked.some((e) => e.entityId === 'sensor.untracked'));
      assert.ok(untracked.some((e) => e.entityId === 'sensor.untracked'));
    });

    test('should filter entities by deviceClass', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.energy_device',
        device_class: 'energy',
      });

      const energyEntities = await fastify.mongo.getEntities({
        deviceClass: 'energy',
      });
      assert.ok(
        energyEntities.some((e) => e.entityId === 'sensor.energy_device')
      );
    });

    test('should get single entity by ID', async () => {
      const entity = await fastify.mongo.getEntity('sensor.test_power');
      assert.strictEqual(entity.entityId, 'sensor.test_power');
    });

    test('should return null for non-existent entity', async () => {
      const entity = await fastify.mongo.getEntity('sensor.non_existent');
      assert.strictEqual(entity, null);
    });

    test('should set entity tracked status', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.track_test',
        isTracked: true,
      });

      const updated = await fastify.mongo.setEntityTracked(
        'sensor.track_test',
        false
      );
      assert.strictEqual(updated, true);

      const entity = await fastify.mongo.getEntity('sensor.track_test');
      assert.strictEqual(entity.isTracked, false);
    });

    test('should delete entity', async () => {
      await fastify.mongo.upsertEntity({
        entity_id: 'sensor.delete_test',
      });

      const deleted = await fastify.mongo.deleteEntity('sensor.delete_test');
      assert.strictEqual(deleted, true);

      const entity = await fastify.mongo.getEntity('sensor.delete_test');
      assert.strictEqual(entity, null);
    });
  });

  describe('Subscription State Management', () => {
    test('should create subscription state', async () => {
      const state = {
        subscriptionId: 'sub_123',
        isActive: true,
        eventCount: 10,
      };

      const result = await fastify.mongo.updateSubscriptionState(
        'sensor.test_power',
        state
      );
      assert.strictEqual(result.entityId, 'sensor.test_power');
      assert.strictEqual(result.subscriptionId, 'sub_123');
      assert.strictEqual(result.isActive, true);
      assert.strictEqual(result.eventCount, 10);
    });

    test('should get subscription state for entity', async () => {
      const state =
        await fastify.mongo.getSubscriptionState('sensor.test_power');
      assert.strictEqual(state.entityId, 'sensor.test_power');
      assert.strictEqual(state.subscriptionId, 'sub_123');
    });

    test('should get all subscription states', async () => {
      const states = await fastify.mongo.getSubscriptionState();
      assert.ok(Array.isArray(states));
      assert.ok(states.length > 0);
    });

    test('should increment event count', async () => {
      const initialState =
        await fastify.mongo.getSubscriptionState('sensor.test_power');
      const initialCount = initialState.eventCount;

      await fastify.mongo.incrementEventCount('sensor.test_power');

      const updatedState =
        await fastify.mongo.getSubscriptionState('sensor.test_power');
      assert.strictEqual(updatedState.eventCount, initialCount + 1);
      assert.ok(updatedState.lastEventAt instanceof Date);
    });

    test('should clear subscription state for specific entity', async () => {
      await fastify.mongo.updateSubscriptionState('sensor.clear_test', {
        subscriptionId: 'sub_clear',
      });

      const cleared =
        await fastify.mongo.clearSubscriptionState('sensor.clear_test');
      assert.strictEqual(cleared, true);

      const state =
        await fastify.mongo.getSubscriptionState('sensor.clear_test');
      assert.strictEqual(state, null);
    });

    test('should clear all subscription states', async () => {
      await fastify.mongo.updateSubscriptionState('sensor.clear_all_1', {
        subscriptionId: 'sub1',
      });
      await fastify.mongo.updateSubscriptionState('sensor.clear_all_2', {
        subscriptionId: 'sub2',
      });

      const count = await fastify.mongo.clearSubscriptionState();
      assert.ok(count >= 2);

      const states = await fastify.mongo.getSubscriptionState();
      assert.strictEqual(states.length, 0);
    });
  });

  describe('Sync Log Management', () => {
    test('should log a successful sync', async () => {
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
      assert.ok(result._id);
      assert.deepStrictEqual(result.entityIds, syncData.entityIds);
      assert.strictEqual(result.recordsSynced, 100);
      assert.strictEqual(result.success, true);
    });

    test('should log a failed sync', async () => {
      const syncData = {
        entityIds: ['sensor.fail'],
        recordsSynced: 0,
        success: false,
        error: 'Connection timeout',
      };

      const result = await fastify.mongo.logSync(syncData);
      assert.strictEqual(result.success, false);
      assert.strictEqual(result.error, 'Connection timeout');
    });

    test('should get recent syncs', async () => {
      const syncs = await fastify.mongo.getRecentSyncs(10);
      assert.ok(Array.isArray(syncs));
      assert.ok(syncs.length > 0);
      // Should be in descending order by createdAt
      if (syncs.length > 1) {
        assert.ok(syncs[0].createdAt >= syncs[1].createdAt);
      }
    });

    test('should filter syncs by entity ID', async () => {
      await fastify.mongo.logSync({
        entityIds: ['sensor.filter_test'],
        recordsSynced: 50,
        success: true,
      });

      const syncs = await fastify.mongo.getRecentSyncs(10, {
        entityId: 'sensor.filter_test',
      });
      assert.ok(syncs.every((s) => s.entityIds.includes('sensor.filter_test')));
    });

    test('should filter syncs by success status', async () => {
      const successfulSyncs = await fastify.mongo.getRecentSyncs(10, {
        success: true,
      });
      const failedSyncs = await fastify.mongo.getRecentSyncs(10, {
        success: false,
      });

      assert.ok(successfulSyncs.every((s) => s.success === true));
      assert.ok(failedSyncs.every((s) => s.success === false));
    });

    test('should get last successful sync', async () => {
      const lastSync = await fastify.mongo.getLastSuccessfulSync();
      assert.ok(lastSync);
      assert.strictEqual(lastSync.success, true);
    });

    test('should get last successful sync for specific entity', async () => {
      await fastify.mongo.logSync({
        entityIds: ['sensor.specific_entity'],
        recordsSynced: 25,
        success: true,
      });

      const lastSync = await fastify.mongo.getLastSuccessfulSync(
        'sensor.specific_entity'
      );
      assert.ok(lastSync);
      assert.ok(lastSync.entityIds.includes('sensor.specific_entity'));
    });

    test('should get sync statistics', async () => {
      const stats = await fastify.mongo.getSyncStats();
      assert.ok(stats.totalSyncs >= 0);
      assert.ok(stats.successfulSyncs >= 0);
      assert.ok(stats.failedSyncs >= 0);
      assert.ok(stats.totalRecordsSynced >= 0);
      assert.strictEqual(
        stats.totalSyncs,
        stats.successfulSyncs + stats.failedSyncs
      );
    });
  });

  describe('Database Statistics', () => {
    test('should get database stats', async () => {
      const stats = await fastify.mongo.getStats();
      assert.ok(stats.database);
      assert.ok(stats.collections);
      assert.ok(stats.collections.settings !== undefined);
      assert.ok(stats.collections.entities !== undefined);
      assert.ok(stats.collections.subscriptionState !== undefined);
      assert.ok(stats.collections.syncLog !== undefined);
      assert.ok(stats.dataSize >= 0);
      assert.ok(stats.indexSize >= 0);
      assert.ok(stats.totalSize >= 0);
    });
  });

  describe('Plugin Integration', () => {
    test('should decorate fastify instance with mongo', async () => {
      assert.ok(fastify.mongo);
      assert.ok(typeof fastify.mongo.healthCheck === 'function');
      assert.ok(typeof fastify.mongo.getSetting === 'function');
      assert.ok(typeof fastify.mongo.upsertEntity === 'function');
    });

    test('should provide access to collections', async () => {
      assert.ok(fastify.mongo.collections);
      assert.ok(fastify.mongo.collections.settings);
      assert.ok(fastify.mongo.collections.entities);
      assert.ok(fastify.mongo.collections.subscriptionState);
      assert.ok(fastify.mongo.collections.syncLog);
    });

    test('should provide access to db and client', async () => {
      assert.ok(fastify.mongo.db);
      assert.ok(fastify.mongo.client);
    });
  });
});
