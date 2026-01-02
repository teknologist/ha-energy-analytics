/**
 * QuestDB Plugin - Example Usage
 *
 * This file demonstrates how to use the QuestDB plugin
 * in various scenarios within the Energy Dashboard API.
 */

// Example 1: Writing real-time readings from Home Assistant events
async function handleStateChangedEvent(fastify, event) {
  const { entity_id, new_state, old_state } = event.data;

  // Only process energy sensors
  if (
    !entity_id.startsWith('sensor.') ||
    !new_state.attributes.unit_of_measurement?.includes('kWh')
  ) {
    return;
  }

  const reading = {
    entity_id,
    state: parseFloat(new_state.state),
    previous_state: parseFloat(old_state.state),
    attributes: new_state.attributes,
    timestamp: new Date(new_state.last_updated).getTime() * 1000000, // ms to ns
  };

  try {
    await fastify.questdb.writeReadings([reading]);
    fastify.log.debug({ entity_id }, 'Wrote energy reading');
  } catch (err) {
    fastify.log.error({ err, entity_id }, 'Failed to write reading');
  }
}

// Example 2: Batch writing statistics from Home Assistant recorder
async function syncStatisticsFromHA(fastify, entityId, statistics) {
  const stats = statistics.map((stat) => ({
    entity_id: entityId,
    period: 'hour',
    state: stat.state,
    sum: stat.sum,
    mean: stat.mean,
    min: stat.min,
    max: stat.max,
    timestamp: new Date(stat.start).getTime() * 1000000,
  }));

  try {
    await fastify.questdb.writeStats(stats);
    fastify.log.info(
      { entity_id: entityId, count: stats.length },
      'Synced statistics'
    );
  } catch (err) {
    fastify.log.error(
      { err, entity_id: entityId },
      'Failed to sync statistics'
    );
    throw err;
  }
}

// Example 3: Route handler for getting daily energy consumption
export async function dailyConsumptionRoute(fastify, opts) {
  fastify.get(
    '/consumption/daily/:entityId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            entityId: { type: 'string' },
          },
          required: ['entityId'],
        },
        querystring: {
          type: 'object',
          properties: {
            start: { type: 'string', format: 'date' },
            end: { type: 'string', format: 'date' },
          },
        },
      },
    },
    async (request, reply) => {
      const { entityId } = request.params;
      const { start, end } = request.query;

      const startDate = start
        ? new Date(start)
        : new Date(Date.now() - 30 * 86400000);
      const endDate = end ? new Date(end) : new Date();

      try {
        const summary = await fastify.questdb.getDailySummary(
          entityId,
          startDate,
          endDate
        );

        return {
          entity_id: entityId,
          period: 'daily',
          start: startDate.toISOString(),
          end: endDate.toISOString(),
          data: summary,
        };
      } catch (err) {
        fastify.log.error({ err, entityId }, 'Failed to get daily summary');
        return reply
          .code(500)
          .send({ error: 'Failed to retrieve daily summary' });
      }
    }
  );
}

// Example 4: Route handler for real-time readings
export async function realtimeReadingsRoute(fastify, opts) {
  fastify.get(
    '/readings/:entityId',
    {
      schema: {
        params: {
          type: 'object',
          properties: {
            entityId: { type: 'string' },
          },
          required: ['entityId'],
        },
        querystring: {
          type: 'object',
          properties: {
            start: { type: 'string' },
            end: { type: 'string' },
            limit: { type: 'integer', default: 1000, maximum: 10000 },
          },
        },
      },
    },
    async (request, reply) => {
      const { entityId } = request.params;
      const { start, end, limit = 1000 } = request.query;

      const startTime = start
        ? new Date(start)
        : new Date(Date.now() - 24 * 3600000);
      const endTime = end ? new Date(end) : new Date();

      try {
        const readings = await fastify.questdb.getReadings(
          entityId,
          startTime,
          endTime,
          Math.min(limit, 10000) // Cap at 10k
        );

        return {
          entity_id: entityId,
          start: startTime.toISOString(),
          end: endTime.toISOString(),
          count: readings.length,
          data: readings,
        };
      } catch (err) {
        fastify.log.error({ err, entityId }, 'Failed to get readings');
        return reply.code(500).send({ error: 'Failed to retrieve readings' });
      }
    }
  );
}

// Example 5: Advanced query using raw SQL
async function getEnergyTrends(fastify, entityId, days = 30) {
  const sql = `
    SELECT
      entity_id,
      timestamp,
      avg(state) as avg_consumption,
      min(state) as min_consumption,
      max(state) as max_consumption,
      first(state) as period_start,
      last(state) as period_end
    FROM energy_readings
    WHERE entity_id = '${entityId}'
      AND timestamp >= dateadd('d', -${days}, now())
    SAMPLE BY 1d ALIGN TO CALENDAR
  `;

  try {
    const result = await fastify.questdb.query(sql);
    return result.dataset;
  } catch (err) {
    fastify.log.error({ err, entityId }, 'Failed to get energy trends');
    throw err;
  }
}

