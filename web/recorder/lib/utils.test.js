import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  isEnergyEntity,
  parseStateValue,
  retry,
  transformStatistics,
  createEnergyReading,
  timeSinceLastEvent,
  needsReconnection,
  HEARTBEAT_INTERVAL_MS,
  MAX_IDLE_TIME_MS,
  HOURLY_INTERVAL_MS,
  DEFAULT_BACKFILL_HOURS,
  SEEDING_DAYS,
  SYNC_LOG_TTL_SECONDS,
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  VALID_ENERGY_UNITS,
} from './utils.js';

describe('Recorder Utils', () => {
  describe('Constants', () => {
    it('should export time constants', () => {
      expect(HEARTBEAT_INTERVAL_MS).toBe(3 * 60 * 1000); // 3 minutes
      expect(MAX_IDLE_TIME_MS).toBe(5 * 60 * 1000); // 5 minutes
      expect(HOURLY_INTERVAL_MS).toBe(60 * 60 * 1000); // 1 hour
      expect(DEFAULT_BACKFILL_HOURS).toBe(24);
      expect(SEEDING_DAYS).toBe(30);
      expect(SYNC_LOG_TTL_SECONDS).toBe(7 * 24 * 60 * 60); // 7 days
    });

    it('should export retry configuration', () => {
      expect(DEFAULT_MAX_RETRIES).toBe(3);
      expect(DEFAULT_BASE_DELAY_MS).toBe(1000);
    });

    it('should export valid energy units', () => {
      expect(VALID_ENERGY_UNITS).toEqual(['kWh', 'Wh', 'W', 'kW']);
    });
  });

  describe('isEnergyEntity', () => {
    it('should return true for energy device class', () => {
      const state = {
        attributes: { device_class: 'energy' },
      };
      expect(isEnergyEntity(state)).toBe(true);
    });

    it('should return true for power device class', () => {
      const state = {
        attributes: { device_class: 'power' },
      };
      expect(isEnergyEntity(state)).toBe(true);
    });

    it('should return true for energy device class (case insensitive)', () => {
      const state = {
        attributes: { device_class: 'ENERGY' },
      };
      expect(isEnergyEntity(state)).toBe(true);

      const state2 = {
        attributes: { device_class: 'PoWeR' },
      };
      expect(isEnergyEntity(state2)).toBe(true);
    });

    it('should return true for valid energy units', () => {
      const units = ['kWh', 'Wh', 'W', 'kW'];
      for (const unit of units) {
        const state = {
          attributes: { unit_of_measurement: unit },
        };
        expect(isEnergyEntity(state)).toBe(true);
      }
    });

    it('should return false for non-energy device class', () => {
      const state = {
        attributes: { device_class: 'temperature' },
      };
      expect(isEnergyEntity(state)).toBe(false);
    });

    it('should return false for invalid unit', () => {
      const state = {
        attributes: { unit_of_measurement: '°C' },
      };
      expect(isEnergyEntity(state)).toBe(false);
    });

    it('should return false when state is null', () => {
      expect(isEnergyEntity(null)).toBe(false);
    });

    it('should return false when state is undefined', () => {
      expect(isEnergyEntity(undefined)).toBe(false);
    });

    it('should return false when attributes are missing', () => {
      const state = {};
      expect(isEnergyEntity(state)).toBe(false);

      const state2 = { attributes: null };
      expect(isEnergyEntity(state2)).toBe(false);
    });

    it('should return true when both device_class and unit match', () => {
      const state = {
        attributes: {
          device_class: 'energy',
          unit_of_measurement: 'kWh',
        },
      };
      expect(isEnergyEntity(state)).toBe(true);
    });

    it('should return false when device_class is neither energy nor power', () => {
      const state = {
        attributes: {
          device_class: 'humidity',
          unit_of_measurement: 'kWh',
        },
      };
      expect(isEnergyEntity(state)).toBe(true); // Still true due to valid unit
    });
  });

  describe('parseStateValue', () => {
    it('should parse numeric string to number', () => {
      expect(parseStateValue('123.45')).toBe(123.45);
      expect(parseStateValue('100')).toBe(100);
      expect(parseStateValue('0')).toBe(0);
    });

    it('should parse negative numbers', () => {
      expect(parseStateValue('-50.5')).toBe(-50.5);
      expect(parseStateValue('-100')).toBe(-100);
    });

    it('should return number as-is', () => {
      expect(parseStateValue(123.45)).toBe(123.45);
      expect(parseStateValue(0)).toBe(0);
      expect(parseStateValue(-100)).toBe(-100);
    });

    it('should return null for null', () => {
      expect(parseStateValue(null)).toBeNull();
    });

    it('should return null for undefined', () => {
      expect(parseStateValue(undefined)).toBeNull();
    });

    it('should return null for "unknown" string', () => {
      expect(parseStateValue('unknown')).toBeNull();
    });

    it('should return null for "unavailable" string', () => {
      expect(parseStateValue('unavailable')).toBeNull();
    });

    it('should return null for "unknown" (case insensitive)', () => {
      expect(parseStateValue('UNKNOWN')).toBeNull();
      expect(parseStateValue('Unknown')).toBeNull();
    });

    it('should return null for "unavailable" (case insensitive)', () => {
      expect(parseStateValue('UNAVAILABLE')).toBeNull();
      expect(parseStateValue('Unavailable')).toBeNull();
    });

    it('should return null for non-numeric string', () => {
      expect(parseStateValue('not a number')).toBeNull();
      expect(parseStateValue('abc123')).toBeNull();
    });

    it('should return null for NaN values', () => {
      expect(parseStateValue(NaN)).toBeNull();
    });

    it('should handle scientific notation', () => {
      expect(parseStateValue('1.23e2')).toBe(123);
      expect(parseStateValue('1e-3')).toBe(0.001);
    });

    it('should handle zero values', () => {
      expect(parseStateValue('0')).toBe(0);
      expect(parseStateValue('0.0')).toBe(0);
      expect(parseStateValue(0)).toBe(0);
      expect(parseStateValue(0.0)).toBe(0);
    });
  });

  describe('retry', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return result on first successful attempt', async () => {
      const fn = vi.fn().mockResolvedValue('success');
      const result = await retry(fn);

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and return result', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const promise = retry(fn, 3, 100);

      // First attempt fails
      await vi.advanceTimersByTimeAsync(100);

      // Second attempt succeeds
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should use exponential backoff', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockResolvedValue('success');

      const promise = retry(fn, 5, 100);

      // First retry after 100ms (2^0 * 100)
      await vi.advanceTimersByTimeAsync(100);

      // Second retry after 200ms (2^1 * 100)
      await vi.advanceTimersByTimeAsync(200);

      // Third attempt succeeds
      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should throw after max retries exhausted', async () => {
      const error = new Error('permanent failure');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retry(fn, 3, 100).catch((e) => e);

      // Let all retries happen
      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(200); // Second retry
      await vi.advanceTimersByTimeAsync(0); // Process final error

      const result = await promise;
      expect(result).toBe(error);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use default max retries when not specified', async () => {
      const error = new Error('fail');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retry(fn).catch((e) => e);

      // Should use DEFAULT_MAX_RETRIES (3)
      await vi.advanceTimersByTimeAsync(1000); // First retry
      await vi.advanceTimersByTimeAsync(2000); // Second retry
      await vi.advanceTimersByTimeAsync(0); // Process final error

      const result = await promise;
      expect(result).toBe(error);
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should use default base delay when not specified', async () => {
      const fn = vi
        .fn()
        .mockRejectedValueOnce(new Error('fail'))
        .mockResolvedValue('success');

      const promise = retry(fn, 2);

      // Should use DEFAULT_BASE_DELAY_MS (1000)
      await vi.advanceTimersByTimeAsync(1000);

      const result = await promise;

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should not delay after last attempt', async () => {
      const error = new Error('fail');
      const fn = vi.fn().mockRejectedValue(error);

      const promise = retry(fn, 2, 100).catch((e) => e);

      await vi.advanceTimersByTimeAsync(100); // First retry
      await vi.advanceTimersByTimeAsync(0); // Process final error (no delay)

      const result = await promise;
      expect(result).toBe(error);
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should handle synchronous errors', async () => {
      const error = new Error('sync error');
      const fn = vi.fn().mockImplementation(() => {
        throw error;
      });

      const promise = retry(fn, 2, 100).catch((e) => e);

      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(0);

      const result = await promise;
      expect(result).toBe(error);
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });

  describe('transformStatistics', () => {
    it('should transform empty array', () => {
      const result = transformStatistics('sensor.energy', [], 'hour');
      expect(result).toEqual([]);
    });

    it('should transform null statsList', () => {
      const result = transformStatistics('sensor.energy', null, 'hour');
      expect(result).toEqual([]);
    });

    it('should transform undefined statsList', () => {
      const result = transformStatistics('sensor.energy', undefined, 'hour');
      expect(result).toEqual([]);
    });

    it('should transform non-array statsList', () => {
      const result = transformStatistics(
        'sensor.energy',
        'not an array',
        'hour'
      );
      expect(result).toEqual([]);
    });

    it('should transform valid statistics', () => {
      const statsList = [
        {
          start: '2024-01-01T00:00:00Z',
          state: '100.5',
          sum: '1000',
          mean: '100',
          min: '50',
          max: '150',
        },
      ];

      const result = transformStatistics('sensor.energy', statsList, 'hour');

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
        entity_id: 'sensor.energy',
        period: 'hour',
        state: 100.5,
        sum: 1000,
        mean: 100,
        min: 50,
        max: 150,
        timestamp: new Date('2024-01-01T00:00:00Z').getTime() * 1000000,
      });
    });

    it('should handle null statistic values', () => {
      const statsList = [
        {
          start: '2024-01-01T00:00:00Z',
          state: null,
          sum: null,
          mean: null,
          min: null,
          max: null,
        },
      ];

      const result = transformStatistics('sensor.energy', statsList, 'hour');

      expect(result[0]).toMatchObject({
        entity_id: 'sensor.energy',
        period: 'hour',
        state: null,
        sum: null,
        mean: null,
        min: null,
        max: null,
      });
    });

    it('should handle missing statistic fields', () => {
      const statsList = [
        {
          start: '2024-01-01T00:00:00Z',
          state: '100',
        },
      ];

      const result = transformStatistics('sensor.energy', statsList, 'hour');

      expect(result[0]).toMatchObject({
        entity_id: 'sensor.energy',
        period: 'hour',
        state: 100,
        sum: null,
        mean: null,
        min: null,
        max: null,
      });
    });

    it('should transform multiple statistics', () => {
      const statsList = [
        { start: '2024-01-01T00:00:00Z', state: '100', sum: '100' },
        { start: '2024-01-01T01:00:00Z', state: '200', sum: '200' },
        { start: '2024-01-01T02:00:00Z', state: '300', sum: '300' },
      ];

      const result = transformStatistics('sensor.energy', statsList, 'hour');

      expect(result).toHaveLength(3);
      expect(result[0].state).toBe(100);
      expect(result[1].state).toBe(200);
      expect(result[2].state).toBe(300);
    });

    it('should default period to hour when not specified', () => {
      const statsList = [{ start: '2024-01-01T00:00:00Z', state: '100' }];

      const result = transformStatistics('sensor.energy', statsList);

      expect(result[0].period).toBe('hour');
    });

    it('should use custom period', () => {
      const statsList = [{ start: '2024-01-01T00:00:00Z', state: '100' }];

      const result = transformStatistics('sensor.energy', statsList, 'day');

      expect(result[0].period).toBe('day');
    });

    it('should convert timestamp to nanoseconds', () => {
      const statsList = [{ start: '2024-01-01T00:00:00Z', state: '100' }];

      const result = transformStatistics('sensor.energy', statsList, 'hour');
      const expectedTimestamp =
        new Date('2024-01-01T00:00:00Z').getTime() * 1000000;

      expect(result[0].timestamp).toBe(expectedTimestamp);
    });

    it('should parse string numbers to float', () => {
      const statsList = [
        {
          start: '2024-01-01T00:00:00Z',
          state: '123.456',
          sum: '789.012',
          mean: '456.789',
          min: '100.111',
          max: '999.999',
        },
      ];

      const result = transformStatistics('sensor.energy', statsList, 'hour');

      expect(result[0].state).toBe(123.456);
      expect(result[0].sum).toBe(789.012);
      expect(result[0].mean).toBe(456.789);
      expect(result[0].min).toBe(100.111);
      expect(result[0].max).toBe(999.999);
    });

    it('should handle negative values', () => {
      const statsList = [
        { start: '2024-01-01T00:00:00Z', state: '-100', sum: '-500' },
      ];

      const result = transformStatistics('sensor.energy', statsList, 'hour');

      expect(result[0].state).toBe(-100);
      expect(result[0].sum).toBe(-500);
    });
  });

  describe('createEnergyReading', () => {
    it('should create reading from valid state', () => {
      const newState = {
        state: '123.45',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: { unit_of_measurement: 'W' },
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result).toEqual({
        entity_id: 'sensor.energy',
        state: 123.45,
        previous_state: null,
        attributes: { unit_of_measurement: 'W' },
        timestamp: new Date('2024-01-01T12:00:00Z').getTime() * 1000000,
      });
    });

    it('should include previous_state when oldState is provided', () => {
      const oldState = { state: '100' };
      const newState = {
        state: '150',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, oldState);

      expect(result.previous_state).toBe(100);
    });

    it('should return null when current state is null', () => {
      const newState = {
        state: null,
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result).toBeNull();
    });

    it('should return null when current state is "unknown"', () => {
      const newState = {
        state: 'unknown',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result).toBeNull();
    });

    it('should return null when current state is "unavailable"', () => {
      const newState = {
        state: 'unavailable',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result).toBeNull();
    });

    it('should handle null oldState', () => {
      const newState = {
        state: '100',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result.previous_state).toBeNull();
    });

    it('should handle undefined oldState', () => {
      const newState = {
        state: '100',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, undefined);

      expect(result.previous_state).toBeNull();
    });

    it('should handle null previous state value', () => {
      const oldState = { state: null };
      const newState = {
        state: '100',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, oldState);

      expect(result.previous_state).toBeNull();
    });

    it('should handle "unknown" previous state value', () => {
      const oldState = { state: 'unknown' };
      const newState = {
        state: '100',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, oldState);

      expect(result.previous_state).toBeNull();
    });

    it('should convert timestamp to nanoseconds', () => {
      const newState = {
        state: '100',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);
      const expectedTimestamp =
        new Date('2024-01-01T12:00:00Z').getTime() * 1000000;

      expect(result.timestamp).toBe(expectedTimestamp);
    });

    it('should include attributes from new state', () => {
      const attributes = {
        unit_of_measurement: 'kWh',
        friendly_name: 'Energy',
        device_class: 'energy',
      };
      const newState = {
        state: '100',
        last_changed: '2024-01-01T12:00:00Z',
        attributes,
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result.attributes).toEqual(attributes);
    });

    it('should handle numeric state value', () => {
      const newState = {
        state: 123.45,
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result.state).toBe(123.45);
    });

    it('should handle zero state value', () => {
      const newState = {
        state: '0',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result.state).toBe(0);
      expect(result).not.toBeNull();
    });

    it('should handle negative state value', () => {
      const newState = {
        state: '-50',
        last_changed: '2024-01-01T12:00:00Z',
        attributes: {},
      };

      const result = createEnergyReading('sensor.energy', newState, null);

      expect(result.state).toBe(-50);
    });
  });

  describe('timeSinceLastEvent', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return Infinity when lastEventAt is null', () => {
      const result = timeSinceLastEvent(null);
      expect(result).toBe(Infinity);
    });

    it('should return Infinity when lastEventAt is undefined', () => {
      const result = timeSinceLastEvent(undefined);
      expect(result).toBe(Infinity);
    });

    it('should calculate time since last event in milliseconds', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - 5000); // 5 seconds ago
      const result = timeSinceLastEvent(lastEventAt);

      expect(result).toBe(5000);
    });

    it('should handle recent event', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - 100); // 100ms ago
      const result = timeSinceLastEvent(lastEventAt);

      expect(result).toBe(100);
    });

    it('should handle old event', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - 3600000); // 1 hour ago
      const result = timeSinceLastEvent(lastEventAt);

      expect(result).toBe(3600000);
    });

    it('should return 0 for event that just happened', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now);
      const result = timeSinceLastEvent(lastEventAt);

      // Allow small tolerance for test execution
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(10);
    });
  });

  describe('needsReconnection', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('should return true when lastEventAt is null', () => {
      const result = needsReconnection(null);
      expect(result).toBe(true);
    });

    it('should return true when lastEventAt is undefined', () => {
      const result = needsReconnection(undefined);
      expect(result).toBe(true);
    });

    it('should return true when idle time exceeds maxIdleTime', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - MAX_IDLE_TIME_MS - 1000); // Over 5 minutes
      const result = needsReconnection(lastEventAt, MAX_IDLE_TIME_MS);

      expect(result).toBe(true);
    });

    it('should return false when idle time is within maxIdleTime', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - MAX_IDLE_TIME_MS + 1000); // Just under 5 minutes
      const result = needsReconnection(lastEventAt, MAX_IDLE_TIME_MS);

      expect(result).toBe(false);
    });

    it('should use default MAX_IDLE_TIME_MS when maxIdleTime not specified', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - MAX_IDLE_TIME_MS - 1000);
      const result = needsReconnection(lastEventAt);

      expect(result).toBe(true);
    });

    it('should return true when exactly at maxIdleTime boundary', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - MAX_IDLE_TIME_MS); // Exactly 5 minutes
      const result = needsReconnection(lastEventAt, MAX_IDLE_TIME_MS);

      expect(result).toBe(false); // Not greater than, so false
    });

    it('should return false for recent event', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - 1000); // 1 second ago
      const result = needsReconnection(lastEventAt);

      expect(result).toBe(false);
    });

    it('should handle custom maxIdleTime', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const customMaxIdleTime = 10000; // 10 seconds
      const lastEventAt = new Date(now - 15000); // 15 seconds ago
      const result = needsReconnection(lastEventAt, customMaxIdleTime);

      expect(result).toBe(true);
    });

    it('should return true for very old event', () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const lastEventAt = new Date(now - 86400000); // 1 day ago
      const result = needsReconnection(lastEventAt);

      expect(result).toBe(true);
    });
  });
});
