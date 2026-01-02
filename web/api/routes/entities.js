export default async function entitiesRoutes(fastify, options) {
  // List all energy-related entities from HA
  fastify.get(
    '/api/entities',
    {
      schema: {
        description: 'Get all energy-related entities from Home Assistant',
        tags: ['entities'],
        response: {
          200: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entity_id: { type: 'string' },
                    friendly_name: { type: 'string' },
                    state: { type: 'string' },
                    device_class: { type: 'string' },
                    unit_of_measurement: { type: 'string' },
                  },
                },
              },
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
        const entities = await fastify.ha.getEnergyEntities();

        // Cache entities in local DB
        for (const entity of entities) {
          await fastify.mongo.upsertEntity({
            entity_id: entity.entity_id,
            friendly_name: entity.attributes?.friendly_name,
            device_class: entity.attributes?.device_class,
            unit_of_measurement: entity.attributes?.unit_of_measurement,
            state: entity.state,
          });
        }

        return {
          entities: entities.map((e) => ({
            entity_id: e.entity_id,
            friendly_name: e.attributes?.friendly_name || e.entity_id,
            state: e.state,
            device_class: e.attributes?.device_class,
            unit_of_measurement: e.attributes?.unit_of_measurement,
          })),
        };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  // Get cached entities from local DB
  fastify.get(
    '/api/entities/cached',
    {
      schema: {
        description: 'Get cached entities from local database',
        tags: ['entities'],
      },
    },
    async (request, reply) => {
      const entities = await fastify.mongo.getEntities({ isTracked: true });
      return { entities };
    }
  );

  // Get energy dashboard configuration from HA
  fastify.get(
    '/api/entities/energy-config',
    {
      schema: {
        description: 'Get Home Assistant energy dashboard configuration',
        tags: ['entities'],
      },
    },
    async (request, reply) => {
      if (!fastify.ha) {
        return reply.code(503).send({
          error: 'Home Assistant not connected',
        });
      }

      try {
        const prefs = await fastify.ha.getEnergyPreferences();
        return { config: prefs };
      } catch (error) {
        fastify.log.error(error);
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
