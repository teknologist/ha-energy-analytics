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
              status: { type: 'string', enum: ['ok'] },
              homeAssistant: { type: 'boolean' },
              mongodb: { type: 'boolean' },
              questdb: { type: 'boolean' },
              timestamp: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              status: { type: 'string', enum: ['degraded'] },
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
      const questdbConnected = fastify.questdb?.isConnected() || false;

      // Core services health determines overall status
      const isHealthy = mongoHealth.healthy && questdbConnected;

      const response = {
        status: isHealthy ? 'ok' : 'degraded',
        homeAssistant: fastify.ha?.isConnected() || false,
        mongodb: mongoHealth.healthy,
        questdb: questdbConnected,
        timestamp: new Date().toISOString(),
      };

      if (!isHealthy) {
        return reply.code(503).send(response);
      }

      return response;
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
          connected: fastify.ha?.isConnected() || false,
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
