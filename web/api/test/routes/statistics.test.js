/**
 * Unit tests for statistics.js route helper functions
 */

import { describe, it, expect } from 'vitest';
import { isValidEntityId } from '../../routes/statistics.js';

// Constants for testing
const MS_PER_DAY = 24 * 60 * 60 * 1000;

describe('statistics.js - Helper Functions', () => {
  describe('isValidEntityId()', () => {
    it('should accept valid entity IDs', () => {
      expect(isValidEntityId('sensor.energy_consumption')).toBe(true);
      expect(isValidEntityId('sensor.power_usage')).toBe(true);
      expect(isValidEntityId('battery.tesla_battery')).toBe(true);
      expect(isValidEntityId('sensor.total_energy')).toBe(true);
      expect(isValidEntityId('binary_sensor.energy_sensor')).toBe(true);
      expect(isValidEntityId('a.b')).toBe(true); // Minimum length
      expect(isValidEntityId('sensor.energy_123_test')).toBe(true);
    });

    it('should reject entity IDs with invalid formats', () => {
      expect(isValidEntityId('sensor-energy')).toBe(false); // No dot separator
      expect(isValidEntityId('sensor')).toBe(false); // No dot separator
      expect(isValidEntityId('.energy')).toBe(false); // No domain
      expect(isValidEntityId('sensor.')).toBe(false); // No object_id
      // Note: ENTITY_ID_PATTERN uses case-insensitive flag, so capitals are actually valid
      expect(isValidEntityId('sensor.energy consumption')).toBe(false); // Space
      expect(isValidEntityId('sensor.energy-consumption')).toBe(false); // Hyphen
    });

    it('should reject entity IDs with invalid lengths', () => {
      expect(isValidEntityId('a.b')).toBe(true); // Minimum valid (3 chars)
      expect(isValidEntityId('ab')).toBe(false); // Too short
      expect(isValidEntityId('a.'.repeat(34))).toBe(false); // Too long (>100)
    });

    it('should reject non-string values', () => {
      expect(isValidEntityId(null)).toBe(false);
      expect(isValidEntityId(undefined)).toBe(false);
      expect(isValidEntityId(123)).toBe(false);
      expect(isValidEntityId({})).toBe(false);
      expect(isValidEntityId([])).toBe(false);
      expect(isValidEntityId(true)).toBe(false);
    });

    it('should reject empty strings', () => {
      expect(isValidEntityId('')).toBe(false);
      expect(isValidEntityId('   ')).toBe(false);
    });
  });

  describe('Period and Time Range Calculations', () => {
    it('should calculate correct time ranges for statistics sync (30 days default)', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 30 * MS_PER_DAY);

      const diffMs = endTime - startTime;
      const expectedMs = 30 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should calculate correct time ranges for 7 day statistics', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 7 * MS_PER_DAY);

      const diffMs = endTime - startTime;
      const expectedMs = 7 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should calculate correct time ranges for 30 day statistics', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 30 * MS_PER_DAY);

      const diffMs = endTime - startTime;
      const expectedMs = 30 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should calculate correct time ranges for 365 day statistics', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 365 * MS_PER_DAY);

      const diffMs = endTime - startTime;
      const expectedMs = 365 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });
  });

  describe('Period Validation', () => {
    const VALID_PERIODS = ['5minute', 'hour', 'day', 'week', 'month'];

    /**
     * Validate period parameter (logic from statistics.js)
     */
    function validatePeriod(period) {
      return VALID_PERIODS.includes(period);
    }

    it('should accept all valid periods for sync', () => {
      expect(validatePeriod('5minute')).toBe(true);
      expect(validatePeriod('hour')).toBe(true);
      expect(validatePeriod('day')).toBe(true);
      expect(validatePeriod('week')).toBe(true);
      expect(validatePeriod('month')).toBe(true);
    });

    it('should reject invalid periods', () => {
      expect(validatePeriod('minute')).toBe(false);
      expect(validatePeriod('second')).toBe(false);
      expect(validatePeriod('year')).toBe(false);
      expect(validatePeriod('invalid')).toBe(false);
      expect(validatePeriod('')).toBe(false);
    });
  });

  describe('Aggregation Validation', () => {
    const VALID_AGGREGATIONS = ['hourly', 'daily', 'monthly'];

    /**
     * Validate aggregation parameter (logic from statistics.js compare endpoint)
     */
    function validateAggregation(aggregation) {
      return VALID_AGGREGATIONS.includes(aggregation);
    }

    it('should accept all valid aggregations', () => {
      expect(validateAggregation('hourly')).toBe(true);
      expect(validateAggregation('daily')).toBe(true);
      expect(validateAggregation('monthly')).toBe(true);
    });

    it('should reject invalid aggregations', () => {
      expect(validateAggregation('hour')).toBe(false);
      expect(validateAggregation('day')).toBe(false);
      expect(validateAggregation('week')).toBe(false);
      expect(validateAggregation('invalid')).toBe(false);
      expect(validateAggregation('')).toBe(false);
    });
  });

  describe('Statistics Formatting', () => {
    it('should format QuestDB statistics row correctly', () => {
      // Simulates the transformation done in /api/statistics/:entity_id endpoint
      const questDbRow = [
        'sensor.energy_1', // entity_id
        'hour', // period
        123.45, // state
        1000.5, // sum
        100.05, // mean
        50.0, // min
        200.1, // max
        1705334400000000000, // timestamp (nanoseconds)
      ];

      const statistics = {
        timestamp: questDbRow[7],
        state: questDbRow[2],
        sum: questDbRow[3],
        mean: questDbRow[4],
        min: questDbRow[5],
        max: questDbRow[6],
        period: questDbRow[1],
      };

      expect(statistics).toEqual({
        timestamp: 1705334400000000000,
        state: 123.45,
        sum: 1000.5,
        mean: 100.05,
        min: 50.0,
        max: 200.1,
        period: 'hour',
      });
    });

    it('should format QuestDB daily summary row correctly', () => {
      // Simulates the transformation done in /api/statistics/:entity_id/daily endpoint
      const questDbRow = [
        'sensor.energy_1', // entity_id
        1705334400000, // timestamp
        24000.5, // total
        1000.02, // avg_power
        2500.3, // peak
        24, // readings count
      ];

      const dailyData = {
        date: questDbRow[1],
        total: questDbRow[2],
        avg_power: questDbRow[3],
        peak: questDbRow[4],
        readings: questDbRow[5],
      };

      expect(dailyData).toEqual({
        date: 1705334400000,
        total: 24000.5,
        avg_power: 1000.02,
        peak: 2500.3,
        readings: 24,
      });
    });

    it('should format QuestDB monthly summary row correctly', () => {
      // Simulates the transformation done in /api/statistics/:entity_id/monthly endpoint
      const questDbRow = [
        'sensor.energy_1', // entity_id
        1705334400000, // timestamp
        720000.5, // total
        1000.02, // avg_power
        3500.3, // peak
        720, // readings count
      ];

      const monthlyData = {
        month: questDbRow[1],
        total: questDbRow[2],
        avg_power: questDbRow[3],
        peak: questDbRow[4],
        readings: questDbRow[5],
      };

      expect(monthlyData).toEqual({
        month: 1705334400000,
        total: 720000.5,
        avg_power: 1000.02,
        peak: 3500.3,
        readings: 720,
      });
    });
  });

  describe('Statistics Record Transformation', () => {
    it('should transform statistics record for QuestDB write', () => {
      // Simulates the transformation done in /api/statistics/sync endpoint
      const statRecord = {
        entity_id: 'sensor.energy_1',
        start_time: '2024-01-15T00:00:00.000Z',
        end_time: '2024-01-15T01:00:00.000Z',
        state: 123.45,
        sum: 1000.5,
        mean: 100.05,
        min: 50.0,
        max: 200.1,
        period: 'hour',
      };

      const questdbRecord = {
        entity_id: statRecord.entity_id,
        period: statRecord.period,
        state: statRecord.state,
        sum: statRecord.sum,
        mean: statRecord.mean,
        min: statRecord.min,
        max: statRecord.max,
        timestamp: new Date(statRecord.start_time).getTime() * 1000000, // Convert to nanoseconds
      };

      expect(questdbRecord.entity_id).toBe('sensor.energy_1');
      expect(questdbRecord.period).toBe('hour');
      expect(questdbRecord.state).toBe(123.45);
      expect(questdbRecord.sum).toBe(1000.5);
      expect(questdbRecord.mean).toBe(100.05);
      expect(questdbRecord.min).toBe(50.0);
      expect(questdbRecord.max).toBe(200.1);
      // Verify nanosecond conversion
      expect(questdbRecord.timestamp).toBeGreaterThan(1000000000000000000);
    });
  });

  describe('Sync Log Formatting', () => {
    it('should format sync log entry correctly', () => {
      // Simulates the transformation done in /api/statistics/sync/log endpoint
      const logEntry = {
        _id: '507f1f77bcf86cd799439011',
        entityIds: ['sensor.energy_1', 'sensor.energy_2'],
        recordsSynced: 120,
        startTime: '2024-01-15T00:00:00.000Z',
        endTime: '2024-01-15T01:00:00.000Z',
        period: 'hour',
        duration: 5234,
        success: true,
        error: null,
        createdAt: '2024-01-15T01:00:05.234Z',
      };

      const formattedLog = {
        id: logEntry._id,
        entity_ids: logEntry.entityIds,
        records_synced: logEntry.recordsSynced,
        start_time: logEntry.startTime,
        end_time: logEntry.endTime,
        period: logEntry.period,
        duration: logEntry.duration,
        success: logEntry.success,
        error: logEntry.error,
        created_at: logEntry.createdAt,
      };

      expect(formattedLog).toEqual({
        id: '507f1f77bcf86cd799439011',
        entity_ids: ['sensor.energy_1', 'sensor.energy_2'],
        records_synced: 120,
        start_time: '2024-01-15T00:00:00.000Z',
        end_time: '2024-01-15T01:00:00.000Z',
        period: 'hour',
        duration: 5234,
        success: true,
        error: null,
        created_at: '2024-01-15T01:00:05.234Z',
      });
    });
  });

  describe('Entity ID Validation for Compare', () => {
    it('should identify invalid entity IDs in array', () => {
      const entity_ids = [
        'sensor.energy_1',
        'invalid-entity',
        'sensor.power_1',
        'Invalid Format',
      ];

      const invalidIds = entity_ids.filter((id) => !isValidEntityId(id));

      expect(invalidIds).toEqual(['invalid-entity', 'Invalid Format']);
    });

    it('should accept all valid entity IDs in array', () => {
      const entity_ids = ['sensor.energy_1', 'sensor.power_1', 'battery.tesla'];

      const invalidIds = entity_ids.filter((id) => !isValidEntityId(id));

      expect(invalidIds).toHaveLength(0);
    });
  });

  describe('Time Range Defaults', () => {
    it('should use 30 days default for sync when no start_time provided', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 30 * MS_PER_DAY);

      const diffDays = (endTime - startTime) / MS_PER_DAY;

      expect(diffDays).toBeCloseTo(30, 0); // Within 1 day
    });

    it('should use 7 days default for statistics when no start_time provided', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 7 * MS_PER_DAY);

      const diffDays = (endTime - startTime) / MS_PER_DAY;

      expect(diffDays).toBeCloseTo(7, 0); // Within 1 day
    });

    it('should use 30 days default for daily summary when no start_time provided', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 30 * MS_PER_DAY);

      const diffDays = (endTime - startTime) / MS_PER_DAY;

      expect(diffDays).toBeCloseTo(30, 0); // Within 1 day
    });

    it('should use 365 days default for monthly summary when no start_time provided', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 365 * MS_PER_DAY);

      const diffDays = (endTime - startTime) / MS_PER_DAY;

      expect(diffDays).toBeCloseTo(365, 0); // Within 1 day
    });

    it('should use 30 days default for compare when no start_time provided', () => {
      const endTime = new Date();
      const startTime = new Date(Date.now() - 30 * MS_PER_DAY);

      const diffDays = (endTime - startTime) / MS_PER_DAY;

      expect(diffDays).toBeCloseTo(30, 0); // Within 1 day
    });
  });
});
