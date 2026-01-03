/**
 * Status Routes for Event Recorder Service
 *
 * GET /status - Get recorder service status
 * POST /backfill/trigger - Manually trigger backfill
 * POST /reseed - Trigger database reseeding
 */

export default async function statusRoutes(fastify, options) {
  /**
   * Get recorder service status
   * Returns current state, last event time, entity count, etc.
   */
  fastify.get('/status', {
    schema: {
      description: 'Get recorder service status',
      tags: ['recorder'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            data: {
              type: 'object',
              properties: {
                status: { type: 'string' },
                isRunning: { type: 'boolean' },
                lastEventAt: { type: ['string', 'null'] },
                entityCount: { type: 'number' },
                eventCount: { type: 'number' },
                errorCount: { type: 'number' },
              },
            },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        const state = fastify.recorder.getState();

        reply.send({
          success: true,
          data: {
            status: state.isRunning ? 'running' : 'stopped',
            isRunning: state.isRunning,
            lastEventAt: state.lastEventAt
              ? state.lastEventAt.toISOString()
              : null,
            entityCount: state.entityCount,
            eventCount: state.eventCount,
            errorCount: state.errorCount,
          },
        });
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get recorder status');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    },
  });

  /**
   * Manually trigger backfill
   * Forces an immediate backfill of statistics from Home Assistant
   */
  fastify.post('/backfill/trigger', {
    schema: {
      description: 'Manually trigger statistics backfill',
      tags: ['recorder'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        // Trigger backfill asynchronously
        fastify.recorder.triggerBackfill().catch((err) => {
          fastify.log.error({ err }, 'Backfill failed');
        });

        reply.send({
          success: true,
          message: 'Backfill triggered successfully',
        });
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to trigger backfill');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    },
  });

  /**
   * Trigger database reseeding
   * Re-discovers entities and fetches all historical data
   */
  fastify.post('/reseed', {
    schema: {
      description: 'Trigger database reseeding',
      tags: ['recorder'],
      response: {
        200: {
          type: 'object',
          properties: {
            success: { type: 'boolean' },
            message: { type: 'string' },
          },
        },
      },
    },
    handler: async (request, reply) => {
      try {
        // Trigger reseeding asynchronously
        fastify.recorder.reseedDatabase().catch((err) => {
          fastify.log.error({ err }, 'Reseeding failed');
        });

        reply.send({
          success: true,
          message: 'Database reseeding triggered successfully',
        });
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to trigger reseeding');
        reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    },
  });
}
