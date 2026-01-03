/**
 * Insights API Routes
 * Provides consumption insights, top consumers, peaks, patterns, and breakdowns
 *
 * @module routes/insights
 */

// Valid periods for time range queries
const VALID_PERIODS = ['day', 'week', 'month'];

// Time constants in milliseconds
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * @typedef {Object} TimeRange
 * @property {string} start - ISO 8601 start timestamp
 * @property {string} end - ISO 8601 end timestamp
 */

/**
 * @typedef {Object} TopConsumer
 * @property {string} entity_id - Entity identifier
 * @property {string} friendly_name - Human-readable name
 * @property {string} unit_of_measurement - Unit of measurement
 * @property {number} consumption - Total consumption value
 * @property {number} percentage - Percentage of total consumption
 */

/**
 * @typedef {Object} EntityMetadata
 * @property {string} entityId - Entity identifier
 * @property {string} [friendlyName] - Human-readable name
 * @property {string} [unitOfMeasurement] - Unit of measurement
 * @property {string} [deviceClass] - Device class
 */

export default async function insightsRoutes(fastify, options) {
  const { sanitize } = fastify.questdb;

  /**
   * Calculate time range based on period
   * @param {string} period - Period identifier (day, week, month)
   * @returns {TimeRange} Start and end timestamps
   */
  function getTimeRange(period) {
    const endTime = new Date();
    let startTime;

    switch (period) {
      case 'day':
        startTime = new Date(Date.now() - MS_PER_DAY);
        break;
      case 'week':
        startTime = new Date(Date.now() - 7 * MS_PER_DAY);
        break;
      case 'month':
        startTime = new Date(Date.now() - 30 * MS_PER_DAY);
        break;
      default:
        startTime = new Date(Date.now() - 7 * MS_PER_DAY);
    }

    return {
      start: startTime.toISOString(),
      end: endTime.toISOString(),
    };
  }

  /**
   * Validate period parameter
   * @param {string} period - Period to validate
   * @returns {string} Validated period
   * @throws {Error} If period is invalid
   */
  function validatePeriod(period) {
    if (!VALID_PERIODS.includes(period)) {
      throw new Error(
        `Invalid period: ${period}. Must be one of: ${VALID_PERIODS.join(', ')}`
      );
    }
    return period;
  }

  /**
   * Validate and sanitize limit parameter
   * @param {number} limit - Limit value
   * @param {number} [max=20] - Maximum allowed limit
   * @returns {number} Sanitized limit
   */
  function validateLimit(limit, max = 20) {
    return sanitize.limit(limit, max);
  }

  /**
   * Get entity metadata map for enrichment
   * @returns {Promise<Map<string, EntityMetadata>>} Map of entity ID to metadata
   */
  async function getEntityMap() {
    const entities = await fastify.mongo.getEntities();
    return new Map(entities.map((e) => [e.entityId, e]));
  }

  /**
   * GET /api/insights/top-consumers
   * Get top energy consumers for a period
   */
  fastify.get(
    '/api/insights/top-consumers',
    {
      schema: {
        description: 'Get top energy consumers',
        tags: ['insights'],
        querystring: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: VALID_PERIODS,
              default: 'week',
            },
            limit: { type: 'integer', minimum: 1, maximum: 20, default: 5 },
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
                  period: { type: 'string' },
                  time_range: {
                    type: 'object',
                    properties: {
                      start: { type: 'string' },
                      end: { type: 'string' },
                    },
                  },
                  total_consumption: { type: 'number' },
                  top_consumers: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { period = 'week', limit = 5 } = request.query;

        // Validate inputs
        const safePeriod = validatePeriod(period);
        const safeLimit = validateLimit(limit, 20);
        const timeRange = getTimeRange(safePeriod);

        // Sanitize timestamps for SQL
        const safeStart = sanitize.timestamp(timeRange.start);
        const safeEnd = sanitize.timestamp(timeRange.end);

        // Query QuestDB for top consumers
        const sql = `
          SELECT entity_id, sum(sum) as total
          FROM energy_statistics
          WHERE timestamp >= '${safeStart}'
            AND timestamp < '${safeEnd}'
          GROUP BY entity_id
          ORDER BY total DESC
          LIMIT ${safeLimit}
        `;

        const result = await fastify.questdb.query(sql);
        const dataset = result.dataset || [];

        // Calculate total consumption across all entities
        const totalSql = `
          SELECT sum(sum) as total
          FROM energy_statistics
          WHERE timestamp >= '${safeStart}'
            AND timestamp < '${safeEnd}'
        `;

        const totalResult = await fastify.questdb.query(totalSql);
        const totalConsumption = totalResult.dataset?.[0]?.[0] || 0;

        // Get entity metadata
        const entityMap = await getEntityMap();

        // Enrich with friendly names and percentages
        const topConsumers = dataset.map((row) => {
          const entityId = row[0];
          const consumption = row[1];
          const entity = entityMap.get(entityId);

          return {
            entity_id: entityId,
            friendly_name: entity?.friendlyName || entityId,
            unit_of_measurement: entity?.unitOfMeasurement || 'kWh',
            consumption,
            percentage:
              totalConsumption > 0 ? (consumption / totalConsumption) * 100 : 0,
          };
        });

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            period: safePeriod,
            time_range: timeRange,
            total_consumption: totalConsumption,
            top_consumers: topConsumers,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get top consumers');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/insights/peak
   * Get peak consumption for a period
   */
  fastify.get(
    '/api/insights/peak',
    {
      schema: {
        description: 'Get peak energy consumption',
        tags: ['insights'],
        querystring: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: VALID_PERIODS,
              default: 'week',
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
                  period: { type: 'string' },
                  time_range: { type: 'object' },
                  peak: { type: ['object', 'null'] },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { period = 'week' } = request.query;

        // Validate inputs
        const safePeriod = validatePeriod(period);
        const timeRange = getTimeRange(safePeriod);

        // Sanitize timestamps for SQL
        const safeStart = sanitize.timestamp(timeRange.start);
        const safeEnd = sanitize.timestamp(timeRange.end);

        // Query QuestDB for peak consumption
        const sql = `
          SELECT entity_id, max, timestamp
          FROM energy_statistics
          WHERE timestamp >= '${safeStart}'
            AND timestamp < '${safeEnd}'
          ORDER BY max DESC
          LIMIT 1
        `;

        const result = await fastify.questdb.query(sql);
        const dataset = result.dataset || [];

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);

        if (dataset.length === 0) {
          return {
            success: true,
            data: {
              period: safePeriod,
              time_range: timeRange,
              peak: null,
            },
          };
        }

        const entityId = dataset[0][0];
        const value = dataset[0][1];
        const timestamp = dataset[0][2];

        // Get entity metadata
        const entityMap = await getEntityMap();
        const entity = entityMap.get(entityId);

        return {
          success: true,
          data: {
            period: safePeriod,
            time_range: timeRange,
            peak: {
              entity_id: entityId,
              friendly_name: entity?.friendlyName || entityId,
              value,
              unit: entity?.unitOfMeasurement || 'kWh',
              timestamp,
            },
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get peak consumption');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/insights/patterns
   * Analyze consumption patterns (burst vs steady)
   */
  fastify.get(
    '/api/insights/patterns',
    {
      schema: {
        description: 'Analyze consumption patterns',
        tags: ['insights'],
        querystring: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: VALID_PERIODS,
              default: 'week',
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
                  period: { type: 'string' },
                  time_range: { type: 'object' },
                  burst_consumers: { type: 'array' },
                  steady_consumers: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { period = 'week' } = request.query;

        // Validate inputs
        const safePeriod = validatePeriod(period);
        const timeRange = getTimeRange(safePeriod);

        // Sanitize timestamps for SQL
        const safeStart = sanitize.timestamp(timeRange.start);
        const safeEnd = sanitize.timestamp(timeRange.end);

        // Query QuestDB for pattern analysis
        const sql = `
          SELECT
            entity_id,
            avg(mean) as avg_consumption,
            stddev(mean) as variance,
            max(mean) / avg(mean) as peak_to_avg
          FROM energy_statistics
          WHERE timestamp >= '${safeStart}'
            AND timestamp < '${safeEnd}'
            AND mean > 0
          GROUP BY entity_id
        `;

        const result = await fastify.questdb.query(sql);
        const dataset = result.dataset || [];

        // Get entity metadata
        const entityMap = await getEntityMap();

        const burstConsumers = [];
        const steadyConsumers = [];

        // Classification thresholds
        const VARIANCE_THRESHOLD = 0.5;
        const PEAK_TO_AVG_THRESHOLD = 2.0;

        for (const row of dataset) {
          const entityId = row[0];
          const avgConsumption = row[1];
          const variance = row[2];
          const peakToAvg = row[3];
          const entity = entityMap.get(entityId);

          const consumer = {
            entity_id: entityId,
            friendly_name: entity?.friendlyName || entityId,
            avg_consumption: avgConsumption,
            variance,
            peak_to_avg_ratio: peakToAvg,
          };

          // Classify: burst if variance > threshold OR peak_to_avg > threshold
          if (
            variance > VARIANCE_THRESHOLD ||
            peakToAvg > PEAK_TO_AVG_THRESHOLD
          ) {
            burstConsumers.push(consumer);
          } else {
            steadyConsumers.push(consumer);
          }
        }

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            period: safePeriod,
            time_range: timeRange,
            burst_consumers: burstConsumers,
            steady_consumers: steadyConsumers,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to analyze patterns');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/insights/breakdown
   * Get consumption breakdown for all entities (pie chart data)
   */
  fastify.get(
    '/api/insights/breakdown',
    {
      schema: {
        description: 'Get consumption breakdown for all entities',
        tags: ['insights'],
        querystring: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: VALID_PERIODS,
              default: 'week',
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
                  period: { type: 'string' },
                  time_range: { type: 'object' },
                  total_consumption: { type: 'number' },
                  breakdown: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { period = 'week' } = request.query;

        // Validate inputs
        const safePeriod = validatePeriod(period);
        const timeRange = getTimeRange(safePeriod);

        // Sanitize timestamps for SQL
        const safeStart = sanitize.timestamp(timeRange.start);
        const safeEnd = sanitize.timestamp(timeRange.end);

        // Query QuestDB for all entities
        const sql = `
          SELECT entity_id, sum(sum) as total
          FROM energy_statistics
          WHERE timestamp >= '${safeStart}'
            AND timestamp < '${safeEnd}'
          GROUP BY entity_id
          ORDER BY total DESC
        `;

        const result = await fastify.questdb.query(sql);
        const dataset = result.dataset || [];

        // Calculate total
        const totalConsumption = dataset.reduce(
          (sum, row) => sum + (row[1] || 0),
          0
        );

        // Get entity metadata
        const entityMap = await getEntityMap();

        // Build breakdown
        const breakdown = dataset.map((row) => {
          const entityId = row[0];
          const consumption = row[1];
          const entity = entityMap.get(entityId);

          return {
            entity_id: entityId,
            friendly_name: entity?.friendlyName || entityId,
            consumption,
            percentage:
              totalConsumption > 0 ? (consumption / totalConsumption) * 100 : 0,
            unit_of_measurement: entity?.unitOfMeasurement || 'kWh',
          };
        });

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            period: safePeriod,
            time_range: timeRange,
            total_consumption: totalConsumption,
            breakdown,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get breakdown');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );

  /**
   * GET /api/insights/timeline
   * Get consumption timeline with hourly/daily grouping
   */
  fastify.get(
    '/api/insights/timeline',
    {
      schema: {
        description: 'Get consumption timeline',
        tags: ['insights'],
        querystring: {
          type: 'object',
          properties: {
            period: {
              type: 'string',
              enum: VALID_PERIODS,
              default: 'week',
            },
            group_by: {
              type: 'string',
              enum: ['hour', 'day'],
              default: 'hour',
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
                  period: { type: 'string' },
                  group_by: { type: 'string' },
                  time_range: { type: 'object' },
                  timeline: { type: 'array' },
                },
              },
            },
          },
        },
      },
    },
    async (request, reply) => {
      const startMs = Date.now();
      try {
        const { period = 'week', group_by = 'hour' } = request.query;

        // Validate inputs
        const safePeriod = validatePeriod(period);
        const timeRange = getTimeRange(safePeriod);

        // Validate group_by - only allow 'hour' or 'day'
        const validGroupBy = ['hour', 'day'];
        if (!validGroupBy.includes(group_by)) {
          return reply.code(400).send({
            success: false,
            error: `Invalid group_by: ${group_by}. Must be one of: ${validGroupBy.join(', ')}`,
          });
        }
        const safeGroupBy = group_by;

        // Sanitize timestamps for SQL
        const safeStart = sanitize.timestamp(timeRange.start);
        const safeEnd = sanitize.timestamp(timeRange.end);

        // Query QuestDB for timeline with breakdown
        const sql = `
          SELECT
            DATE_TRUNC('${safeGroupBy}', timestamp) as time,
            entity_id,
            sum(sum) as consumption
          FROM energy_statistics
          WHERE timestamp >= '${safeStart}'
            AND timestamp < '${safeEnd}'
          GROUP BY time, entity_id
          ORDER BY time ASC
        `;

        const result = await fastify.questdb.query(sql);
        const dataset = result.dataset || [];

        // Get entity metadata
        const entityMap = await getEntityMap();

        // Group by time bucket
        const timelineMap = new Map();

        for (const row of dataset) {
          const time = row[0];
          const entityId = row[1];
          const consumption = row[2];

          if (!timelineMap.has(time)) {
            timelineMap.set(time, {
              time,
              total: 0,
              breakdown: {},
            });
          }

          const bucket = timelineMap.get(time);
          bucket.total += consumption;

          const entity = entityMap.get(entityId);
          bucket.breakdown[entityId] = {
            consumption,
            friendly_name: entity?.friendlyName || entityId,
          };
        }

        // Convert map to array
        const timeline = Array.from(timelineMap.values());

        reply.header('X-Response-Time', `${Date.now() - startMs}ms`);
        return {
          success: true,
          data: {
            period: safePeriod,
            group_by: safeGroupBy,
            time_range: timeRange,
            timeline,
          },
        };
      } catch (error) {
        fastify.log.error({ err: error }, 'Failed to get timeline');
        return reply.code(500).send({
          success: false,
          error: error.message,
        });
      }
    }
  );
}
