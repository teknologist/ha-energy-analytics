export default async function statisticsRoutes(fastify, options) {
  // Sync statistics from Home Assistant
  fastify.post(
    '/api/statistics/sync',
    {
      schema: {
        description:
          'Sync energy statistics from Home Assistant to local cache',
        tags: ['statistics'],
        body: {
          type: 'object',
          properties: {
            entity_ids: {
              type: 'array',
              items: { type: 'string' },
              description: 'Entity IDs to sync (empty for all energy entities)',
            },
            start_time: {
              type: 'string',
              format: 'date-time',
              description: 'Start time (defaults to 30 days ago)',
            },
            end_time: {
              type: 'string',
              format: 'date-time',
              description: 'End time (defaults to now)',
            },
            period: {
              type: 'string',
              enum: ['5minute', 'hour', 'day', 'week', 'month'],
              default: 'hour',
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!fastify.ha) {
        return reply.code(503).send({
          error: 'Home Assistant not connected',
        });
      }

      try {
        const {
          entity_ids,
          start_time,
          end_time,
          period = 'hour',
        } = request.body || {};

        // Default to last 30 days
        const endTime = end_time || new Date().toISOString();
        const startTime =
          start_time ||
          new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        // Get entity IDs to sync
        let entitiesToSync = entity_ids;
        if (!entitiesToSync || entitiesToSync.length === 0) {
          const energyEntities = await fastify.ha.getEnergyEntities();
          entitiesToSync = energyEntities.map((e) => e.entity_id);
        }

        fastify.log.info(
          `Syncing ${entitiesToSync.length} entities from ${startTime} to ${endTime}`
        );

        // Fetch statistics from HA
        const stats = await fastify.ha.getStatistics(
          entitiesToSync,
          startTime,
          endTime,
          period
        );

        // Transform and store in local DB
        let totalRecords = 0;
        const records = [];

        for (const [entityId, entityStats] of Object.entries(stats)) {
          for (const stat of entityStats) {
            records.push({
              entity_id: entityId,
              start_time: stat.start,
              end_time: stat.end,
              state: stat.state,
              sum: stat.sum,
              mean: stat.mean,
              min: stat.min,
              max: stat.max,
              period,
            });
          }
          totalRecords += entityStats.length;
        }

        // TODO: Store statistics in QuestDB (TEK-36)
        // if (records.length > 0) {
        //   await fastify.questdb.insertStatsBatch(records)
        // }

        // Log sync to MongoDB
        await fastify.mongo.logSync({
          entityIds: entitiesToSync,
          recordsSynced: totalRecords,
          startTime,
          endTime,
          period,
          success: true,
        });

        return {
          success: true,
          warning:
            'Statistics fetched but not yet persisted to QuestDB (TEK-36 pending)',
          entities_synced: Object.keys(stats).length,
          records_synced: totalRecords,
          period,
          time_range: { start: startTime, end: endTime },
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get statistics for an entity
  fastify.get(
    '/api/statistics/:entity_id',
    {
      schema: {
        description: 'Get cached statistics for an entity',
        tags: ['statistics'],
        params: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
          },
          required: ['entity_id'],
        },
        querystring: {
          type: 'object',
          properties: {
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_id } = request.params;
      const { start_time, end_time } = request.query;

      const endTime = end_time || new Date().toISOString();
      const startTime =
        start_time ||
        new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

      // TODO: Get statistics from QuestDB (TEK-36)
      // const stats = await fastify.questdb.getStatistics(entity_id, startTime, endTime)
      const stats = [];

      return {
        entity_id,
        time_range: { start: startTime, end: endTime },
        count: stats.length,
        data: stats,
      };
    }
  );

  // Get daily summary
  fastify.get(
    '/api/statistics/:entity_id/daily',
    {
      schema: {
        description: 'Get daily summary for an entity',
        tags: ['statistics'],
        params: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
          },
          required: ['entity_id'],
        },
        querystring: {
          type: 'object',
          properties: {
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_id } = request.params;
      const { start_time, end_time } = request.query;

      const endTime = end_time || new Date().toISOString();
      const startTime =
        start_time ||
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // TODO: Get daily summary from QuestDB (TEK-36)
      // const summary = await fastify.questdb.getDailySummary(entity_id, startTime, endTime)
      const summary = [];

      return {
        entity_id,
        period: 'daily',
        time_range: { start: startTime, end: endTime },
        data: summary,
      };
    }
  );

  // Get monthly summary
  fastify.get(
    '/api/statistics/:entity_id/monthly',
    {
      schema: {
        description: 'Get monthly summary for an entity',
        tags: ['statistics'],
        params: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
          },
          required: ['entity_id'],
        },
        querystring: {
          type: 'object',
          properties: {
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_id } = request.params;
      const { start_time, end_time } = request.query;

      const endTime = end_time || new Date().toISOString();
      const startTime =
        start_time ||
        new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

      // TODO: Get monthly summary from QuestDB (TEK-36)
      // const summary = await fastify.questdb.getMonthlySummary(entity_id, startTime, endTime)
      const summary = [];

      return {
        entity_id,
        period: 'monthly',
        time_range: { start: startTime, end: endTime },
        data: summary,
      };
    }
  );

  // Compare multiple entities
  fastify.post(
    '/api/statistics/compare',
    {
      schema: {
        description: 'Compare statistics across multiple entities',
        tags: ['statistics'],
        body: {
          type: 'object',
          properties: {
            entity_ids: {
              type: 'array',
              items: { type: 'string' },
              minItems: 1,
            },
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            aggregation: {
              type: 'string',
              enum: ['hourly', 'daily', 'monthly'],
              default: 'daily',
            },
          },
          required: ['entity_ids'],
        },
      },
    },
    async (request, reply) => {
      const {
        entity_ids,
        start_time,
        end_time,
        aggregation = 'daily',
      } = request.body;

      const endTime = end_time || new Date().toISOString();
      const startTime =
        start_time ||
        new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

      // TODO: Get statistics from QuestDB (TEK-36)
      const results = {};

      for (const entityId of entity_ids) {
        // if (aggregation === 'monthly') {
        //   results[entityId] = await fastify.questdb.getMonthlySummary(entityId, startTime, endTime)
        // } else if (aggregation === 'daily') {
        //   results[entityId] = await fastify.questdb.getDailySummary(entityId, startTime, endTime)
        // } else {
        //   results[entityId] = await fastify.questdb.getStatistics(entityId, startTime, endTime)
        // }
        results[entityId] = [];
      }

      return {
        entity_ids,
        aggregation,
        time_range: { start: startTime, end: endTime },
        data: results,
      };
    }
  );
}
