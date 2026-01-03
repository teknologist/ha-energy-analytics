import fp from 'fastify-plugin';

/**
 * Event Recorder Plugin
 *
 * Implements event-driven sync for Home Assistant energy data:
 * 1. Real-time event subscription (state_changed events)
 * 2. Heartbeat monitoring (3-minute check)
 * 3. Hourly backfill for statistics
 * 4. Initial seeding if database is empty
 *
 * @module plugins/event-recorder
 */

// ============================================================================
// Time Constants (in milliseconds)
// ============================================================================

/** Heartbeat check interval - 3 minutes */
const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/** Maximum idle time before reconnection - 5 minutes */
const MAX_IDLE_TIME_MS = 5 * 60 * 1000;

/** Hourly backfill interval - 1 hour */
const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

/** Default backfill lookback period - 24 hours */
const DEFAULT_BACKFILL_HOURS = 24;

/** Initial seeding lookback period - 30 days */
const SEEDING_DAYS = 30;

/** TTL for sync log entries - 7 days */
const SYNC_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;

// ============================================================================
// Retry Configuration
// ============================================================================

/** Default maximum retry attempts */
const DEFAULT_MAX_RETRIES = 3;

/** Base delay for exponential backoff - 1 second */
const DEFAULT_BASE_DELAY_MS = 1000;

// ============================================================================
// Valid Energy Units
// ============================================================================

/** Valid units of measurement for energy entities */
const VALID_ENERGY_UNITS = ['kWh', 'Wh', 'W', 'kW'];

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * @typedef {Object} RecorderState
 * @property {boolean} isRunning - Whether the recorder is running
 * @property {Date|null} lastEventAt - Timestamp of last event
 * @property {number} entityCount - Number of tracked entities
 * @property {number} eventCount - Total events processed
 * @property {number} errorCount - Total errors encountered
 * @property {Set<string>} trackedEntities - Set of tracked entity IDs
 * @property {NodeJS.Timeout|null} heartbeatTimer - Heartbeat timer reference
 * @property {NodeJS.Timeout|null} hourlyTimer - Hourly backfill timer reference
 */

/**
 * @typedef {Object} EnergyReading
 * @property {string} entity_id - Entity identifier
 * @property {number} state - Current state value
 * @property {number|null} previous_state - Previous state value
 * @property {Object} [attributes] - Entity attributes
 * @property {number} timestamp - Timestamp in nanoseconds
 */

/**
 * @typedef {Object} EnergyStatistic
 * @property {string} entity_id - Entity identifier
 * @property {string} period - Aggregation period
 * @property {number|null} state - State value
 * @property {number|null} sum - Sum value
 * @property {number|null} mean - Mean value
 * @property {number|null} min - Minimum value
 * @property {number|null} max - Maximum value
 * @property {number} timestamp - Timestamp in nanoseconds
 */

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an entity is energy-related
 * @param {Object} state - Entity state object
 * @returns {boolean} True if entity is energy-related
 */
function isEnergyEntity(state) {
  const deviceClass = state.attributes?.device_class?.toLowerCase();
  const unit = state.attributes?.unit_of_measurement;

  return (
    deviceClass === 'energy' ||
    deviceClass === 'power' ||
    VALID_ENERGY_UNITS.includes(unit)
  );
}

/**
 * Parse state value to number
 * @param {*} value - State value
 * @returns {number|null}
 */
function parseStateValue(value) {
  if (
    value === null ||
    value === undefined ||
    value === 'unknown' ||
    value === 'unavailable'
  ) {
    return null;
  }
  const parsed = parseFloat(value);
  return isNaN(parsed) ? null : parsed;
}

/**
 * Retry function with exponential backoff
 * @param {Function} fn - Function to retry
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @param {number} baseDelay - Base delay in ms (default: 1000)
 * @returns {Promise<*>}
 */
