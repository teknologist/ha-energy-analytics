/**
 * Utility functions for the API
 */

/**
 * Format a timestamp to ISO string
 * @param {Date|string|number} timestamp - Timestamp to format
 * @returns {string} ISO formatted timestamp
 */
export function formatTimestamp(timestamp) {
  if (!timestamp) {
    return new Date().toISOString();
  }
  return new Date(timestamp).toISOString();
}

/**
 * Validate entity ID format (e.g., sensor.power_usage)
 * @param {string} entityId - Entity ID to validate
 * @returns {boolean} True if valid
 */
export function isValidEntityId(entityId) {
  if (!entityId || typeof entityId !== 'string') {
    return false;
  }
  // Format: domain.entity (e.g., sensor.power_usage)
  const pattern = /^[a-z_]+\.[a-z0-9_]+$/;
  return pattern.test(entityId);
}

/**
 * Parse time range for statistics queries
 * @param {string|Date} start - Start time
 * @param {string|Date} end - End time
 * @returns {{start: Date, end: Date}} Parsed date range
 */
export function parseTimeRange(start, end) {
  const startDate = start
    ? new Date(start)
    : new Date(Date.now() - 24 * 60 * 60 * 1000);
  const endDate = end ? new Date(end) : new Date();

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    throw new Error('Invalid date format');
  }

  if (startDate >= endDate) {
    throw new Error('Start date must be before end date');
  }

  return { start: startDate, end: endDate };
}

/**
 * Calculate duration in milliseconds
 * @param {Date} start - Start time
 * @param {Date} end - End time
 * @returns {number} Duration in milliseconds
 */
export function calculateDuration(start, end) {
  return end.getTime() - start.getTime();
}

/**
 * Sanitize entity data for storage
 * @param {object} entity - Raw entity data
 * @returns {object} Sanitized entity
 */
export function sanitizeEntity(entity) {
  return {
    entityId: entity.entity_id,
    friendlyName: entity.friendly_name || entity.entity_id,
    deviceClass: entity.device_class || null,
    unitOfMeasurement: entity.unit_of_measurement || null,
    state: entity.state,
    lastUpdated: entity.last_updated
      ? new Date(entity.last_updated)
      : new Date(),
    attributes: entity.attributes || {},
  };
}
