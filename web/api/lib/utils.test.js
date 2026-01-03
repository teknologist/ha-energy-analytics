import { describe, it, expect } from 'vitest';
import {
  formatTimestamp,
  isValidEntityId,
  parseTimeRange,
  calculateDuration,
  sanitizeEntity,
} from './utils.js';

describe('API Utils', () => {
  describe('formatTimestamp', () => {
    it('should format a Date object to ISO string', () => {
      const date = new Date('2024-01-01T12:00:00Z');
      const result = formatTimestamp(date);
      expect(result).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should format a timestamp number to ISO string', () => {
      const timestamp = 1704110400000; // 2024-01-01T12:00:00Z
      const result = formatTimestamp(timestamp);
      expect(result).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should format a string timestamp to ISO string', () => {
      const timestamp = '2024-01-01T12:00:00Z';
      const result = formatTimestamp(timestamp);
      expect(result).toBe('2024-01-01T12:00:00.000Z');
    });

    it('should return current timestamp when no argument provided', () => {
      const result = formatTimestamp();
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });

    it('should return current timestamp when null provided', () => {
      const result = formatTimestamp(null);
      expect(result).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    });
  });

  describe('isValidEntityId', () => {
    it('should return true for valid entity ID', () => {
      expect(isValidEntityId('sensor.power_usage')).toBe(true);
      expect(isValidEntityId('light.living_room')).toBe(true);
      expect(isValidEntityId('switch.outlet_1')).toBe(true);
    });

    it('should return false for invalid entity ID format', () => {
      expect(isValidEntityId('invalid')).toBe(false);
      expect(isValidEntityId('SENSOR.power')).toBe(false);
      expect(isValidEntityId('sensor.')).toBe(false);
      expect(isValidEntityId('.power')).toBe(false);
      expect(isValidEntityId('')).toBe(false);
    });

    it('should return false for non-string values', () => {
      expect(isValidEntityId(null)).toBe(false);
      expect(isValidEntityId(undefined)).toBe(false);
      expect(isValidEntityId(123)).toBe(false);
      expect(isValidEntityId({})).toBe(false);
    });
  });

  describe('parseTimeRange', () => {
    it('should parse valid date strings', () => {
      const result = parseTimeRange(
        '2024-01-01T00:00:00Z',
        '2024-01-02T00:00:00Z'
      );
      expect(result.start).toEqual(new Date('2024-01-01T00:00:00Z'));
      expect(result.end).toEqual(new Date('2024-01-02T00:00:00Z'));
    });

    it('should parse Date objects', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-02T00:00:00Z');
      const result = parseTimeRange(start, end);
      expect(result.start).toEqual(start);
      expect(result.end).toEqual(end);
    });

    it('should default to last 24 hours if no start provided', () => {
      const now = Date.now();
      const result = parseTimeRange(null, new Date(now));
      const expectedStart = new Date(now - 24 * 60 * 60 * 1000);

      // Allow 1 second difference for test execution time
      expect(
        Math.abs(result.start.getTime() - expectedStart.getTime())
      ).toBeLessThan(1000);
    });

    it('should default to now if no end provided', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const result = parseTimeRange(start, null);
      const now = new Date();

      // Allow 1 second difference for test execution time
      expect(Math.abs(result.end.getTime() - now.getTime())).toBeLessThan(1000);
    });

    it('should throw error for invalid date format', () => {
      expect(() => parseTimeRange('invalid', '2024-01-02T00:00:00Z')).toThrow(
        'Invalid date format'
      );
      expect(() => parseTimeRange('2024-01-01T00:00:00Z', 'invalid')).toThrow(
        'Invalid date format'
      );
    });

    it('should throw error if start is after end', () => {
      expect(() =>
        parseTimeRange('2024-01-02T00:00:00Z', '2024-01-01T00:00:00Z')
      ).toThrow('Start date must be before end date');
    });

    it('should throw error if start equals end', () => {
      const date = '2024-01-01T00:00:00Z';
      expect(() => parseTimeRange(date, date)).toThrow(
        'Start date must be before end date'
      );
    });
  });

  describe('calculateDuration', () => {
    it('should calculate duration in milliseconds', () => {
      const start = new Date('2024-01-01T00:00:00Z');
      const end = new Date('2024-01-01T01:00:00Z');
      const result = calculateDuration(start, end);
      expect(result).toBe(3600000); // 1 hour in ms
    });

    it('should handle different time units', () => {
      const start = new Date('2024-01-01T00:00:00Z');

      // 1 minute
      let end = new Date('2024-01-01T00:01:00Z');
      expect(calculateDuration(start, end)).toBe(60000);

      // 1 day
      end = new Date('2024-01-02T00:00:00Z');
      expect(calculateDuration(start, end)).toBe(86400000);
    });

    it('should return negative duration if end is before start', () => {
      const start = new Date('2024-01-02T00:00:00Z');
      const end = new Date('2024-01-01T00:00:00Z');
      const result = calculateDuration(start, end);
      expect(result).toBe(-86400000);
    });
  });

  describe('sanitizeEntity', () => {
    it('should sanitize entity with all fields', () => {
      const entity = {
        entity_id: 'sensor.power_usage',
        friendly_name: 'Power Usage',
        device_class: 'power',
        unit_of_measurement: 'W',
        state: '100',
        last_updated: '2024-01-01T12:00:00Z',
        attributes: { icon: 'mdi:power' },
      };

      const result = sanitizeEntity(entity);

      expect(result.entityId).toBe('sensor.power_usage');
      expect(result.friendlyName).toBe('Power Usage');
      expect(result.deviceClass).toBe('power');
      expect(result.unitOfMeasurement).toBe('W');
      expect(result.state).toBe('100');
      expect(result.lastUpdated).toEqual(new Date('2024-01-01T12:00:00Z'));
      expect(result.attributes).toEqual({ icon: 'mdi:power' });
    });

    it('should use entity_id as friendly_name if not provided', () => {
      const entity = {
        entity_id: 'sensor.power',
        state: '50',
      };

      const result = sanitizeEntity(entity);
      expect(result.friendlyName).toBe('sensor.power');
    });

    it('should set null for missing optional fields', () => {
      const entity = {
        entity_id: 'sensor.test',
        state: '0',
      };

      const result = sanitizeEntity(entity);
      expect(result.deviceClass).toBeNull();
      expect(result.unitOfMeasurement).toBeNull();
    });

    it('should set current timestamp if last_updated not provided', () => {
      const entity = {
        entity_id: 'sensor.test',
        state: '0',
      };

      const now = Date.now();
      const result = sanitizeEntity(entity);

      // Allow 1 second difference for test execution time
      expect(Math.abs(result.lastUpdated.getTime() - now)).toBeLessThan(1000);
    });

    it('should set empty object for attributes if not provided', () => {
      const entity = {
        entity_id: 'sensor.test',
        state: '0',
      };

      const result = sanitizeEntity(entity);
      expect(result.attributes).toEqual({});
    });
  });
});