async function retry(
  fn,
  maxRetries = DEFAULT_MAX_RETRIES,
  baseDelay = DEFAULT_BASE_DELAY_MS
) {
  let lastError;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      if (attempt < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

async function eventRecorderPlugin(fastify, options) {
  const logger = fastify.log;

  // Check if required plugins are available
  if (!fastify.ha) {
    logger.warn(
      'Home Assistant plugin not available - event recorder disabled'
    );
    return;
  }

  if (!fastify.mongo) {
    logger.warn('MongoDB plugin not available - event recorder disabled');
    return;
  }

  if (!fastify.questdb) {
    logger.warn('QuestDB plugin not available - event recorder disabled');
    return;
  }

  // Recorder state
  const state = {
    isRunning: false,
    lastEventAt: null,
    entityCount: 0,
    eventCount: 0,
    errorCount: 0,
    trackedEntities: new Set(),
    heartbeatTimer: null,
    hourlyTimer: null,
  };

  /**
   * Initialize recorder on ready
   */
  fastify.addHook('onReady', async () => {
    logger.info('Initializing Event Recorder Service');

    try {
      // 1. Create TTL index for syncLog
      await fastify.mongo.db
        .collection('syncLog')
        .createIndex(
          { createdAt: 1 },
          { expireAfterSeconds: SYNC_LOG_TTL_SECONDS }
        );
      logger.info('TTL index created for syncLog collection');

      // 2. Load known energy entities from MongoDB
      const entities = await fastify.mongo.getEntities({ isTracked: true });
      state.trackedEntities = new Set(entities.map((e) => e.entityId));
      state.entityCount = state.trackedEntities.size;

      logger.info({ count: state.entityCount }, 'Loaded tracked entities');

      // 3. Check if initial seeding is needed
      const needsSeeding = await checkIfSeedingNeeded();

      if (needsSeeding) {
        logger.info('Database is empty - starting initial seeding');
        await performInitialSeeding();
      }

      // 4. Subscribe to Home Assistant state_changed events
      await subscribeToEvents();

      // 5. Start heartbeat (3 minutes)
      startHeartbeat();

      // 6. Schedule hourly backfill
      scheduleHourlyBackfill();

      state.isRunning = true;
      logger.info('Event Recorder Service initialized successfully');
    } catch (error) {
      logger.error(
        { err: error },
        'Failed to initialize Event Recorder Service'
      );
      state.errorCount++;
    }
  });

  /**
   * Check if database needs initial seeding
   * @returns {Promise<boolean>}
   */
  async function checkIfSeedingNeeded() {
    try {
      const result = await fastify.questdb.query(
        'SELECT count() as count FROM energy_statistics LIMIT 1'
      );
      const count = result.dataset?.[0]?.[0] || 0;
      return count === 0;
    } catch (error) {
      logger.warn({ err: error }, 'Could not check if seeding needed');
      return false;
    }
  }

  /**
   * Perform initial database seeding
   */
  async function performInitialSeeding() {
    const startTime = Date.now();

    try {
      // Discover energy entities from Home Assistant
      const haEntities = await fastify.ha.discoverEntities();
      logger.info({ count: haEntities.length }, 'Discovered energy entities');

      // Store entities in MongoDB
      for (const entity of haEntities) {
        await fastify.mongo.upsertEntity({
          entity_id: entity.entity_id,
          friendly_name: entity.attributes?.friendly_name,
          device_class: entity.attributes?.device_class,
          unit_of_measurement: entity.attributes?.unit_of_measurement,
          state: entity.state,
          isTracked: true,
        });
        state.trackedEntities.add(entity.entity_id);
      }

      state.entityCount = state.trackedEntities.size;

      // Fetch all historical statistics (last SEEDING_DAYS days)
      const endTime = new Date();
      const startTime30Days = new Date(
        endTime.getTime() - SEEDING_DAYS * 24 * 60 * 60 * 1000
      );

      const entityIds = Array.from(state.trackedEntities);

      if (entityIds.length > 0) {
        logger.info(
          {
            entityCount: entityIds.length,
            startTime: startTime30Days.toISOString(),
            endTime: endTime.toISOString(),
          },
          'Fetching historical statistics for seeding'
        );

        const statistics = await fastify.ha.getStatistics(
          entityIds,
          startTime30Days.toISOString(),
          endTime.toISOString(),
          'hour'
        );

        // Transform and write statistics to QuestDB
        const statsToWrite = [];

        for (const [entityId, statsList] of Object.entries(statistics)) {
          if (!Array.isArray(statsList)) continue;

          for (const stat of statsList) {
            statsToWrite.push({
              entity_id: entityId,
              period: 'hour',
              state: stat.state != null ? parseFloat(stat.state) : null,
              sum: stat.sum != null ? parseFloat(stat.sum) : null,
              mean: stat.mean != null ? parseFloat(stat.mean) : null,
              min: stat.min != null ? parseFloat(stat.min) : null,
              max: stat.max != null ? parseFloat(stat.max) : null,
              timestamp: new Date(stat.start).getTime() * 1000000, // nanoseconds
            });
          }
        }

        if (statsToWrite.length > 0) {
          await retry(async () => {
            await fastify.questdb.writeStats(statsToWrite);
          });

          logger.info(
            { count: statsToWrite.length },
            'Initial seeding completed'
          );
        }

        // Log the sync
        await fastify.mongo.logSync({
          entityIds,
          recordsSynced: statsToWrite.length,
          startTime: startTime30Days,
          endTime,
          period: 'hour',
          duration: Date.now() - startTime,
          success: true,
        });
      }
    } catch (error) {
      logger.error({ err: error }, 'Initial seeding failed');
      state.errorCount++;

      await fastify.mongo.logSync({
        entityIds: Array.from(state.trackedEntities),
        recordsSynced: 0,
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Subscribe to Home Assistant state_changed events
   */
  async function subscribeToEvents() {
    try {
      await fastify.ha.subscribeToStateChanges(handleStateChanged);
      logger.info('Subscribed to state_changed events');

      // Update subscription state in MongoDB
      await fastify.mongo.db.collection('subscriptionState').updateOne(
        { _id: 'recorder' },
        {
          $set: {
            isActive: true,
            subscribedAt: new Date(),
            updatedAt: new Date(),
          },
          $setOnInsert: { createdAt: new Date() },
        },
        { upsert: true }
      );
    } catch (error) {
      logger.error({ err: error }, 'Failed to subscribe to events');
      state.errorCount++;
      throw error;
    }
  }

  /**
   * Handle state_changed events
   * @param {Object} event - State changed event
   */
  async function handleStateChanged(event) {
    try {
      const { entity_id, new_state, old_state } = event.data || {};

      if (!entity_id || !new_state) {
        return; // Skip invalid events
      }

      // Filter for energy entities only
      if (!isEnergyEntity(new_state)) {
        return;
      }

      // Parse state values
      const currentState = parseStateValue(new_state.state);
      const previousState = old_state ? parseStateValue(old_state.state) : null;

      if (currentState === null) {
        return; // Skip unavailable/unknown states
      }

      // Update last event timestamp
      state.lastEventAt = new Date();
      state.eventCount++;

      // Write to QuestDB
      const reading = {
        entity_id,
        state: currentState,
        previous_state: previousState,
        attributes: new_state.attributes,
        timestamp: new Date(new_state.last_changed).getTime() * 1000000, // nanoseconds
      };

      await retry(async () => {
        await fastify.questdb.writeReadings([reading]);
      });

      // Update subscription state in MongoDB (don't await - fire and forget)
      fastify.mongo.incrementEventCount(entity_id).catch((err) => {
        logger.warn({ err, entity_id }, 'Failed to increment event count');
      });

      logger.debug(
        { entity_id, state: currentState },
        'Recorded energy reading'
      );
    } catch (error) {
      logger.warn(
        { err: error, event: event.data?.entity_id },
        'Error handling state_changed event'
      );
      state.errorCount++;
    }
  }

  /**
   * Start heartbeat monitor
   */
  function startHeartbeat() {
    state.heartbeatTimer = setInterval(async () => {
      try {
        const now = new Date();
        const timeSinceLastEvent = state.lastEventAt
          ? now.getTime() - state.lastEventAt.getTime()
          : Infinity;

        logger.debug(
          {
            timeSinceLastEvent,
            eventCount: state.eventCount,
            errorCount: state.errorCount,
          },
          'Heartbeat check'
        );

        // Check if we haven't received events in over MAX_IDLE_TIME_MS
        if (timeSinceLastEvent > MAX_IDLE_TIME_MS) {
          logger.warn(
            { idleMs: MAX_IDLE_TIME_MS },
            'No events received - reconnecting to Home Assistant'
          );

          // Reconnect to Home Assistant
          await fastify.ha.reconnect();

          // Resubscribe to events
          await subscribeToEvents();

          // Trigger backfill to catch up on missed data
          await performBackfill('heartbeat');
        }
      } catch (error) {
        logger.error({ err: error }, 'Heartbeat check failed');
        state.errorCount++;
      }
    }, HEARTBEAT_INTERVAL_MS);

    logger.info(
      { intervalMs: HEARTBEAT_INTERVAL_MS },
      'Heartbeat monitor started'
    );
  }

  /**
   * Schedule hourly backfill
   */
  function scheduleHourlyBackfill() {
    state.hourlyTimer = setInterval(async () => {
      try {
        await performBackfill('hourly');
      } catch (error) {
        logger.error({ err: error }, 'Hourly backfill failed');
        state.errorCount++;
      }
    }, HOURLY_INTERVAL_MS);

    logger.info(
      { intervalMs: HOURLY_INTERVAL_MS },
      'Hourly backfill scheduled'
    );
  }

  /**
   * Perform backfill of statistics
   * @param {string} trigger - What triggered the backfill ('hourly', 'heartbeat', 'manual')
   */
  async function performBackfill(trigger = 'manual') {
    const startTime = Date.now();

    logger.info({ trigger }, 'Starting backfill');

    try {
      const entityIds = Array.from(state.trackedEntities);

      if (entityIds.length === 0) {
        logger.warn('No tracked entities for backfill');
        return;
      }

      // Get latest statistics timestamp for each entity
      const endTime = new Date();
      const statsToWrite = [];

      for (const entityId of entityIds) {
        try {
          // Get latest timestamp from QuestDB
          const latestTime = await fastify.questdb.getLatestStatsTime(
            entityId,
            'hour'
          );

          // Default to DEFAULT_BACKFILL_HOURS ago if no data exists
          const startTime = latestTime
            ? new Date(latestTime)
            : new Date(
                endTime.getTime() - DEFAULT_BACKFILL_HOURS * 60 * 60 * 1000
              );

          // Fetch statistics from Home Assistant
          const statistics = await fastify.ha.getStatistics(
            [entityId],
            startTime.toISOString(),
            endTime.toISOString(),
            'hour'
          );

          const statsList = statistics[entityId];

          if (Array.isArray(statsList)) {
            for (const stat of statsList) {
              statsToWrite.push({
                entity_id: entityId,
                period: 'hour',
                state: stat.state != null ? parseFloat(stat.state) : null,
                sum: stat.sum != null ? parseFloat(stat.sum) : null,
                mean: stat.mean != null ? parseFloat(stat.mean) : null,
                min: stat.min != null ? parseFloat(stat.min) : null,
                max: stat.max != null ? parseFloat(stat.max) : null,
                timestamp: new Date(stat.start).getTime() * 1000000, // nanoseconds
              });
            }
          }
        } catch (error) {
          logger.warn({ err: error, entityId }, 'Failed to backfill entity');
        }
      }

      // Write statistics to QuestDB
      if (statsToWrite.length > 0) {
        await retry(async () => {
          await fastify.questdb.writeStats(statsToWrite);
        });

        logger.info(
          {
            count: statsToWrite.length,
            trigger,
            duration: Date.now() - startTime,
          },
          'Backfill completed'
        );
      } else {
        logger.debug({ trigger }, 'No new statistics to backfill');
      }

      // Log the sync
      await fastify.mongo.logSync({
        entityIds,
        recordsSynced: statsToWrite.length,
        period: 'hour',
        duration: Date.now() - startTime,
        success: true,
      });
    } catch (error) {
      logger.error({ err: error, trigger }, 'Backfill failed');
      state.errorCount++;

      await fastify.mongo.logSync({
        entityIds: Array.from(state.trackedEntities),
        recordsSynced: 0,
        duration: Date.now() - startTime,
        success: false,
        error: error.message,
      });
    }
  }

  /**
   * Decorate fastify with recorder state and controls
   */
  fastify.decorate('recorder', {
    getState: () => ({ ...state, trackedEntities: state.trackedEntities.size }),
    triggerBackfill: () => performBackfill('manual'),
    reseedDatabase: performInitialSeeding,
  });

  /**
   * Cleanup on shutdown
   */
  fastify.addHook('onClose', async () => {
    logger.info('Shutting down Event Recorder Service');

    // Clear timers
    if (state.heartbeatTimer) {
      clearInterval(state.heartbeatTimer);
      state.heartbeatTimer = null;
    }

    if (state.hourlyTimer) {
      clearInterval(state.hourlyTimer);
      state.hourlyTimer = null;
    }

    // Update subscription state
    try {
      await fastify.mongo.db.collection('subscriptionState').updateOne(
        { _id: 'recorder' },
        {
          $set: {
            isActive: false,
            updatedAt: new Date(),
          },
        }
      );
    } catch (error) {
      logger.warn(
        { err: error },
        'Failed to update subscription state on shutdown'
      );
    }

    state.isRunning = false;
    logger.info('Event Recorder Service shut down');
  });
}

export default fp(eventRecorderPlugin, {
  name: 'event-recorder',
  dependencies: ['mongodb', 'questdb', 'home-assistant'],
});
