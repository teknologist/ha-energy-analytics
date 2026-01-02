export default async function rootRoutes(fastify, options) {
  fastify.get(
    '/api/health',
    {
      schema: {
        description: 'Health check endpoint',
        tags: ['system'],
        response: {
          200: {
            type: 'object',
            properties: {
              status: { type: 'string' },
              homeAssistant: { type: 'boolean' },
              mongodb: { type: 'boolean' },
              questdb: { type: 'boolean' },
              timestamp: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const mongoHealth = await fastify.mongo.healthCheck();

      return {
        status: 'ok',
        homeAssistant: fastify.ha?.connected || false,
        mongodb: mongoHealth.healthy,
        questdb: fastify.questdb?.isConnected() || false,
        timestamp: new Date().toISOString(),
      };
    }
  );

  fastify.get(
    '/api/status',
    {
      schema: {
        description: 'Detailed system status',
        tags: ['system'],
      },
    },
    async (request, reply) => {
      const cachedEntities = await fastify.mongo.getEntities({
        isTracked: true,
      });
      const dbStats = await fastify.mongo.getStats();
      const syncStats = await fastify.mongo.getSyncStats();

      return {
        system: {
          status: 'running',
          uptime: process.uptime(),
          memory: process.memoryUsage(),
        },
        homeAssistant: {
          connected: fastify.ha?.connected || false,
          url: process.env.HA_URL || 'not configured',
        },
        database: {
          mongodb: {
            collections: dbStats.collections,
            dataSize: dbStats.dataSize,
            indexSize: dbStats.indexSize,
          },
          sync: {
            totalSyncs: syncStats.totalSyncs,
            successfulSyncs: syncStats.successfulSyncs,
            failedSyncs: syncStats.failedSyncs,
            totalRecordsSynced: syncStats.totalRecordsSynced,
            lastSync: syncStats.lastSync,
          },
        },
        cache: {
          entities: cachedEntities.length,
        },
      };
    }
  );
}
