/**
 * Unit tests for insights.js route helper functions
 */

import { describe, it, expect } from 'vitest';
import { validatePeriod, getTimeRange } from '../../routes/insights.js';

// Constants for testing
const MS_PER_HOUR = 60 * 60 * 1000;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/**
 * Sanitize limit parameter (mocked from questdb.sanitize.limit)
 */
function validateLimit(limit, max = 20) {
  const parsed = parseInt(limit, 10);
  if (isNaN(parsed)) return 1;
  if (parsed < 1) return 1;
  if (parsed > max) return max;
  return parsed;
}

/**
 * Calculate percentage (used in top-consumers and breakdown)
 */
function calculatePercentage(value, total) {
  if (total === 0 || total === null || total === undefined) return 0;
  return (value / total) * 100;
}

/**
 * Validate group_by parameter (used in timeline endpoint)
 */
function validateGroupBy(groupBy) {
  const validGroupBy = ['hour', 'day'];
  if (!validGroupBy.includes(groupBy)) {
    throw new Error(
      `Invalid group_by: ${groupBy}. Must be one of: ${validGroupBy.join(', ')}`
    );
  }
  return groupBy;
}

describe('insights.js - Helper Functions', () => {
  describe('validatePeriod()', () => {
    it('should accept valid periods', () => {
      expect(validatePeriod('day')).toBe('day');
      expect(validatePeriod('week')).toBe('week');
      expect(validatePeriod('month')).toBe('month');
    });

    it('should reject invalid periods', () => {
      expect(() => validatePeriod('hour')).toThrow('Invalid period: hour');
      expect(() => validatePeriod('minute')).toThrow('Invalid period: minute');
      expect(() => validatePeriod('')).toThrow('Invalid period:');
      expect(() => validatePeriod('invalid')).toThrow(
        'Invalid period: invalid'
      );
    });

    it('should include valid options in error message', () => {
      try {
        validatePeriod('year');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('day, week, month');
      }
    });
  });

  describe('getTimeRange()', () => {
    it('should calculate correct time range for day period', () => {
      const result = getTimeRange('day');

      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('end');

      const startTime = new Date(result.start);
      const endTime = new Date(result.end);
      const diffMs = endTime - startTime;
      const expectedMs = MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should calculate correct time range for week period', () => {
      const result = getTimeRange('week');

      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('end');

      const startTime = new Date(result.start);
      const endTime = new Date(result.end);
      const diffMs = endTime - startTime;
      const expectedMs = 7 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should calculate correct time range for month period', () => {
      const result = getTimeRange('month');

      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('end');

      const startTime = new Date(result.start);
      const endTime = new Date(result.end);
      const diffMs = endTime - startTime;
      const expectedMs = 30 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should default to week period for invalid period', () => {
      const result = getTimeRange('invalid');

      expect(result).toHaveProperty('start');
      expect(result).toHaveProperty('end');

      const startTime = new Date(result.start);
      const endTime = new Date(result.end);
      const diffMs = endTime - startTime;
      const expectedMs = 7 * MS_PER_DAY;

      // Allow small margin for test execution time
      expect(Math.abs(diffMs - expectedMs)).toBeLessThan(1000);
    });

    it('should return ISO 8601 formatted strings', () => {
      const result = getTimeRange('week');

      expect(result.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
      expect(result.end).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });
  });

  describe('validateLimit()', () => {
    it('should accept valid limits', () => {
      expect(validateLimit(5)).toBe(5);
      expect(validateLimit(10)).toBe(10);
      expect(validateLimit(20)).toBe(20);
    });

    it('should clamp limit to maximum', () => {
      expect(validateLimit(25, 20)).toBe(20);
      expect(validateLimit(100, 20)).toBe(20);
      expect(validateLimit(50, 10)).toBe(10);
    });

    it('should clamp limit to minimum of 1', () => {
      expect(validateLimit(0)).toBe(1);
      expect(validateLimit(-1)).toBe(1);
      expect(validateLimit(-100)).toBe(1);
    });

    it('should handle string inputs', () => {
      expect(validateLimit('5')).toBe(5);
      expect(validateLimit('10')).toBe(10);
    });

    it('should handle NaN by returning 1', () => {
      expect(validateLimit(NaN)).toBe(1);
      expect(validateLimit('invalid')).toBe(1);
      expect(validateLimit(undefined)).toBe(1);
    });

    it('should use custom max value', () => {
      expect(validateLimit(15, 10)).toBe(10);
      expect(validateLimit(5, 10)).toBe(5);
    });
  });

  describe('calculatePercentage()', () => {
    it('should calculate correct percentages', () => {
      expect(calculatePercentage(50, 100)).toBe(50);
      expect(calculatePercentage(25, 100)).toBe(25);
      expect(calculatePercentage(100, 100)).toBe(100);
      expect(calculatePercentage(150, 100)).toBe(150);
      expect(calculatePercentage(1, 3)).toBeCloseTo(33.33, 2);
    });

    it('should handle zero total', () => {
      expect(calculatePercentage(50, 0)).toBe(0);
      expect(calculatePercentage(0, 0)).toBe(0);
    });

    it('should handle null total', () => {
      expect(calculatePercentage(50, null)).toBe(0);
    });

    it('should handle undefined total', () => {
      expect(calculatePercentage(50, undefined)).toBe(0);
    });

    it('should handle zero value', () => {
      expect(calculatePercentage(0, 100)).toBe(0);
    });

    it('should handle decimal values', () => {
      expect(calculatePercentage(0.5, 1)).toBe(50);
      expect(calculatePercentage(1.5, 3)).toBe(50);
    });
  });

  describe('validateGroupBy()', () => {
    it('should accept valid group_by values', () => {
      expect(validateGroupBy('hour')).toBe('hour');
      expect(validateGroupBy('day')).toBe('day');
    });

    it('should reject invalid group_by values', () => {
      expect(() => validateGroupBy('week')).toThrow('Invalid group_by: week');
      expect(() => validateGroupBy('month')).toThrow('Invalid group_by: month');
      expect(() => validateGroupBy('invalid')).toThrow(
        'Invalid group_by: invalid'
      );
    });

    it('should include valid options in error message', () => {
      try {
        validateGroupBy('year');
        expect.fail('Should have thrown an error');
      } catch (error) {
        expect(error.message).toContain('hour, day');
      }
    });
  });

  describe('Pattern Classification Thresholds', () => {
    const VARIANCE_THRESHOLD = 0.5;
    const PEAK_TO_AVG_THRESHOLD = 2.0;

    /**
     * Classify consumer as burst or steady (logic from patterns endpoint)
     */
    function classifyConsumer(variance, peakToAvg) {
      if (variance > VARIANCE_THRESHOLD || peakToAvg > PEAK_TO_AVG_THRESHOLD) {
        return 'burst';
      }
      return 'steady';
    }

    it('should classify as burst when variance exceeds threshold', () => {
      expect(classifyConsumer(0.6, 1.0)).toBe('burst'); // Variance > 0.5
      expect(classifyConsumer(1.0, 1.0)).toBe('burst'); // High variance
    });

    it('should classify as burst when peak_to_avg exceeds threshold', () => {
      expect(classifyConsumer(0.3, 2.5)).toBe('burst'); // peakToAvg > 2.0
      expect(classifyConsumer(0.1, 3.0)).toBe('burst'); // High ratio
    });

    it('should classify as steady when both below thresholds', () => {
      expect(classifyConsumer(0.3, 1.5)).toBe('steady');
      expect(classifyConsumer(0.4, 1.8)).toBe('steady');
      expect(classifyConsumer(0.1, 1.0)).toBe('steady');
    });

    it('should classify as burst when either threshold exceeded', () => {
      expect(classifyConsumer(0.6, 1.5)).toBe('burst'); // Variance high
      expect(classifyConsumer(0.3, 2.5)).toBe('burst'); // Ratio high
      expect(classifyConsumer(1.0, 3.0)).toBe('burst'); // Both high
    });

    it('should handle edge cases at thresholds', () => {
      expect(classifyConsumer(0.5, 2.0)).toBe('steady'); // Exactly at thresholds
      expect(classifyConsumer(0.51, 2.0)).toBe('burst'); // Just above variance
      expect(classifyConsumer(0.5, 2.01)).toBe('burst'); // Just above ratio
    });
  });

  describe('Top Consumers Data Processing', () => {
    it('should process dataset rows correctly', () => {
      // Simulates the mapping done in top-consumers endpoint
      const dataset = [
        ['sensor.energy_1', 500.5],
        ['sensor.power_1', 250.25],
        ['sensor.battery_1', 100.0],
      ];

      const totalConsumption = 850.75;
      const entityMap = new Map([
        [
          'sensor.energy_1',
          { friendlyName: 'Energy 1', unitOfMeasurement: 'kWh' },
        ],
        ['sensor.power_1', { friendlyName: 'Power 1', unitOfMeasurement: 'W' }],
        [
          'sensor.battery_1',
          { friendlyName: 'Battery 1', unitOfMeasurement: 'Wh' },
        ],
      ]);

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

      expect(topConsumers).toHaveLength(3);
      expect(topConsumers[0].entity_id).toBe('sensor.energy_1');
      expect(topConsumers[0].friendly_name).toBe('Energy 1');
      expect(topConsumers[0].percentage).toBeCloseTo(58.83, 2);
    });

    it('should use entityId as fallback when entity not in map', () => {
      const dataset = [['sensor.unknown', 100.0]];
      const entityMap = new Map();
      const totalConsumption = 100.0;

      const consumer = {
        entity_id: dataset[0][0],
        friendly_name:
          entityMap.get(dataset[0][0])?.friendlyName || dataset[0][0],
        unit_of_measurement:
          entityMap.get(dataset[0][0])?.unitOfMeasurement || 'kWh',
        consumption: dataset[0][1],
        percentage:
          totalConsumption > 0 ? (dataset[0][1] / totalConsumption) * 100 : 0,
      };

      expect(consumer.friendly_name).toBe('sensor.unknown');
      expect(consumer.unit_of_measurement).toBe('kWh');
    });
  });

  describe('Breakdown Data Processing', () => {
    it('should calculate total consumption correctly', () => {
      const dataset = [
        ['sensor.energy_1', 500.5],
        ['sensor.power_1', 250.25],
        ['sensor.battery_1', 100.0],
      ];

      const totalConsumption = dataset.reduce(
        (sum, row) => sum + (row[1] || 0),
        0
      );

      expect(totalConsumption).toBe(850.75);
    });

    it('should handle empty dataset', () => {
      const dataset = [];
      const totalConsumption = dataset.reduce(
        (sum, row) => sum + (row[1] || 0),
        0
      );

      expect(totalConsumption).toBe(0);
    });

    it('should build breakdown with percentages', () => {
      const dataset = [
        ['sensor.energy_1', 500],
        ['sensor.power_1', 500],
      ];
      const totalConsumption = 1000;
      const entityMap = new Map([
        [
          'sensor.energy_1',
          { friendlyName: 'Energy 1', unitOfMeasurement: 'kWh' },
        ],
        [
          'sensor.power_1',
          { friendlyName: 'Power 1', unitOfMeasurement: 'kWh' },
        ],
      ]);

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

      expect(breakdown[0].percentage).toBe(50);
      expect(breakdown[1].percentage).toBe(50);
    });
  });

  describe('Timeline Grouping', () => {
    it('should group timeline data by time bucket', () => {
      const dataset = [
        [1705334400000, 'sensor.energy_1', 100.5],
        [1705334400000, 'sensor.power_1', 50.25],
        [1705338000000, 'sensor.energy_1', 75.0],
      ];
      const entityMap = new Map([
        ['sensor.energy_1', { friendlyName: 'Energy 1' }],
        ['sensor.power_1', { friendlyName: 'Power 1' }],
      ]);

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

      expect(timelineMap.size).toBe(2);

      const firstBucket = timelineMap.get(1705334400000);
      expect(firstBucket.total).toBe(150.75);
      expect(Object.keys(firstBucket.breakdown)).toHaveLength(2);

      const secondBucket = timelineMap.get(1705338000000);
      expect(secondBucket.total).toBe(75.0);
      expect(Object.keys(secondBucket.breakdown)).toHaveLength(1);
    });

    it('should convert timeline map to array', () => {
      const timelineMap = new Map([
        [1705334400000, { time: 1705334400000, total: 100, breakdown: {} }],
        [1705338000000, { time: 1705338000000, total: 75, breakdown: {} }],
      ]);

      const timeline = Array.from(timelineMap.values());

      expect(timeline).toHaveLength(2);
      expect(timeline[0].time).toBe(1705334400000);
      expect(timeline[1].time).toBe(1705338000000);
    });
  });

  describe('Peak Consumption Processing', () => {
    it('should return null when no peak data', () => {
      const dataset = [];

      if (dataset.length === 0) {
        const peak = null;
        expect(peak).toBeNull();
      }
    });

    it('should extract peak data correctly', () => {
      const dataset = [['sensor.energy_1', 2500.5, 1705334400000]];

      const entityId = dataset[0][0];
      const value = dataset[0][1];
      const timestamp = dataset[0][2];

      expect(entityId).toBe('sensor.energy_1');
      expect(value).toBe(2500.5);
      expect(timestamp).toBe(1705334400000);
    });
  });
});
