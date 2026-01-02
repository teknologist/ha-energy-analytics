export default async function settingsRoutes(fastify, options) {
  /**
   * GET /api/settings
   * Get all application settings with masked token
   */
  fastify.get(
    '/api/settings',
    {
      schema: {
        description: 'Get all application settings',
        tags: ['settings'],
        response: {
          200: {
            type: 'object',
            properties: {
              ha_url: { type: 'string' },
              ha_token: { type: 'string' },
              ha_connected: { type: 'boolean' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      try {
        const settings = await fastify.mongo.getAllSettings();

        // Mask token if present
        if (settings.ha_token) {
          settings.ha_token = '***configured***';
        }

        // Add connection status
        settings.ha_connected = fastify.ha?.connected || false;

        return settings;
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get settings');
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /api/settings/home-assistant
   * Configure Home Assistant connection (tests connection before saving)
   */
  fastify.post(
    '/api/settings/home-assistant',
    {
      schema: {
        description: 'Configure Home Assistant connection',
        tags: ['settings'],
        body: {
          type: 'object',
          required: ['url', 'token'],
          properties: {
            url: { type: 'string' },
            token: { type: 'string' },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              message: { type: 'string' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { url, token } = request.body;

      if (!url || !token) {
        return reply.code(400).send({
          error: 'Missing required fields: url and token are required',
        });
      }

      // Validate URL format
      try {
        const urlToValidate =
          url.startsWith('http') || url.startsWith('ws')
            ? url
            : `http://${url}`;
        const parsed = new URL(urlToValidate);
        if (!['http:', 'https:', 'ws:', 'wss:'].includes(parsed.protocol)) {
          return reply.code(400).send({ error: 'Invalid URL protocol' });
        }
      } catch {
        return reply.code(400).send({ error: 'Invalid URL format' });
      }

      try {
        // Import WebSocket to create test client
        const WebSocket = (await import('ws')).default;

        // Simple connection test
        const wsUrl = url.startsWith('ws') ? url : `ws://${url}/api/websocket`;
        const testWs = new WebSocket(wsUrl);

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            testWs.close();
            reject(new Error('Connection timeout'));
          }, 10000);

          testWs.on('open', () => {
            // Connected, now wait for auth_required
          });

          testWs.on('message', (data) => {
            try {
              const message = JSON.parse(data.toString());
              if (message.type === 'auth_required') {
                testWs.send(
                  JSON.stringify({
                    type: 'auth',
                    access_token: token,
                  })
                );
              } else if (message.type === 'auth_ok') {
                clearTimeout(timeout);
                testWs.close();
                resolve({ success: true });
              } else if (message.type === 'auth_invalid') {
                clearTimeout(timeout);
                testWs.close();
                reject(new Error('Invalid Home Assistant token'));
              }
            } catch (e) {
              clearTimeout(timeout);
              testWs.close();
              reject(e);
            }
          });

          testWs.on('error', (error) => {
            clearTimeout(timeout);
            reject(error);
          });
        });

        // Connection successful, save settings
        await fastify.mongo.setSetting('ha_url', url);
        await fastify.mongo.setSetting('ha_token', token);

        return {
          success: true,
          message: 'Home Assistant connection configured successfully',
        };
      } catch (connectionError) {
        // Map common errors to user-friendly messages
        let errorMessage = connectionError.message;

        if (connectionError.code === 'ECONNREFUSED') {
          errorMessage = 'Cannot connect to Home Assistant';
        } else if (connectionError.code === 'ETIMEDOUT') {
          errorMessage = 'Connection timed out after 10 seconds';
        } else if (
          connectionError.message.includes('Invalid Home Assistant token')
        ) {
          errorMessage = 'Invalid Home Assistant token';
        }

        fastify.log.error(
          { err: connectionError },
          'Failed to configure Home Assistant'
        );
        return reply.code(400).send({
          error: errorMessage,
        });
      }
    }
  );

  /**
   * POST /api/settings/test-connection
   * Test current Home Assistant connection
   */
  fastify.post(
    '/api/settings/test-connection',
    {
      schema: {
        description: 'Test current Home Assistant connection',
        tags: ['settings'],
        response: {
          200: {
            type: 'object',
            properties: {
              connected: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          503: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!fastify.ha) {
        return reply.code(503).send({
          error: 'Home Assistant not configured',
        });
      }

      try {
        // Try to get states to verify connection
        await fastify.ha.getStates();

        return {
          connected: true,
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Connection test failed');

        let errorMessage = error.message;

        if (error.code === 'ECONNREFUSED') {
          errorMessage = 'Cannot connect to Home Assistant';
        } else if (error.code === 'ETIMEDOUT') {
          errorMessage = 'Connection timed out after 10 seconds';
        }

        return {
          connected: false,
          error: errorMessage,
        };
      }
    }
  );

  /**
   * POST /api/settings/discover-entities
   * Auto-discover energy entities from Home Assistant
   */
  fastify.post(
    '/api/settings/discover-entities',
    {
      schema: {
        description: 'Auto-discover energy entities from Home Assistant',
        tags: ['settings'],
        response: {
          200: {
            type: 'object',
            properties: {
              entities: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    entityId: { type: 'string' },
                    friendlyName: { type: 'string' },
                    deviceClass: { type: 'string' },
                    unitOfMeasurement: { type: 'string' },
                    state: { type: 'string' },
                  },
                },
              },
              count: { type: 'number' },
            },
          },
          503: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      if (!fastify.ha) {
        return reply.code(503).send({
          error: 'Home Assistant not configured',
        });
      }

      try {
        // Discover energy entities
        const entities = await fastify.ha.discoverEntities();

        // Upsert to MongoDB
        const upsertedEntities = [];
        for (const entity of entities) {
          const upserted = await fastify.mongo.upsertEntity({
            entity_id: entity.entity_id,
            friendly_name: entity.attributes?.friendly_name || entity.entity_id,
            device_class: entity.attributes?.device_class,
            unit_of_measurement: entity.attributes?.unit_of_measurement,
            state: entity.state,
            isTracked: false, // Don't auto-track, let user choose
          });

          upsertedEntities.push(upserted);
        }

        return {
          entities: upsertedEntities,
          count: upsertedEntities.length,
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to discover entities');
        return reply.code(500).send({ error: error.message });
      }
    }
  );

  /**
   * POST /api/settings/tracked-entities
   * Set which entities to track
   */
  fastify.post(
    '/api/settings/tracked-entities',
    {
      schema: {
        description: 'Set which entities to track',
        tags: ['settings'],
        body: {
          type: 'object',
          required: ['entity_ids'],
          properties: {
            entity_ids: {
              type: 'array',
              items: { type: 'string' },
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              updated: { type: 'number' },
              tracked: { type: 'number' },
              untracked: { type: 'number' },
            },
          },
          400: {
            type: 'object',
            properties: {
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_ids } = request.body;

      if (!Array.isArray(entity_ids)) {
        return reply.code(400).send({
          error: 'entity_ids must be an array',
        });
      }

      try {
        // Get all entities
        const allEntities = await fastify.mongo.getEntities();

        let tracked = 0;
        let untracked = 0;

        // Update tracking status
        for (const entity of allEntities) {
          const shouldTrack = entity_ids.includes(entity.entityId);
          const wasUpdated = await fastify.mongo.setEntityTracked(
            entity.entityId,
            shouldTrack
          );

          if (wasUpdated) {
            if (shouldTrack) {
              tracked++;
            } else {
              untracked++;
            }
          }
        }

        return {
          updated: tracked + untracked,
          tracked,
          untracked,
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to update tracked entities');
        return reply.code(500).send({ error: error.message });
      }
    }
  );
}
