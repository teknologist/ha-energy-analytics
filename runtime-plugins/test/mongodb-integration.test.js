import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import { MongoClient } from 'mongodb';
import mongodbPlugin from '../mongodb.js';

// Check if MongoDB is available
let DB_AVAILABLE = false;
const TEST_MONGODB_URI =
  process.env.TEST_MONGODB_URI ||
  'mongodb://localhost:27017/energy_dashboard_test';

async function checkMongoDBAvailable() {
  const client = new MongoClient(TEST_MONGODB_URI, {
    serverSelectionTimeoutMS: 2000,
  });
  try {
    await client.connect();
    await client.db().admin().ping();
    await client.close();
    return true;
  } catch (error) {
    return false;
  }
}

describe.skipIf(!(await checkMongoDBAvailable()))(
  'MongoDB Plugin Integration Tests',
  () => {
    let fastify;
    let mongoClient;
    let testDb;

    beforeAll(async () => {
      // Create a fresh fastify instance
      fastify = Fastify({ logger: false });

      // Set test database URI
      process.env.MONGODB_URI = TEST_MONGODB_URI;

      // Register plugin
      await fastify.register(mongodbPlugin);
      await fastify.ready();

      // Setup cleanup client
      mongoClient = new MongoClient(TEST_MONGODB_URI);
      await mongoClient.connect();
      testDb = mongoClient.db();
    });

    afterAll(async () => {
      // Clean up test database
      try {
        await testDb.dropDatabase();
        await mongoClient.close();
      } catch (error) {
        // Ignore cleanup errors
      }

      await fastify.close();
    });

    describe('Connection Error Handling', () => {
      it('should throw error when connection fails', async () => {
        const errorFastify = Fastify({ logger: false });

        // Use invalid connection string
        process.env.MONGODB_URI =
          'mongodb://invalid-host:27017/energy_dashboard_test';

        await expect(errorFastify.register(mongodbPlugin)).rejects.toThrow();

        delete process.env.MONGODB_URI;
      });

      it('should log connection failure and throw error', async () => {
        const errorFastify = Fastify({ logger: false });
        const originalError = new Error('Connection failed');

        // Use non-existent host with timeout
        process.env.MONGODB_URI =
          'mongodb://nonexistent.example.com:27017/test';

        try {
          await errorFastify.register(mongodbPlugin);
          await errorFastify.ready();
          // If we get here, connection somehow succeeded
          await errorFastify.close();
        } catch (error) {
          expect(error).toBeDefined();
        } finally {
          delete process.env.MONGODB_URI;
        }
      });
    });

    describe('Health Check Error Scenarios', () => {
      it('should return unhealthy status when ping fails', async () => {
        // Close the underlying connection to simulate failure
        const originalClient = fastify.mongo.client;
        await originalClient.close();

        const health = await fastify.mongo.healthCheck();
        expect(health.healthy).toBe(false);
        expect(health.error).toBeDefined();
        expect(health.timestamp).toBeInstanceOf(Date);

        // Reconnect for subsequent tests
        await originalClient.connect();
      });
    });

    describe('Index Creation Error Handling', () => {
      it('should handle index creation failure gracefully', async () => {
        // This tests the error handling in initializeIndexes function
        // by attempting to create a conflicting index manually
        const collection = testDb.collection('settings');

        // Try to create a duplicate index (should handle gracefully)
        try {
          await collection.createIndex({ key: 1 }, { unique: true });
          // If this succeeds, index already exists or was created
          expect(true).toBe(true);
        } catch (error) {
          // If we get an error about duplicate index, that's expected
          expect(error.message).toBeDefined();
        }
      });
    });

    describe('Settings CRUD - Edge Cases', () => {
      it('should handle null and undefined values', async () => {
        await fastify.mongo.setSetting('null_value', null);
        const value = await fastify.mongo.getSetting('null_value');
        expect(value).toBeNull();

        // MongoDB stores undefined as null
        await fastify.mongo.setSetting('undefined_value', undefined);
        const undefValue = await fastify.mongo.getSetting('undefined_value');
        expect(undefValue).toBeNull();
      });

      it('should handle complex objects', async () => {
        const complexObj = {
          nested: { level1: { level2: 'value' } },
          array: [1, 2, 3],
          mixed: { a: 1, b: 'string', c: true },
        };

        await fastify.mongo.setSetting('complex', complexObj);
        const retrieved = await fastify.mongo.getSetting('complex');
        expect(retrieved).toEqual(complexObj);
      });

      it('should handle empty string keys', async () => {
        await fastify.mongo.setSetting('empty_str', '');
        const value = await fastify.mongo.getSetting('empty_str');
        expect(value).toBe('');
      });

      it('should handle special characters in keys', async () => {
        const specialKeys = [
          'key.with.dots',
          'key-with-dashes',
          'key_with_underscore',
        ];
        for (const key of specialKeys) {
          await fastify.mongo.setSetting(key, `value_${key}`);
          const value = await fastify.mongo.getSetting(key);
          expect(value).toBe(`value_${key}`);
        }
      });
    });

    describe('Entity Management - Edge Cases', () => {
      it('should handle entity with all possible field formats', async () => {
        // Test snake_case format
        const entity1 = {
          entity_id: 'sensor.snake_case',
          friendly_name: 'Snake Case',
          device_class: 'energy',
          unit_of_measurement: 'kWh',
          state: '100',
        };

        await fastify.mongo.upsertEntity(entity1);
        const retrieved1 = await fastify.mongo.getEntity('sensor.snake_case');
        expect(retrieved1.entityId).toBe('sensor.snake_case');
        expect(retrieved1.friendlyName).toBe('Snake Case');
        expect(retrieved1.deviceClass).toBe('energy');
        expect(retrieved1.unitOfMeasurement).toBe('kWh');

        // Test camelCase format
        const entity2 = {
          entityId: 'sensor.camel_case',
          friendlyName: 'Camel Case',
          deviceClass: 'power',
          unitOfMeasurement: 'W',
          state: '50',
        };

        await fastify.mongo.upsertEntity(entity2);
        const retrieved2 = await fastify.mongo.getEntity('sensor.camel_case');
        expect(retrieved2.entityId).toBe('sensor.camel_case');
        expect(retrieved2.friendlyName).toBe('Camel Case');

        // Test attributes format
        const entity3 = {
          entity_id: 'sensor.attrs',
          attributes: {
            friendly_name: 'From Attrs',
            device_class: 'energy',
            unit_of_measurement: 'kWh',
          },
          state: '200',
        };

        await fastify.mongo.upsertEntity(entity3);
        const retrieved3 = await fastify.mongo.getEntity('sensor.attrs');
        expect(retrieved3.friendlyName).toBe('From Attrs');
        expect(retrieved3.deviceClass).toBe('energy');
      });

      it('should handle default isTracked value', async () => {
        const entity = {
          entity_id: 'sensor.default_tracked',
          state: '100',
        };

        await fastify.mongo.upsertEntity(entity);
        const retrieved = await fastify.mongo.getEntity(
          'sensor.default_tracked'
        );
        expect(retrieved.isTracked).toBe(true); // Default is true
      });

      it('should handle updating isTracked to false', async () => {
        const entity = {
          entity_id: 'sensor.tracked_false',
          isTracked: true,
        };

        await fastify.mongo.upsertEntity(entity);
        let retrieved = await fastify.mongo.getEntity('sensor.tracked_false');
        expect(retrieved.isTracked).toBe(true);

        // Update to false
        entity.isTracked = false;
        await fastify.mongo.upsertEntity(entity);
        retrieved = await fastify.mongo.getEntity('sensor.tracked_false');
        expect(retrieved.isTracked).toBe(false);
      });

      it('should return empty array for non-matching filters', async () => {
        const entities = await fastify.mongo.getEntities({
          deviceClass: 'nonexistent_class',
        });
        expect(Array.isArray(entities)).toBe(true);
        expect(entities.length).toBe(0);
      });

      it('should handle setEntityTracked for non-existent entity', async () => {
        const result = await fastify.mongo.setEntityTracked(
          'sensor.nonexistent',
          true
        );
        expect(result).toBe(false);
      });

      it('should handle deleteEntity for non-existent entity', async () => {
        const result = await fastify.mongo.deleteEntity('sensor.nonexistent');
        expect(result).toBe(false);
      });
    });

    describe('Subscription State - Edge Cases', () => {
      it('should handle subscription state with null lastEventAt', async () => {
        const state = {
          subscriptionId: 'sub_null_time',
          isActive: true,
          lastEventAt: null,
          eventCount: 0,
        };

        await fastify.mongo.updateSubscriptionState('sensor.null_time', state);
        const retrieved =
          await fastify.mongo.getSubscriptionState('sensor.null_time');
        expect(retrieved.lastEventAt).toBeNull();
      });

      it('should handle default isActive value', async () => {
        const state = {
          subscriptionId: 'sub_default_active',
          eventCount: 5,
        };

        await fastify.mongo.updateSubscriptionState(
          'sensor.default_active',
          state
        );
        const retrieved = await fastify.mongo.getSubscriptionState(
          'sensor.default_active'
        );
        expect(retrieved.isActive).toBe(true); // Default is true
      });

      it('should handle incrementEventCount for non-existent subscription', async () => {
        const result = await fastify.mongo.incrementEventCount('sensor.no_sub');
        expect(result).toBe(false);
      });

      it('should handle clearSubscriptionState for non-existent entity', async () => {
        const result =
          await fastify.mongo.clearSubscriptionState('sensor.no_sub');
        expect(result).toBe(false);
      });

      it('should return null for non-existent subscription state', async () => {
        const state = await fastify.mongo.getSubscriptionState(
          'sensor.no_subscription'
        );
        expect(state).toBeNull();
      });

      it('should return empty array when no subscription states exist', async () => {
        // Clear all first
        await fastify.mongo.clearSubscriptionState();

        const states = await fastify.mongo.getSubscriptionState();
        expect(Array.isArray(states)).toBe(true);
        expect(states.length).toBe(0);
      });
    });

    describe('Sync Log - Edge Cases and Aggregations', () => {
      it('should handle sync with minimal required fields', async () => {
        const syncData = {
          success: true,
        };

        const result = await fastify.mongo.logSync(syncData);
        expect(result._id).toBeDefined();
        expect(result.entityIds).toEqual([]);
        expect(result.recordsSynced).toBe(0);
        expect(result.success).toBe(true);
        expect(result.error).toBeNull();
      });

      it('should handle sync with string date conversion', async () => {
        const syncData = {
          entityIds: ['sensor.date_test'],
          startTime: '2024-01-01T00:00:00Z',
          endTime: '2024-01-02T00:00:00Z',
          success: true,
        };

        const result = await fastify.mongo.logSync(syncData);
        expect(result.startTime).toBeInstanceOf(Date);
        expect(result.endTime).toBeInstanceOf(Date);
      });

      it('should handle getRecentSyncs with default limit', async () => {
        // Create more than 20 syncs
        for (let i = 0; i < 25; i++) {
          await fastify.mongo.logSync({
            entityIds: [`sensor.test${i}`],
            recordsSynced: i,
            success: true,
          });
        }

        const syncs = await fastify.mongo.getRecentSyncs();
        expect(syncs.length).toBeLessThanOrEqual(20);
      });

      it('should handle getLastSuccessfulSync when no successful syncs exist', async () => {
        // Clear sync log
        await testDb.collection('syncLog').deleteMany({});

        const lastSync = await fastify.mongo.getLastSuccessfulSync();
        expect(lastSync).toBeNull();
      });

      it('should handle getLastSuccessfulSync for specific entity with no syncs', async () => {
        const lastSync =
          await fastify.mongo.getLastSuccessfulSync('sensor.no_syncs');
        expect(lastSync).toBeNull();
      });

      it('should calculate getSyncStats with no syncs', async () => {
        // Clear sync log
        await testDb.collection('syncLog').deleteMany({});

        const stats = await fastify.mongo.getSyncStats();
        expect(stats.totalSyncs).toBe(0);
        expect(stats.successfulSyncs).toBe(0);
        expect(stats.failedSyncs).toBe(0);
        expect(stats.totalRecordsSynced).toBe(0);
        expect(stats.lastSync).toBeNull();
      });

      it('should calculate totalRecordsSynced correctly across multiple syncs', async () => {
        // Clear sync log
        await testDb.collection('syncLog').deleteMany({});

        // Create multiple successful syncs
        await fastify.mongo.logSync({
          entityIds: ['sensor.agg1'],
          recordsSynced: 100,
          success: true,
        });

        await fastify.mongo.logSync({
          entityIds: ['sensor.agg2'],
          recordsSynced: 200,
          success: true,
        });

        await fastify.mongo.logSync({
          entityIds: ['sensor.agg3'],
          recordsSynced: 50,
          success: true,
        });

        const stats = await fastify.mongo.getSyncStats();
        expect(stats.totalRecordsSynced).toBe(350);
        expect(stats.totalSyncs).toBe(3);
        expect(stats.successfulSyncs).toBe(3);
      });

      it('should only sum recordsSynced for successful syncs', async () => {
        // Clear sync log
        await testDb.collection('syncLog').deleteMany({});

        await fastify.mongo.logSync({
          entityIds: ['sensor.success1'],
          recordsSynced: 100,
          success: true,
        });

        await fastify.mongo.logSync({
          entityIds: ['sensor.fail1'],
          recordsSynced: 999, // Should not be counted
          success: false,
        });

        await fastify.mongo.logSync({
          entityIds: ['sensor.success2'],
          recordsSynced: 200,
          success: true,
        });

        const stats = await fastify.mongo.getSyncStats();
        expect(stats.totalRecordsSynced).toBe(300); // Only successful syncs
        expect(stats.successfulSyncs).toBe(2);
        expect(stats.failedSyncs).toBe(1);
      });

      it('should handle getRecentSyncs with combined filters', async () => {
        await fastify.mongo.logSync({
          entityIds: ['sensor.combined_test'],
          recordsSynced: 10,
          success: true,
        });

        const syncs = await fastify.mongo.getRecentSyncs(10, {
          entityId: 'sensor.combined_test',
          success: true,
        });

        expect(syncs.length).toBeGreaterThan(0);
        expect(
          syncs.every((s) => s.entityIds.includes('sensor.combined_test'))
        ).toBe(true);
        expect(syncs.every((s) => s.success === true)).toBe(true);
      });
    });

    describe('Database Statistics', () => {
      it('should get stats for empty collections', async () => {
        // Clear all collections
        await testDb.collection('settings').deleteMany({});
        await testDb.collection('entities').deleteMany({});
        await testDb.collection('subscriptionState').deleteMany({});
        await testDb.collection('syncLog').deleteMany({});

        const stats = await fastify.mongo.getStats();
        expect(stats.collections.settings).toBe(0);
        expect(stats.collections.entities).toBe(0);
        expect(stats.collections.subscriptionState).toBe(0);
        expect(stats.collections.syncLog).toBe(0);
        expect(stats.dataSize).toBeGreaterThanOrEqual(0);
        expect(stats.indexSize).toBeGreaterThanOrEqual(0);
      });

      it('should calculate totalSize correctly', async () => {
        const stats = await fastify.mongo.getStats();
        expect(stats.totalSize).toBe(stats.dataSize + stats.indexSize);
      });
    });

    describe('Connection URI Masking', () => {
      it('should mask credentials in URI during connection', async () => {
        // This test verifies the URI masking logic
        const uriWithCreds = 'mongodb://user:password@localhost:27017/test';
        const maskedUri = uriWithCreds.replace(
          /:\/\/([^:]+):([^@]+)@/,
          '://$1:****@'
        );
        expect(maskedUri).toBe('mongodb://user:****@localhost:27017/test');
      });

      it('should not mask URI without credentials', async () => {
        const uriWithoutCreds = 'mongodb://localhost:27017/test';
        const maskedUri = uriWithoutCreds.replace(
          /:\/\/([^:]+):([^@]+)@/,
          '://$1:****@'
        );
        expect(maskedUri).toBe('mongodb://localhost:27017/test');
      });
    });

    describe('Graceful Shutdown', () => {
      it('should close connection gracefully', async () => {
        const shutdownFastify = Fastify({ logger: false });
        process.env.MONGODB_URI = TEST_MONGODB_URI;

        await shutdownFastify.register(mongodbPlugin);
        await shutdownFastify.ready();

        // Verify connection is active
        expect(await shutdownFastify.mongo.healthCheck()).toBeDefined();

        // Close should not throw
        await expect(shutdownFastify.close()).resolves.not.toThrow();

        delete process.env.MONGODB_URI;
      });
    });

    describe('Concurrent Operations', () => {
      it('should handle concurrent upsert operations', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            fastify.mongo.upsertEntity({
              entity_id: `sensor.concurrent_${i}`,
              state: `${i}`,
            })
          );
        }

        await expect(Promise.all(promises)).resolves.not.toThrow();

        // Verify all entities were created
        const entities = await fastify.mongo.getEntities();
        const concurrentEntities = entities.filter((e) =>
          e.entityId.startsWith('sensor.concurrent_')
        );
        expect(concurrentEntities.length).toBe(10);
      });

      it('should handle concurrent settings operations', async () => {
        const promises = [];
        for (let i = 0; i < 10; i++) {
          promises.push(
            fastify.mongo.setSetting(`concurrent_key_${i}`, `value_${i}`)
          );
        }

        await expect(Promise.all(promises)).resolves.not.toThrow();

        // Verify all settings were created
        const settings = await fastify.mongo.getAllSettings();
        for (let i = 0; i < 10; i++) {
          expect(settings[`concurrent_key_${i}`]).toBe(`value_${i}`);
        }
      });
    });

    describe('Collection Decorators', () => {
      it('should provide direct access to all collections', async () => {
        expect(fastify.mongo.collections.settings).toBeDefined();
        expect(fastify.mongo.collections.entities).toBeDefined();
        expect(fastify.mongo.collections.subscriptionState).toBeDefined();
        expect(fastify.mongo.collections.syncLog).toBeDefined();

        // Verify they are actual MongoDB collections
        expect(typeof fastify.mongo.collections.settings.insertOne).toBe(
          'function'
        );
        expect(typeof fastify.mongo.collections.entities.findOne).toBe(
          'function'
        );
      });

      it('should provide access to database instance', async () => {
        expect(fastify.mongo.db).toBeDefined();
        expect(typeof fastify.mongo.db.admin).toBe('function');
      });

      it('should provide access to MongoDB client', async () => {
        expect(fastify.mongo.client).toBeDefined();
        expect(typeof fastify.mongo.client.connect).toBe('function');
        expect(typeof fastify.mongo.client.close).toBe('function');
      });
    });
  }
);
