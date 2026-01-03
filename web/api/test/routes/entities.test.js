/**
 * Unit tests for entities.js route helper functions
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  isValidEntityId,
  validateFilters,
  checkRateLimit,
  applyEntityFilters,
  transformEntityToResponse,
  transformHAStateToResponse,
} from '../../routes/entities.js';

describe('entities.js - Helper Functions', () => {
  describe('isValidEntityId()', () => {
    it('should accept valid entity IDs', () => {
      expect(isValidEntityId('sensor.energy_consumption')).toBe(true);
      expect(isValidEntityId('switch.smart_plug_1')).toBe(true);
      expect(isValidEntityId('light.kitchen_lights')).toBe(true);
      expect(isValidEntityId('binary_sensor.front_door')).toBe(true);
      expect(isValidEntityId('abc.xy')).toBe(true); // Minimum length 3
    });

    it('should reject invalid entity IDs', () => {
      expect(isValidEntityId('')).toBe(false);
      expect(isValidEntityId('ab')).toBe(false); // Too short
      expect(isValidEntityId('a'.repeat(101))).toBe(false); // Too long
      expect(isValidEntityId('invalid-no-dot')).toBe(false);
      expect(isValidEntityId('.starts_with_dot')).toBe(false);
      expect(isValidEntityId('ends_with_dot.')).toBe(false);
      expect(isValidEntityId('invalid@symbol.test')).toBe(false);
      expect(isValidEntityId('spaces in.name')).toBe(false);
      expect(isValidEntityId('123.invalid')).toBe(false); // Domain can't start with number
    });

    it('should handle edge cases', () => {
      expect(isValidEntityId(null)).toBe(false);
      expect(isValidEntityId(undefined)).toBe(false);
      expect(isValidEntityId(123)).toBe(false);
      expect(isValidEntityId({})).toBe(false);
      expect(isValidEntityId([])).toBe(false);
    });
  });

  describe('validateFilters()', () => {
    it('should accept valid device_class filters', () => {
      expect(validateFilters({ device_class: 'energy' })).toEqual({
        valid: true,
      });
      expect(validateFilters({ device_class: 'power' })).toEqual({
        valid: true,
      });
      expect(validateFilters({ device_class: 'battery' })).toEqual({
        valid: true,
      });
    });

    it('should reject invalid device_class filters', () => {
      const result = validateFilters({ device_class: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid device_class');
      expect(result.error).toContain('energy, power, battery');
    });

    it('should accept valid unit filters', () => {
      expect(validateFilters({ unit: 'kWh' })).toEqual({ valid: true });
      expect(validateFilters({ unit: 'Wh' })).toEqual({ valid: true });
      expect(validateFilters({ unit: 'W' })).toEqual({ valid: true });
      expect(validateFilters({ unit: 'kW' })).toEqual({ valid: true });
    });

    it('should reject invalid unit filters', () => {
      const result = validateFilters({ unit: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid unit');
      expect(result.error).toContain('kWh, Wh, W, kW');
    });

    it('should accept tracked filter with any value', () => {
      expect(validateFilters({ tracked: true })).toEqual({ valid: true });
      expect(validateFilters({ tracked: false })).toEqual({ valid: true });
      expect(validateFilters({ tracked: 'true' })).toEqual({ valid: true });
      expect(validateFilters({ tracked: 'false' })).toEqual({ valid: true });
    });

    it('should accept empty filters', () => {
      expect(validateFilters({})).toEqual({ valid: true });
    });

    it('should accept multiple valid filters', () => {
      expect(
        validateFilters({ device_class: 'energy', unit: 'kWh', tracked: true })
      ).toEqual({ valid: true });
    });

    it('should reject when multiple filters include invalid one', () => {
      const result = validateFilters({
        device_class: 'energy',
        unit: 'invalid',
        tracked: true,
      });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid unit');
    });
  });

  describe('checkRateLimit()', () => {
    it('should allow operation on first call', () => {
      const result = checkRateLimit('discover');
      expect(result.allowed).toBe(true);
      expect(result.retryAfterMs).toBeUndefined();
    });

    it('should allow unknown operations', () => {
      const result = checkRateLimit('unknown_operation');
      expect(result.allowed).toBe(true);
    });
  });

  describe('applyEntityFilters()', () => {
    const mockEntities = [
      {
        entity_id: 'sensor.energy_1',
        deviceClass: 'energy',
        unitOfMeasurement: 'kWh',
        isTracked: true,
      },
      {
        entity_id: 'sensor.power_1',
        deviceClass: 'power',
        unitOfMeasurement: 'W',
        isTracked: false,
      },
      {
        entity_id: 'sensor.battery_1',
        deviceClass: 'battery',
        unitOfMeasurement: '%',
        isTracked: true,
      },
    ];

    it('should filter by device_class (camelCase)', () => {
      const filtered = applyEntityFilters(mockEntities, {
        device_class: 'energy',
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].entity_id).toBe('sensor.energy_1');
    });

    it('should filter by device_class (snake_case)', () => {
      const entities = [
        { device_class: 'energy', entity_id: 'test' },
        { device_class: 'power', entity_id: 'test2' },
      ];
      const filtered = applyEntityFilters(entities, { device_class: 'energy' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].device_class).toBe('energy');
    });

    it('should filter by unit (camelCase)', () => {
      const filtered = applyEntityFilters(mockEntities, { unit: 'kWh' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].entity_id).toBe('sensor.energy_1');
    });

    it('should filter by unit (snake_case)', () => {
      const entities = [
        { unit_of_measurement: 'kWh', entity_id: 'test' },
        { unit_of_measurement: 'W', entity_id: 'test2' },
      ];
      const filtered = applyEntityFilters(entities, { unit: 'kWh' });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].unit_of_measurement).toBe('kWh');
    });

    it('should filter by tracked=true', () => {
      const filtered = applyEntityFilters(mockEntities, { tracked: true });
      expect(filtered).toHaveLength(2);
      expect(filtered.every((e) => e.isTracked === true)).toBe(true);
    });

    it('should filter by tracked=false', () => {
      const filtered = applyEntityFilters(mockEntities, { tracked: false });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].entity_id).toBe('sensor.power_1');
    });

    it('should filter by tracked as string "true"', () => {
      const filtered = applyEntityFilters(mockEntities, { tracked: 'true' });
      expect(filtered).toHaveLength(2);
    });

    it('should filter by tracked as string "false"', () => {
      const filtered = applyEntityFilters(mockEntities, { tracked: 'false' });
      expect(filtered).toHaveLength(1);
    });

    it('should apply multiple filters', () => {
      const filtered = applyEntityFilters(mockEntities, {
        device_class: 'energy',
        tracked: true,
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].entity_id).toBe('sensor.energy_1');
    });

    it('should return all entities when no filters applied', () => {
      const filtered = applyEntityFilters(mockEntities, {});
      expect(filtered).toHaveLength(3);
    });

    it('should handle empty entity list', () => {
      const filtered = applyEntityFilters([], { device_class: 'energy' });
      expect(filtered).toHaveLength(0);
    });
  });

  describe('transformEntityToResponse()', () => {
    it('should transform MongoDB entity to API response format', () => {
      const mongoEntity = {
        entityId: 'sensor.energy_1',
        friendlyName: 'Energy Sensor',
        deviceClass: 'energy',
        unitOfMeasurement: 'kWh',
        state: '123.45',
        isTracked: true,
        lastSeen: new Date('2024-01-01T00:00:00Z'),
        updatedAt: new Date('2024-01-01T01:00:00Z'),
      };

      const result = transformEntityToResponse(mongoEntity);

      expect(result).toEqual({
        entity_id: 'sensor.energy_1',
        friendly_name: 'Energy Sensor',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state: '123.45',
        is_tracked: true,
        last_seen: '2024-01-01T00:00:00.000Z',
        updated_at: '2024-01-01T01:00:00.000Z',
      });
    });

    it('should handle missing optional fields', () => {
      const mongoEntity = {
        entityId: 'sensor.energy_1',
      };

      const result = transformEntityToResponse(mongoEntity);

      expect(result.entity_id).toBe('sensor.energy_1');
      expect(result.friendly_name).toBe('sensor.energy_1'); // Falls back to entityId
      expect(result.device_class).toBeNull();
      expect(result.unit_of_measurement).toBeNull();
      expect(result.state).toBeNull();
      expect(result.is_tracked).toBe(false); // Default
      expect(result.last_seen).toBeNull();
      expect(result.updated_at).toBeNull();
    });

    it('should convert dates to ISO strings', () => {
      const mongoEntity = {
        entityId: 'sensor.energy_1',
        lastSeen: new Date('2024-01-15T12:30:45.123Z'),
        updatedAt: new Date('2024-01-15T13:30:45.456Z'),
      };

      const result = transformEntityToResponse(mongoEntity);

      expect(result.last_seen).toBe('2024-01-15T12:30:45.123Z');
      expect(result.updated_at).toBe('2024-01-15T13:30:45.456Z');
    });

    it('should handle missing friendlyName', () => {
      const mongoEntity = {
        entityId: 'sensor.test_entity',
        deviceClass: 'energy',
      };

      const result = transformEntityToResponse(mongoEntity);

      expect(result.friendly_name).toBe('sensor.test_entity');
      expect(result.device_class).toBe('energy');
    });
  });

  describe('transformHAStateToResponse()', () => {
    it('should transform HA state to API response format', () => {
      const haState = {
        entity_id: 'sensor.energy_1',
        state: '100.5',
        attributes: {
          friendly_name: 'Energy Sensor',
          device_class: 'energy',
          unit_of_measurement: 'kWh',
        },
        last_updated: '2024-01-01T00:00:00Z',
      };

      const result = transformHAStateToResponse(haState);

      expect(result).toEqual({
        entity_id: 'sensor.energy_1',
        friendly_name: 'Energy Sensor',
        device_class: 'energy',
        unit_of_measurement: 'kWh',
        state: '100.5',
        is_tracked: false,
        last_updated: '2024-01-01T00:00:00Z',
      });
    });

    it('should handle missing attributes', () => {
      const haState = {
        entity_id: 'sensor.energy_1',
        state: '50',
      };

      const result = transformHAStateToResponse(haState);

      expect(result.entity_id).toBe('sensor.energy_1');
      expect(result.friendly_name).toBe('sensor.energy_1'); // Falls back to entity_id
      expect(result.device_class).toBeNull();
      expect(result.unit_of_measurement).toBeNull();
      expect(result.state).toBe('50');
      expect(result.is_tracked).toBe(false);
      expect(result.last_updated).toBeNull();
    });

    it('should handle missing optional attribute fields', () => {
      const haState = {
        entity_id: 'sensor.test',
        attributes: {
          friendly_name: 'Test Sensor',
        },
      };

      const result = transformHAStateToResponse(haState);

      expect(result.friendly_name).toBe('Test Sensor');
      expect(result.device_class).toBeNull();
      expect(result.unit_of_measurement).toBeNull();
    });

    it('should handle null state', () => {
      const haState = {
        entity_id: 'sensor.test',
        state: null,
        attributes: {},
      };

      const result = transformHAStateToResponse(haState);

      expect(result.state).toBeNull();
    });

    it('should always set is_tracked to false for live entities', () => {
      const haState = {
        entity_id: 'sensor.test',
        attributes: {},
      };

      const result = transformHAStateToResponse(haState);

      expect(result.is_tracked).toBe(false);
    });
  });
});
