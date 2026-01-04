/**
 * Recorder Utility Functions
 *
 * Pure helper functions for the event recorder service.
 * Extracted for testability.
 *
 * @module lib/utils
 */

// ============================================================================
// Time Constants (in milliseconds)
// ============================================================================

/** Heartbeat check interval - 3 minutes */
export const HEARTBEAT_INTERVAL_MS = 3 * 60 * 1000;

/** Maximum idle time before reconnection - 5 minutes */
export const MAX_IDLE_TIME_MS = 5 * 60 * 1000;

/** Hourly backfill interval - 1 hour */
export const HOURLY_INTERVAL_MS = 60 * 60 * 1000;

/** Default backfill lookback period - 24 hours */
export const DEFAULT_BACKFILL_HOURS = 24;

/** Initial seeding lookback period - 30 days */
export const SEEDING_DAYS = 30;

/** TTL for sync log entries - 7 days */
export const SYNC_LOG_TTL_SECONDS = 7 * 24 * 60 * 60;

// ============================================================================
// Retry Configuration
// ============================================================================

/** Default maximum retry attempts */
export const DEFAULT_MAX_RETRIES = 3;

/** Base delay for exponential backoff - 1 second */
export const DEFAULT_BASE_DELAY_MS = 1000;

// ============================================================================
// Valid Energy Units
// ============================================================================

/** Valid units of measurement for energy entities */
export const VALID_ENERGY_UNITS = ['kWh', 'Wh', 'W', 'kW'];

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Check if an entity is energy-related
 * @param {Object} state - Entity state object
 * @returns {boolean} True if entity is energy-related
 */
export function isEnergyEntity(state) {
  if (!state || !state.attributes) {
    return false;
  }

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
export function parseStateValue(value) {
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
export async function retry(
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

/**
 * Transform Home Assistant statistics to QuestDB format
 * @param {string} entityId - Entity ID
 * @param {Array} statsList - List of statistics from Home Assistant
 * @param {string} period - Aggregation period (e.g., 'hour')
 * @returns {Array} Transformed statistics ready for QuestDB
 */
export function transformStatistics(entityId, statsList, period = 'hour') {
  if (!Array.isArray(statsList)) {
    return [];
  }

  return statsList.map((stat) => ({
    entity_id: entityId,
    period,
    state: stat.state != null ? parseFloat(stat.state) : null,
    sum: stat.sum != null ? parseFloat(stat.sum) : null,
    mean: stat.mean != null ? parseFloat(stat.mean) : null,
    min: stat.min != null ? parseFloat(stat.min) : null,
    max: stat.max != null ? parseFloat(stat.max) : null,
    timestamp: new Date(stat.start).getTime() * 1000000, // nanoseconds
  }));
}

/**
 * Create an energy reading object from state change event
 * @param {string} entityId - Entity ID
 * @param {Object} newState - New state object
 * @param {Object|null} oldState - Previous state object
 * @returns {Object|null} Energy reading or null if invalid
 */
export function createEnergyReading(entityId, newState, oldState) {
  const currentState = parseStateValue(newState?.state);
  const previousState = oldState ? parseStateValue(oldState.state) : null;

  if (currentState === null) {
    return null;
  }

  return {
    entity_id: entityId,
    state: currentState,
    previous_state: previousState,
    attributes: newState.attributes,
    timestamp: new Date(newState.last_changed).getTime() * 1000000, // nanoseconds
  };
}

/**
 * Calculate time since last event
 * @param {Date|null} lastEventAt - Last event timestamp
 * @returns {number} Time in milliseconds since last event (Infinity if no event)
 */
export function timeSinceLastEvent(lastEventAt) {
  if (!lastEventAt) {
    return Infinity;
  }
  return Date.now() - lastEventAt.getTime();
}

/**
 * Check if reconnection is needed based on idle time
 * @param {Date|null} lastEventAt - Last event timestamp
 * @param {number} maxIdleTime - Maximum idle time in ms
 * @returns {boolean} True if reconnection needed
 */
export function needsReconnection(lastEventAt, maxIdleTime = MAX_IDLE_TIME_MS) {
  return timeSinceLastEvent(lastEventAt) > maxIdleTime;
}
