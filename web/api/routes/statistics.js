/**
 * Statistics API Routes
 * Provides statistics sync, retrieval, and comparison endpoints
 *
 * @module routes/statistics
 */

// Time constants in milliseconds
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// Entity ID validation pattern (Home Assistant format: domain.object_id)
const ENTITY_ID_PATTERN = /^[a-z_]+\.[a-z0-9_]+$/i;

/**
 * Validate entity ID format
 * @param {string} entityId - Entity ID to validate
 * @returns {boolean} True if valid
 */
function isValidEntityId(entityId) {
  return (
    typeof entityId === 'string' &&
    entityId.length >= 3 &&
    entityId.length <= 100 &&
    ENTITY_ID_PATTERN.test(entityId)
  );
}

export default async function statisticsRoutes(fastify, options) {
  /**
   * POST /api/statistics/sync
   * Sync statistics from Home Assistant to local cache
   */
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
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();

      if (!fastify.ha) {
        return reply.code(503).send({
          success: false,
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
          start_time || new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

        // Get entity IDs to sync
        let entitiesToSync = entity_ids;
        if (!entitiesToSync || entitiesToSync.length === 0) {
          const energyEntities = await fastify.ha.getEnergyEntities();
          entitiesToSync = energyEntities.map((e) => e.entity_id);
        }

        fastify.log.info(
          { entityCount: entitiesToSync.length, startTime, endTime },
          'Syncing entities'
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

        // Store statistics in QuestDB
        let storedRecords = 0;
        const failedEntities = [];

        if (records.length > 0) {
          try {
            // Transform records to include timestamp in correct format
            const questdbRecords = records.map((rec) => ({
              entity_id: rec.entity_id,
              period: rec.period,
              state: rec.state,
              sum: rec.sum,
              mean: rec.mean,
              min: rec.min,
              max: rec.max,
              timestamp: new Date(rec.start_time).getTime() * 1000000, // Convert to nanoseconds
            }));

            await fastify.questdb.writeStats(questdbRecords);
            storedRecords = questdbRecords.length;
          } catch (error) {
            fastify.log.error(
              { err: error },
              'Failed to write statistics to QuestDB'
            );

            // Try partial success - store entity-by-entity
            for (const [entityId, entityStats] of Object.entries(stats)) {
              try {
                const entityRecords = entityStats.map((stat) => ({
                  entity_id: entityId,
                  period,
                  state: stat.state,
                  sum: stat.sum,
                  mean: stat.mean,
                  min: stat.min,
                  max: stat.max,
                  timestamp: new Date(stat.start).getTime() * 1000000,
                }));

                await fastify.questdb.writeStats(entityRecords);
                storedRecords += entityRecords.length;
              } catch (entityError) {
                fastify.log.error(
                  { entityId, err: entityError },
                  'Failed to sync entity'
                );
                failedEntities.push({
                  entity_id: entityId,
                  error: entityError.message,
                });
              }
            }
          }
        }

        // Log sync to MongoDB
        await fastify.mongo.logSync({
          entityIds: entitiesToSync,
          recordsSynced: storedRecords,
          startTime,
          endTime,
          period,
          duration: Date.now() - startMs,
          success: failedEntities.length === 0,
          error:
            failedEntities.length > 0
              ? `${failedEntities.length} entities failed`
              : null,
        });

        const responseData = {
          entities_synced: Object.keys(stats).length - failedEntities.length,
          records_synced: storedRecords,
          period,
          time_range: { start: startTime, end: endTime },
        };

        if (failedEntities.length > 0) {
          responseData.failed_entities = failedEntities;
          responseData.partial_success = true;
        }

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: responseData,
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Sync failed');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/statistics/:entity_id
   * Get cached statistics for an entity
   */
  fastify.get(
    '/api/statistics/:entity_id',
    {
      schema: {
        description: 'Get cached statistics for an entity',
        tags: ['statistics'],
        params: {
          type: 'object',
          properties: {
            entity_id: {
              type: 'string',
              pattern: '^[a-z_]+\\.[a-z0-9_]+$',
              minLength: 3,
              maxLength: 100,
            },
          },
          required: ['entity_id'],
        },
        querystring: {
          type: 'object',
          properties: {
            start_time: { type: 'string', format: 'date-time' },
            end_time: { type: 'string', format: 'date-time' },
            period: { type: 'string', enum: ['hour', 'day'] },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { entity_id } = request.params;
        const { start_time, end_time, period } = request.query;

        // Validate entity_id format
        if (!isValidEntityId(entity_id)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid entity_id format. Expected: domain.object_id',
          });
        }

        const endTime = end_time || new Date().toISOString();
        const startTime =
          start_time || new Date(Date.now() - 7 * MS_PER_DAY).toISOString();

        // Get statistics from QuestDB
        const stats = await fastify.questdb.getStatistics(
          entity_id,
          startTime,
          endTime,
          period
        );

        // Transform QuestDB result to API format
        const statistics = stats.map((row) => ({
          timestamp: row[7], // timestamp column
          state: row[2], // state column
          sum: row[3], // sum column
          mean: row[4], // mean column
          min: row[5], // min column
          max: row[6], // max column
          period: row[1], // period column
        }));

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            entity_id,
            start_time: startTime,
            end_time: endTime,
            period: period || 'all',
            source: 'questdb',
            statistics,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get statistics');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/statistics/:entity_id/daily
   * Get daily summary for an entity
   */
  fastify.get(
    '/api/statistics/:entity_id/daily',
    {
      schema: {
        description: 'Get daily summary for an entity',
        tags: ['statistics'],
        params: {
          type: 'object',
          properties: {
            entity_id: {
              type: 'string',
              pattern: '^[a-z_]+\\.[a-z0-9_]+$',
              minLength: 3,
              maxLength: 100,
            },
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
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { entity_id } = request.params;
        const { start_time, end_time } = request.query;

        // Validate entity_id format
        if (!isValidEntityId(entity_id)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid entity_id format. Expected: domain.object_id',
          });
        }

        const endTime = end_time || new Date().toISOString();
        const startTime =
          start_time || new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

        // Get daily summary from QuestDB
        const summary = await fastify.questdb.getDailySummary(
          entity_id,
          startTime,
          endTime
        );

        // Transform QuestDB result to API format
        const dailyData = summary.map((row) => ({
          date: row[1], // timestamp
          total: row[2], // total
          avg_power: row[3], // avg_power
          peak: row[4], // peak
          readings: row[5], // readings count
        }));

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            entity_id,
            period: 'daily',
            time_range: { start: startTime, end: endTime },
            summary: dailyData,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get daily summary');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/statistics/:entity_id/monthly
   * Get monthly summary for an entity
   */
  fastify.get(
    '/api/statistics/:entity_id/monthly',
    {
      schema: {
        description: 'Get monthly summary for an entity',
        tags: ['statistics'],
        params: {
          type: 'object',
          properties: {
            entity_id: {
              type: 'string',
              pattern: '^[a-z_]+\\.[a-z0-9_]+$',
              minLength: 3,
              maxLength: 100,
            },
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
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { entity_id } = request.params;
        const { start_time, end_time } = request.query;

        // Validate entity_id format
        if (!isValidEntityId(entity_id)) {
          return reply.code(400).send({
            success: false,
            error: 'Invalid entity_id format. Expected: domain.object_id',
          });
        }

        const endTime = end_time || new Date().toISOString();
        const startTime =
          start_time || new Date(Date.now() - 365 * MS_PER_DAY).toISOString();

        // Get monthly summary from QuestDB
        const summary = await fastify.questdb.getMonthlySummary(
          entity_id,
          startTime,
          endTime
        );

        // Transform QuestDB result to API format
        const monthlyData = summary.map((row) => ({
          month: row[1], // timestamp
          total: row[2], // total
          avg_power: row[3], // avg_power
          peak: row[4], // peak
          readings: row[5], // readings count
        }));

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            entity_id,
            period: 'monthly',
            time_range: { start: startTime, end: endTime },
            summary: monthlyData,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get monthly summary');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/statistics/sync/log
   * Get recent sync operation logs
   */
  fastify.get(
    '/api/statistics/sync/log',
    {
      schema: {
        description: 'Get recent sync operation logs',
        tags: ['statistics'],
        querystring: {
          type: 'object',
          properties: {
            entity_id: { type: 'string' },
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { entity_id, limit = 50 } = request.query;

        const filter = {};
        if (entity_id) {
          filter.entityId = entity_id;
        }

        const logs = await fastify.mongo.getRecentSyncs(limit, filter);

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            logs: logs.map((log) => ({
              id: log._id,
              entity_ids: log.entityIds,
              records_synced: log.recordsSynced,
              start_time: log.startTime,
              end_time: log.endTime,
              period: log.period,
              duration: log.duration,
              success: log.success,
              error: log.error,
              created_at: log.createdAt,
            })),
            count: logs.length,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get sync logs');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * POST /api/statistics/compare
   * Compare statistics across multiple entities
   */
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
              maxItems: 10,
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
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const {
          entity_ids,
          start_time,
          end_time,
          aggregation = 'daily',
        } = request.body;

        // Validate all entity_ids
        const invalidIds = entity_ids.filter((id) => !isValidEntityId(id));
        if (invalidIds.length > 0) {
          return reply.code(400).send({
            success: false,
            error: `Invalid entity_id format: ${invalidIds.join(', ')}. Expected: domain.object_id`,
          });
        }

        const endTime = end_time || new Date().toISOString();
        const startTime =
          start_time || new Date(Date.now() - 30 * MS_PER_DAY).toISOString();

        // Get statistics for each entity
        const results = {};

        for (const entityId of entity_ids) {
          try {
            let data;
            if (aggregation === 'monthly') {
              data = await fastify.questdb.getMonthlySummary(
                entityId,
                startTime,
                endTime
              );
            } else if (aggregation === 'daily') {
              data = await fastify.questdb.getDailySummary(
                entityId,
                startTime,
                endTime
              );
            } else {
              data = await fastify.questdb.getStatistics(
                entityId,
                startTime,
                endTime
              );
            }
            results[entityId] = data;
          } catch (error) {
            fastify.log.warn(
              { entityId, err: error },
              'Failed to get comparison data'
            );
            results[entityId] = { error: error.message };
          }
        }

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            entity_ids,
            aggregation,
            time_range: { start: startTime, end: endTime },
            comparison: results,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to compare statistics');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
}