// Example 6: Backfill detection and sync
async function backfillIfNeeded(fastify, entityId) {
  // Get the latest reading from QuestDB
  const latestTimestamp = await fastify.questdb.getLatestReadingTime(entityId);

  if (!latestTimestamp) {
    fastify.log.info(
      { entity_id: entityId },
      'No existing data, performing full sync'
    );
    // Perform full historical sync
    return true;
  }

  const latestDate = new Date(latestTimestamp);
  const hoursSinceLastReading = (Date.now() - latestDate.getTime()) / 3600000;

  if (hoursSinceLastReading > 2) {
    fastify.log.warn(
      { entity_id: entityId, hours_gap: hoursSinceLastReading },
      'Gap detected, backfill required'
    );
    return true;
  }

  return false;
}

// Example 7: Health check endpoint
export async function healthCheckRoute(fastify, opts) {
  fastify.get('/health/questdb', async (request, reply) => {
    const isConnected = fastify.questdb.isConnected();

    if (!isConnected) {
      return reply.code(503).send({
        status: 'unhealthy',
        service: 'questdb',
        connected: false,
      });
    }

    try {
      // Test query to verify database is responsive
      await fastify.questdb.query('SELECT 1');

      return {
        status: 'healthy',
        service: 'questdb',
        connected: true,
        config: {
          host: fastify.questdb.config.host,
          ilp_port: fastify.questdb.config.ilpPort,
          http_port: fastify.questdb.config.httpPort,
        },
      };
    } catch (err) {
      return reply.code(503).send({
        status: 'unhealthy',
        service: 'questdb',
        connected: true,
        error: err.message,
      });
    }
  });
}

// Example 8: Comparing periods
async function compareEnergyPeriods(
  fastify,
  entityId,
  currentStart,
  currentEnd,
  previousStart,
  previousEnd
) {
  const [currentStats, previousStats] = await Promise.all([
    fastify.questdb.getDailySummary(entityId, currentStart, currentEnd),
    fastify.questdb.getDailySummary(entityId, previousStart, previousEnd),
  ]);

  const currentTotal = currentStats.reduce(
    (sum, day) => sum + (day[2] || 0),
    0
  ); // total is 3rd column
  const previousTotal = previousStats.reduce(
    (sum, day) => sum + (day[2] || 0),
    0
  );

  const change = currentTotal - previousTotal;
  const percentChange = previousTotal > 0 ? (change / previousTotal) * 100 : 0;

  return {
    current: {
      start: currentStart,
      end: currentEnd,
      total: currentTotal,
      daily_avg: currentTotal / currentStats.length,
    },
    previous: {
      start: previousStart,
      end: previousEnd,
      total: previousTotal,
      daily_avg: previousTotal / previousStats.length,
    },
    comparison: {
      absolute_change: change,
      percent_change: percentChange,
      trend: change > 0 ? 'increased' : change < 0 ? 'decreased' : 'unchanged',
    },
  };
}

// Example 9: Peak demand detection
async function getPeakDemandPeriods(
  fastify,
  entityId,
  startDate,
  endDate,
  topN = 10
) {
  const sql = `
    SELECT
      entity_id,
      timestamp,
      state,
      previous_state,
      state - previous_state as change
    FROM energy_readings
    WHERE entity_id = '${entityId}'
      AND timestamp >= '${startDate.toISOString()}'
      AND timestamp < '${endDate.toISOString()}'
      AND state > previous_state
    ORDER BY change DESC
    LIMIT ${topN}
  `;

  const result = await fastify.questdb.query(sql);
  return result.dataset;
}

// Example 10: Scheduled statistics aggregation (background job)
async function aggregateHourlyStatistics(fastify, entityId, hour) {
  const startTime = new Date(hour);
  const endTime = new Date(hour + 3600000); // +1 hour

  // Query raw readings for the hour
  const readings = await fastify.questdb.getReadings(
    entityId,
    startTime,
    endTime,
    10000
  );

  if (readings.length === 0) {
    return;
  }

  // Calculate statistics
  const states = readings.map((r) => r[1]); // state is 2nd column
  const stat = {
    entity_id: entityId,
    period: 'hour',
    state: states[states.length - 1], // last value
    sum: states.reduce((a, b) => a + b, 0),
    mean: states.reduce((a, b) => a + b, 0) / states.length,
    min: Math.min(...states),
    max: Math.max(...states),
    timestamp: startTime.getTime() * 1000000,
  };

  await fastify.questdb.writeStats([stat]);
  fastify.log.info(
    { entity_id: entityId, hour: startTime },
    'Aggregated hourly statistics'
  );
}

export {
  handleStateChangedEvent,
  syncStatisticsFromHA,
  getEnergyTrends,
  backfillIfNeeded,
  compareEnergyPeriods,
  getPeakDemandPeriods,
  aggregateHourlyStatistics,
};
