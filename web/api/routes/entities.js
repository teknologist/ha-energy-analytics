/**
 * Entities API Routes
 * Manages energy entity discovery, tracking, and metadata
 *
 * @module routes/entities
 */

// Valid device classes for energy entities
const VALID_DEVICE_CLASSES = ['energy', 'power', 'battery'];

// Valid units of measurement
const VALID_UNITS = ['kWh', 'Wh', 'W', 'kW'];

// Entity ID validation pattern (Home Assistant format: domain.object_id)
const ENTITY_ID_PATTERN = /^[a-z_]+\.[a-z0-9_]+$/i;

// Rate limiting state for destructive operations
const rateLimitState = {
  discover: { lastCall: 0, minIntervalMs: 30000 }, // 30 seconds between discover calls
};

/**
 * @typedef {Object} EntityFilters
 * @property {string} [device_class] - Filter by device class
 * @property {string} [unit] - Filter by unit of measurement
 * @property {string|boolean} [tracked] - Filter by tracked status
 */

/**
 * @typedef {Object} EntityDocument
 * @property {string} entityId - Entity identifier
 * @property {string} [friendlyName] - Human-readable name
 * @property {string} [deviceClass] - Device class
 * @property {string} [unitOfMeasurement] - Unit of measurement
 * @property {string} [state] - Current state value
 * @property {boolean} [isTracked] - Whether entity is tracked
 * @property {Date} [lastSeen] - Last seen timestamp
 * @property {Date} [updatedAt] - Last update timestamp
 */

/**
 * @typedef {Object} HAState
 * @property {string} entity_id - Entity identifier
 * @property {string} state - Current state
 * @property {Object} attributes - Entity attributes
 * @property {string} [attributes.friendly_name] - Human-readable name
 * @property {string} [attributes.device_class] - Device class
 * @property {string} [attributes.unit_of_measurement] - Unit of measurement
 * @property {string} [last_updated] - Last update timestamp
 */

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

/**
 * Validate entity filters
 * @param {EntityFilters} filters - Filters to validate
 * @returns {{valid: boolean, error?: string}} Validation result
 */
function validateFilters(filters) {
  if (
    filters.device_class &&
    !VALID_DEVICE_CLASSES.includes(filters.device_class)
  ) {
    return {
      valid: false,
      error: `Invalid device_class. Must be one of: ${VALID_DEVICE_CLASSES.join(', ')}`,
    };
  }

  if (filters.unit && !VALID_UNITS.includes(filters.unit)) {
    return {
      valid: false,
      error: `Invalid unit. Must be one of: ${VALID_UNITS.join(', ')}`,
    };
  }

  return { valid: true };
}

/**
 * Check rate limit for an operation
 * @param {string} operation - Operation name
 * @returns {{allowed: boolean, retryAfterMs?: number}} Rate limit result
 */
function checkRateLimit(operation) {
  const state = rateLimitState[operation];
  if (!state) {
    return { allowed: true };
  }

  const now = Date.now();
  const elapsed = now - state.lastCall;

  if (elapsed < state.minIntervalMs) {
    return {
      allowed: false,
      retryAfterMs: state.minIntervalMs - elapsed,
    };
  }

  state.lastCall = now;
  return { allowed: true };
}

/**
 * Apply filters to entity list
 * @param {Array<Object>} entities - Entities to filter
 * @param {EntityFilters} filters - Filters to apply
 * @returns {Array<Object>} Filtered entities
 */
function applyEntityFilters(entities, filters) {
  let filtered = entities;

  if (filters.device_class) {
    filtered = filtered.filter(
      (e) =>
        e.deviceClass === filters.device_class ||
        e.device_class === filters.device_class
    );
  }

  if (filters.unit) {
    filtered = filtered.filter(
      (e) =>
        e.unitOfMeasurement === filters.unit ||
        e.unit_of_measurement === filters.unit
    );
  }

  if (filters.tracked !== undefined) {
    const isTracked = filters.tracked === 'true' || filters.tracked === true;
    filtered = filtered.filter(
      (e) => e.isTracked === isTracked || e.is_tracked === isTracked
    );
  }

  return filtered;
}

/**
 * Transform MongoDB entity to API response format
 * @param {EntityDocument} entity - MongoDB entity document
 * @returns {Object} Transformed entity for API response
 */
function transformEntityToResponse(entity) {
  return {
    entity_id: entity.entityId,
    friendly_name: entity.friendlyName || entity.entityId,
    device_class: entity.deviceClass || null,
    unit_of_measurement: entity.unitOfMeasurement || null,
    state: entity.state || null,
    is_tracked: entity.isTracked !== undefined ? entity.isTracked : false,
    last_seen: entity.lastSeen?.toISOString() || null,
    updated_at: entity.updatedAt?.toISOString() || null,
  };
}

