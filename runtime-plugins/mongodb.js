import fp from 'fastify-plugin';
import { MongoClient } from 'mongodb';

/**
 * MongoDB Plugin for Energy Dashboard
 * Manages application state: settings, entities, subscriptions, sync logs
 * Time-series data is stored in QuestDB (see questdb.js plugin)
 */
async function mongodbPlugin(fastify, options) {
  const uri =
    process.env.MONGODB_URI || 'mongodb://localhost:27017/energy_dashboard';

  // Mask credentials in log output
  const maskedUri = uri.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:****@');
  fastify.log.info(`Connecting to MongoDB at ${maskedUri}`);

  const client = new MongoClient(uri, {
    maxPoolSize: 10,
    minPoolSize: 2,
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });

  try {
    await client.connect();
    await client.db().admin().ping();
    fastify.log.info('MongoDB connected successfully');
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to connect to MongoDB');
    throw error;
  }

  const db = client.db();

  // Collection references
  const collections = {
    settings: db.collection('settings'),
    entities: db.collection('entities'),
    subscriptionState: db.collection('subscriptionState'),
    syncLog: db.collection('syncLog'),
  };

  // Create indexes for optimal query performance
  await initializeIndexes(collections, fastify.log);

  // Helper functions
  const mongoHelpers = {
    client,
    db,
    collections,

    /**
     * Health check - verifies MongoDB connection
     */
    async healthCheck() {
      try {
        await db.admin().ping();
        return { healthy: true, timestamp: new Date() };
      } catch (error) {
        return { healthy: false, error: error.message, timestamp: new Date() };
      }
    },

    /**
     * Settings CRUD Operations
     */
    async getSetting(key) {
      const doc = await collections.settings.findOne({ key });
      return doc?.value;
    },

    async setSetting(key, value) {
      await collections.settings.updateOne(
        { key },
        { $set: { key, value, updatedAt: new Date() } },
        { upsert: true }
      );
      return { key, value };
    },

    async getAllSettings() {
      const settings = await collections.settings.find({}).toArray();
      return settings.reduce((acc, doc) => {
        acc[doc.key] = doc.value;
        return acc;
      }, {});
    },

    async deleteSetting(key) {
      const result = await collections.settings.deleteOne({ key });
      return result.deletedCount > 0;
    },

    /**
     * Entity Management
     */
    async upsertEntity(entity) {
      const entityDoc = {
        entityId: entity.entity_id || entity.entityId,
        friendlyName:
          entity.friendly_name ||
          entity.friendlyName ||
          entity.attributes?.friendly_name,
        deviceClass:
          entity.device_class ||
          entity.deviceClass ||
          entity.attributes?.device_class,
        unitOfMeasurement:
          entity.unit_of_measurement ||
          entity.unitOfMeasurement ||
          entity.attributes?.unit_of_measurement,
        state: entity.state,
        isTracked: entity.isTracked !== undefined ? entity.isTracked : true,
        lastSeen: new Date(),
        updatedAt: new Date(),
      };

      await collections.entities.updateOne(
        { entityId: entityDoc.entityId },
        {
          $set: entityDoc,
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );

      return entityDoc;
    },

    async getEntities(filter = {}) {
      const query = {};

      if (filter.isTracked !== undefined) {
        query.isTracked = filter.isTracked;
      }

      if (filter.deviceClass) {
        query.deviceClass = filter.deviceClass;
      }

      return await collections.entities
        .find(query)
        .sort({ friendlyName: 1 })
        .toArray();
    },

    async getEntity(entityId) {
      return await collections.entities.findOne({ entityId });
    },

    async setEntityTracked(entityId, isTracked) {
      const result = await collections.entities.updateOne(
        { entityId },
        {
          $set: {
            isTracked,
            updatedAt: new Date(),
          },
        }
      );
      return result.modifiedCount > 0;
    },

    async deleteEntity(entityId) {
      const result = await collections.entities.deleteOne({ entityId });
      return result.deletedCount > 0;
    },

    /**
     * Subscription State Management
     * Tracks which entities are subscribed to Home Assistant events
     */
    async getSubscriptionState(entityId = null) {
      if (entityId) {
        return await collections.subscriptionState.findOne({ entityId });
      }
      return await collections.subscriptionState.find({}).toArray();
    },

    async updateSubscriptionState(entityId, state) {
      const stateDoc = {
        entityId,
        subscriptionId: state.subscriptionId,
        isActive: state.isActive !== undefined ? state.isActive : true,
        lastEventAt: state.lastEventAt ? new Date(state.lastEventAt) : null,
        eventCount: state.eventCount || 0,
        updatedAt: new Date(),
      };

      await collections.subscriptionState.updateOne(
        { entityId },
        {
          $set: stateDoc,
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );

      return stateDoc;
    },

    async incrementEventCount(entityId) {
      const result = await collections.subscriptionState.updateOne(
        { entityId },
        {
          $inc: { eventCount: 1 },
          $set: {
            lastEventAt: new Date(),
            updatedAt: new Date(),
          },
        }
      );
      return result.modifiedCount > 0;
    },

    async clearSubscriptionState(entityId = null) {
      if (entityId) {
        const result = await collections.subscriptionState.deleteOne({
          entityId,
        });
        return result.deletedCount > 0;
      }
      const result = await collections.subscriptionState.deleteMany({});
      return result.deletedCount;
    },

    /**
     * Sync Log Management
     * Tracks manual syncs from Home Assistant recorder database
     */
    async logSync(syncData) {
      const logDoc = {
        entityIds: syncData.entityIds || [],
        recordsSynced: syncData.recordsSynced || 0,
        startTime: syncData.startTime ? new Date(syncData.startTime) : null,
        endTime: syncData.endTime ? new Date(syncData.endTime) : null,
        period: syncData.period || 'hour',
        duration: syncData.duration || 0,
        success: syncData.success !== undefined ? syncData.success : true,
        error: syncData.error || null,
        createdAt: new Date(),
      };

      const result = await collections.syncLog.insertOne(logDoc);
      return { ...logDoc, _id: result.insertedId };
    },

    async getRecentSyncs(limit = 20, filter = {}) {
      const query = {};

      if (filter.entityId) {
        query.entityIds = filter.entityId;
      }

      if (filter.success !== undefined) {
        query.success = filter.success;
      }

      return await collections.syncLog
        .find(query)
        .sort({ createdAt: -1 })
        .limit(limit)
        .toArray();
    },

    async getLastSuccessfulSync(entityId = null) {
      const query = { success: true };

      if (entityId) {
        query.entityIds = entityId;
      }

      return await collections.syncLog.findOne(query, {
        sort: { createdAt: -1 },
      });
    },

    async getSyncStats() {
      const totalSyncs = await collections.syncLog.countDocuments();
      const successfulSyncs = await collections.syncLog.countDocuments({
        success: true,
      });
      const failedSyncs = await collections.syncLog.countDocuments({
        success: false,
      });

      const recentSync = await collections.syncLog.findOne(
        {},
        { sort: { createdAt: -1 } }
      );

      const totalRecordsSynced = await collections.syncLog
        .aggregate([
          { $match: { success: true } },
          { $group: { _id: null, total: { $sum: '$recordsSynced' } } },
        ])
        .toArray();

      return {
        totalSyncs,
        successfulSyncs,
        failedSyncs,
        totalRecordsSynced: totalRecordsSynced[0]?.total || 0,
        lastSync: recentSync?.createdAt || null,
      };
    },

    /**
     * Utility: Get database statistics
     */
    async getStats() {
      const stats = await db.stats();
      const collectionStats = {};

      for (const [name, collection] of Object.entries(collections)) {
        collectionStats[name] = await collection.countDocuments();
      }

      return {
        database: stats.db,
        collections: collectionStats,
        dataSize: stats.dataSize,
        indexSize: stats.indexSize,
        totalSize: stats.dataSize + stats.indexSize,
      };
    },
  };

  // Decorate fastify instance
  fastify.decorate('mongo', mongoHelpers);

  // Graceful shutdown
  fastify.addHook('onClose', async () => {
    fastify.log.info('Closing MongoDB connection');
    await client.close();
  });
}

/**
 * Initialize database indexes for optimal query performance
 */
async function initializeIndexes(collections, logger) {
  try {
    // Settings indexes
    await collections.settings.createIndex({ key: 1 }, { unique: true });

    // Entities indexes
    await collections.entities.createIndex({ entityId: 1 }, { unique: true });
    await collections.entities.createIndex({ isTracked: 1, deviceClass: 1 });
    await collections.entities.createIndex({ deviceClass: 1 });
    await collections.entities.createIndex({ lastSeen: -1 });

    // Subscription state indexes
    await collections.subscriptionState.createIndex(
      { entityId: 1 },
      { unique: true }
    );
    await collections.subscriptionState.createIndex({ isActive: 1 });
    await collections.subscriptionState.createIndex({ lastEventAt: -1 });

    // Sync log indexes
    await collections.syncLog.createIndex({ createdAt: -1 });
    await collections.syncLog.createIndex({ entityIds: 1, createdAt: -1 });
    await collections.syncLog.createIndex({ success: 1, createdAt: -1 });
    await collections.syncLog.createIndex({ period: 1, createdAt: -1 });

    logger.info('MongoDB indexes created successfully');
  } catch (error) {
    logger.error({ err: error }, 'Failed to create MongoDB indexes');
    throw error;
  }
}

export default fp(mongodbPlugin, {
  name: 'mongodb',
  dependencies: [],
});