/**
 * Transform Home Assistant state to API response format
 * @param {HAState} state - Home Assistant state object
 * @returns {Object} Transformed entity for API response
 */
function transformHAStateToResponse(state) {
  return {
    entity_id: state.entity_id,
    friendly_name: state.attributes?.friendly_name || state.entity_id,
    device_class: state.attributes?.device_class || null,
    unit_of_measurement: state.attributes?.unit_of_measurement || null,
    state: state.state || null,
    is_tracked: false, // Default for live entities
    last_updated: state.last_updated || null,
  };
}

export default async function entitiesRoutes(fastify, options) {
  /**
   * GET /api/entities
   * Get energy entities from Home Assistant with fallback to cached data
   * Timeout: 30 seconds, fallback to cache on timeout
   */
  fastify.get(
    '/api/entities',
    {
      schema: {
        description:
          'Get energy entities from Home Assistant (live with degraded fallback)',
        tags: ['entities'],
        querystring: {
          type: 'object',
          properties: {
            device_class: {
              type: 'string',
              enum: VALID_DEVICE_CLASSES,
              description: 'Filter by device class (energy, power, battery)',
            },
            unit: {
              type: 'string',
              enum: VALID_UNITS,
              description: 'Filter by unit of measurement (kWh, Wh, W, kW)',
            },
            tracked: {
              type: 'string',
              enum: ['true', 'false'],
              description: 'Filter by tracked status',
            },
          },
        },
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: {
                type: 'object',
                properties: {
                  entities: { type: 'array' },
                  count: { type: 'number' },
                  source: { type: 'string', enum: ['live', 'database'] },
                },
              },
              degraded: { type: 'boolean' },
              degradedReason: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      const filters = request.query;

      // Validate filters using shared function
      const validation = validateFilters(filters);
      if (!validation.valid) {
        return reply.code(400).send({
          success: false,
          error: validation.error,
        });
      }

      fastify.log.debug({ filters }, 'Fetching entities with filters');

      // Check if Home Assistant is available
      if (!fastify.ha) {
        fastify.log.warn(
          'Home Assistant not configured, returning cached data'
        );

        // Fallback to cached data with error handling
        try {
          const cachedEntities = await fastify.mongo.getEntities({});
          const filtered = applyEntityFilters(cachedEntities, filters);
          const transformed = filtered.map(transformEntityToResponse);

          reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
          fastify.log.info(
            { count: transformed.length, source: 'database' },
            'Entities fetched from cache'
          );

          return {
            success: true,
            data: {
              entities: transformed,
              count: transformed.length,
              source: 'database',
            },
            degraded: true,
            degradedReason: 'Home Assistant not configured',
          };
        } catch (mongoError) {
          fastify.log.error(
            { err: mongoError },
            'MongoDB fallback also failed'
          );
          return reply.code(503).send({
            success: false,
            error: 'Both Home Assistant and database are unavailable',
          });
        }
      }

      // Try to fetch from Home Assistant with timeout
      try {
        const liveEntitiesPromise = fastify.ha.discoverEntities();
        const timeoutPromise = new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Timeout')), 30000)
        );

        const liveStates = await Promise.race([
          liveEntitiesPromise,
          timeoutPromise,
        ]);

        // Cache entities in MongoDB using bulkWrite for better performance
        if (liveStates.length > 0) {
          const bulkOps = liveStates.map((state) => ({
            updateOne: {
              filter: { entityId: state.entity_id },
              update: {
                $set: {
                  friendlyName:
                    state.attributes?.friendly_name || state.entity_id,
                  deviceClass: state.attributes?.device_class || null,
                  unitOfMeasurement:
                    state.attributes?.unit_of_measurement || null,
                  state: state.state,
                  lastSeen: new Date(),
                  updatedAt: new Date(),
                },
                $setOnInsert: {
                  entityId: state.entity_id,
                  isTracked: false, // Default for new entities
                  createdAt: new Date(),
                },
              },
              upsert: true,
            },
          }));

          try {
            await fastify.mongo.collections.entities.bulkWrite(bulkOps, {
              ordered: false,
            });
          } catch (bulkError) {
            // Log but don't fail the request - caching is best-effort
            fastify.log.warn(
              { err: bulkError },
              'Failed to cache entities to MongoDB'
            );
          }
        }

        // Transform and filter
        let transformed = liveStates.map(transformHAStateToResponse);
        transformed = applyEntityFilters(transformed, filters);

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        fastify.log.info(
          { count: transformed.length, source: 'live' },
          'Entities fetched from Home Assistant'
        );

        return {
          success: true,
          data: {
            entities: transformed,
            count: transformed.length,
            source: 'live',
          },
        };
      } catch (error) {
        // Timeout or HA error - fallback to cached data with degraded flag
        const degradedReason =
          error.message === 'Timeout'
            ? 'Home Assistant timeout (30s)'
            : 'Home Assistant unavailable';

        fastify.log.warn({ error: error.message }, degradedReason);

        // Fallback to cached data with error handling
        try {
          const cachedEntities = await fastify.mongo.getEntities({});
          const filtered = applyEntityFilters(cachedEntities, filters);
          const transformed = filtered.map(transformEntityToResponse);

          reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
          fastify.log.info(
            { count: transformed.length, source: 'database' },
            'Entities fetched from cache (degraded)'
          );

          return {
            success: true,
            data: {
              entities: transformed,
              count: transformed.length,
              source: 'database',
            },
            degraded: true,
            degradedReason,
          };
        } catch (mongoError) {
          fastify.log.error(
            { err: mongoError },
            'MongoDB fallback also failed'
          );
          return reply.code(503).send({
            success: false,
            error: 'Both Home Assistant and database are unavailable',
          });
        }
      }
    }
  );

  /**
   * GET /api/entities/cached
   * Get entities from local database only
   */
  fastify.get(
    '/api/entities/cached',
    {
      schema: {
        description: 'Get cached entities from local database',
        tags: ['entities'],
        querystring: {
          type: 'object',
          properties: {
            device_class: {
              type: 'string',
              enum: VALID_DEVICE_CLASSES,
              description: 'Filter by device class (energy, power, battery)',
            },
            unit: {
              type: 'string',
              enum: VALID_UNITS,
              description: 'Filter by unit of measurement (kWh, Wh, W, kW)',
            },
            tracked: {
              type: 'string',
              enum: ['true', 'false'],
              description: 'Filter by tracked status',
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
      const filters = request.query;

      // Validate filters using shared function
      const validation = validateFilters(filters);
      if (!validation.valid) {
        return reply.code(400).send({
          success: false,
          error: validation.error,
        });
      }

      fastify.log.debug({ filters }, 'Fetching cached entities with filters');

      try {
        const entities = await fastify.mongo.getEntities({});
        const filtered = applyEntityFilters(entities, filters);
        const transformed = filtered.map(transformEntityToResponse);

        // Get last sync timestamp (most recent entity update)
        const lastSync =
          entities.length > 0
            ? entities.reduce((latest, e) => {
                const timestamp = e.lastSeen || e.updatedAt;
                return timestamp > latest ? timestamp : latest;
              }, new Date(0))
            : null;

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        fastify.log.info(
          { count: transformed.length },
          'Cached entities fetched'
        );

        return {
          success: true,
          data: {
            entities: transformed,
            count: transformed.length,
            source: 'database',
            last_sync: lastSync?.toISOString() || null,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to fetch cached entities');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * POST /api/entities/discover
   * Discover energy entities from Home Assistant and cache them
   * Rate limited: 30 seconds between calls
   */
  fastify.post(
    '/api/entities/discover',
    {
      schema: {
        description: 'Discover and cache energy entities from Home Assistant',
        tags: ['entities'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
          429: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
              retry_after_ms: { type: 'number' },
            },
          },
          503: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();

      // Check rate limit
      const rateLimit = checkRateLimit('discover');
      if (!rateLimit.allowed) {
        return reply.code(429).send({
          success: false,
          error:
            'Rate limit exceeded. Please wait before calling discover again.',
          retry_after_ms: rateLimit.retryAfterMs,
        });
      }

      if (!fastify.ha) {
        return reply.code(503).send({
          success: false,
          error: 'Home Assistant not configured',
        });
      }

      try {
        fastify.log.info('Starting entity discovery from Home Assistant');

        // Discover all energy entities
        const discoveredStates = await fastify.ha.discoverEntities();

        // Use bulkWrite for efficient batch upsert
        if (discoveredStates.length > 0) {
          const bulkOps = discoveredStates.map((state) => ({
            updateOne: {
              filter: { entityId: state.entity_id },
              update: {
                $set: {
                  friendlyName:
                    state.attributes?.friendly_name || state.entity_id,
                  deviceClass: state.attributes?.device_class || null,
                  unitOfMeasurement:
                    state.attributes?.unit_of_measurement || null,
                  state: state.state,
                  lastSeen: new Date(),
                  updatedAt: new Date(),
                },
                $setOnInsert: {
                  entityId: state.entity_id,
                  isTracked: false, // Default for new entities
                  createdAt: new Date(),
                },
              },
              upsert: true,
            },
          }));

          await fastify.mongo.collections.entities.bulkWrite(bulkOps, {
            ordered: false,
          });
        }

        // Fetch all entities to return
        const allEntities = await fastify.mongo.getEntities({});
        const transformed = allEntities.map(transformEntityToResponse);

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        fastify.log.info(
          { discovered: discoveredStates.length },
          'Entity discovery completed'
        );

        return {
          success: true,
          data: {
            discovered: discoveredStates.length,
            entities: transformed,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Entity discovery failed');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/entities/:entity_id
   * Get single entity with current Home Assistant state
   */
  fastify.get(
    '/api/entities/:entity_id',
    {
      schema: {
        description: 'Get entity metadata and current state',
        tags: ['entities'],
        params: {
          type: 'object',
          required: ['entity_id'],
          properties: {
            entity_id: {
              type: 'string',
              pattern: '^[a-z_]+\\.[a-z0-9_]+$',
              minLength: 3,
              maxLength: 100,
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
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_id } = request.params;
      const startMs = Date.now();

      // Validate entity_id format
      if (!isValidEntityId(entity_id)) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid entity_id format. Expected: domain.object_id',
        });
      }

      fastify.log.debug({ entity_id }, 'Fetching entity details');

      try {
        // Get from database
        const entity = await fastify.mongo.getEntity(entity_id);

        if (!entity) {
          return reply.code(404).send({
            success: false,
            error: 'Entity not found',
          });
        }

        // Try to get current state from HA
        let currentState = null;
        if (fastify.ha && fastify.ha.isConnected()) {
          try {
            const states = await fastify.ha.getStates();
            const haState = states.find((s) => s.entity_id === entity_id);
            if (haState) {
              currentState = {
                state: haState.state,
                last_updated: haState.last_updated,
                attributes: haState.attributes,
              };
            }
          } catch (haError) {
            fastify.log.warn(
              { err: haError, entity_id },
              'Failed to fetch current state from HA'
            );
          }
        }

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        fastify.log.info(
          { entity_id, hasCurrentState: !!currentState },
          'Entity details fetched'
        );

        return {
          success: true,
          data: {
            ...transformEntityToResponse(entity),
            current_state: currentState,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error, entity_id }, 'Failed to get entity');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * PUT /api/entities/:entity_id
   * Update entity tracking status
   */
  fastify.put(
    '/api/entities/:entity_id',
    {
      schema: {
        description: 'Update entity tracking status',
        tags: ['entities'],
        params: {
          type: 'object',
          required: ['entity_id'],
          properties: {
            entity_id: {
              type: 'string',
              pattern: '^[a-z_]+\\.[a-z0-9_]+$',
              minLength: 3,
              maxLength: 100,
            },
          },
        },
        body: {
          type: 'object',
          required: ['is_tracked'],
          properties: {
            is_tracked: { type: 'boolean' },
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
          400: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
          404: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const { entity_id } = request.params;
      const { is_tracked } = request.body;
      const startMs = Date.now();

      // Validate entity_id format
      if (!isValidEntityId(entity_id)) {
        return reply.code(400).send({
          success: false,
          error: 'Invalid entity_id format. Expected: domain.object_id',
        });
      }

      fastify.log.debug(
        { entity_id, is_tracked },
        'Updating entity tracking status'
      );

      try {
        // Check if entity exists
        const entity = await fastify.mongo.getEntity(entity_id);
        if (!entity) {
          return reply.code(404).send({
            success: false,
            error: 'Entity not found',
          });
        }

        // Update tracking status
        const updated = await fastify.mongo.setEntityTracked(
          entity_id,
          is_tracked
        );

        if (!updated) {
          return reply.code(400).send({
            success: false,
            error: 'Failed to update entity',
          });
        }

        // Fetch updated entity
        const updatedEntity = await fastify.mongo.getEntity(entity_id);

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        fastify.log.info(
          { entity_id, is_tracked },
          'Entity tracking status updated'
        );

        return {
          success: true,
          data: transformEntityToResponse(updatedEntity),
        };
      } catch (error) {
        fastify.log.error({ err: error, entity_id }, 'Failed to update entity');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/entities/energy-config
   * Get Home Assistant energy dashboard configuration
   */
  fastify.get(
    '/api/entities/energy-config',
    {
      schema: {
        description: 'Get Home Assistant energy dashboard configuration',
        tags: ['entities'],
        response: {
          200: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              data: { type: 'object' },
            },
          },
          503: {
            type: 'object',
            properties: {
              success: { type: 'boolean' },
              error: { type: 'string' },
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
          error: 'Home Assistant not configured',
        });
      }

      try {
        const prefs = await fastify.ha.getEnergyPreferences();

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: { config: prefs },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get energy config');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
}
