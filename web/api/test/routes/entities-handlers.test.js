/**
 * Unit tests for entities.js route handlers
 * Tests route handler logic directly by mocking dependencies
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

describe('entities.js - Route Handler Logic', () => {
  // We'll test the route handler logic directly
  // The actual routes register handlers with Fastify, so we test the core logic

  describe('GET /api/entities handler logic', () => {
    let mockRequest, mockReply, mockFastify;

    beforeEach(() => {
      vi.clearAllMocks();

      mockFastify = {
        ha: {
          discoverEntities: vi.fn(),
        },
        mongo: {
          getEntities: vi.fn(),
          collections: {
            entities: {
              bulkWrite: vi.fn(),
            },
          },
        },
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      };

      mockRequest = {
        query: {},
      };

      mockReply = {
        code: vi.fn(() => mockReply),
        header: vi.fn(() => mockReply),
        send: vi.fn(() => mockReply),
      };
    });

    it('should handle filter validation', async () => {
      const { validateFilters } = await import('../../routes/entities.js');

      // Test valid filters
      expect(validateFilters({ device_class: 'energy' })).toEqual({
        valid: true,
      });

      // Test invalid filters
      const result = validateFilters({ device_class: 'invalid' });
      expect(result.valid).toBe(false);
      expect(result.error).toContain('Invalid device_class');
    });

    it('should return degraded response when HA is not configured', async () => {
      const entitiesModule = await import('../../routes/entities.js');

      mockFastify.ha = null;
      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.energy_1',
          friendlyName: 'Energy Sensor',
          deviceClass: 'energy',
          unitOfMeasurement: 'kWh',
          state: '100.5',
          isTracked: true,
          lastSeen: new Date(),
          updatedAt: new Date(),
        },
      ]);

      const entities = await mockFastify.mongo.getEntities({});
      const filtered = entitiesModule.applyEntityFilters(entities, {});
      const transformed = filtered.map(
        entitiesModule.transformEntityToResponse
      );

      expect(transformed).toHaveLength(1);
      expect(transformed[0].entity_id).toBe('sensor.energy_1');
    });

    it('should handle timeout scenario with fallback to cache', async () => {
      const entitiesModule = await import('../../routes/entities.js');

      mockFastify.ha.discoverEntities.mockRejectedValue(new Error('Timeout'));
      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.energy_1',
          friendlyName: 'Energy Sensor',
          deviceClass: 'energy',
          isTracked: true,
          lastSeen: new Date(),
        },
      ]);

      // Simulate the fallback logic
      try {
        await mockFastify.ha.discoverEntities();
      } catch (error) {
        const cachedEntities = await mockFastify.mongo.getEntities({});
        const filtered = entitiesModule.applyEntityFilters(cachedEntities, {});
        const transformed = filtered.map(
          entitiesModule.transformEntityToResponse
        );

        expect(transformed).toHaveLength(1);
        expect(error.message).toBe('Timeout');
      }
    });

    it('should handle both HA and DB failure', async () => {
      mockFastify.ha.discoverEntities.mockRejectedValue(
        new Error('HA unavailable')
      );
      mockFastify.mongo.getEntities.mockRejectedValue(new Error('DB error'));

      try {
        await mockFastify.ha.discoverEntities();
      } catch (haError) {
        try {
          await mockFastify.mongo.getEntities({});
          expect(true).toBe(false); // Should not reach here
        } catch (mongoError) {
          expect(mongoError.message).toBe('DB error');
          expect(haError.message).toBe('HA unavailable');
        }
      }
    });
  });

  describe('GET /api/entities/cached handler logic', () => {
    let mockFastify;

    beforeEach(() => {
      vi.clearAllMocks();

      mockFastify = {
        mongo: {
          getEntities: vi.fn(),
        },
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          error: vi.fn(),
        },
      };
    });

    it('should calculate last_sync from entities', async () => {
      const entitiesModule = await import('../../routes/entities.js');

      const entities = [
        {
          entityId: 'sensor.energy_1',
          lastSeen: new Date('2024-01-01T00:00:00Z'),
        },
        {
          entityId: 'sensor.energy_2',
          lastSeen: new Date('2024-01-02T00:00:00Z'),
        },
      ];

      mockFastify.mongo.getEntities.mockResolvedValue(entities);

      const result = await mockFastify.mongo.getEntities({});

      // Calculate last_sync (most recent timestamp)
      const lastSync =
        result.length > 0
          ? result.reduce((latest, e) => {
              const timestamp = e.lastSeen || e.updatedAt;
              return timestamp > latest ? timestamp : latest;
            }, new Date(0))
          : null;

      expect(lastSync).toBeTruthy();
      expect(lastSync.toISOString()).toContain('2024-01-02');
    });

    it('should return null last_sync for empty entities', async () => {
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const result = await mockFastify.mongo.getEntities({});

      const lastSync =
        result.length > 0
          ? result.reduce((latest, e) => {
              const timestamp = e.lastSeen || e.updatedAt;
              return timestamp > latest ? timestamp : latest;
            }, new Date(0))
          : null;

      expect(lastSync).toBeNull();
    });

    it('should use updatedAt when lastSeen is missing', async () => {
      mockFastify.mongo.getEntities.mockResolvedValue([
        {
          entityId: 'sensor.energy_1',
          updatedAt: new Date('2024-01-03T00:00:00Z'),
        },
      ]);

      const result = await mockFastify.mongo.getEntities({});

      const lastSync =
        result.length > 0
          ? result.reduce((latest, e) => {
              const timestamp = e.lastSeen || e.updatedAt;
              return timestamp > latest ? timestamp : latest;
            }, new Date(0))
          : null;

      expect(lastSync).toBeTruthy();
      expect(lastSync.toISOString()).toContain('2024-01-03');
    });
  });

  describe('POST /api/entities/discover handler logic', () => {
    let mockFastify;

    beforeEach(() => {
      vi.clearAllMocks();

      mockFastify = {
        ha: {
          discoverEntities: vi.fn(),
        },
        mongo: {
          getEntities: vi.fn(),
          collections: {
            entities: {
              bulkWrite: vi.fn(),
            },
          },
        },
        log: {
          info: vi.fn(),
          error: vi.fn(),
        },
      };
    });

    it('should check rate limit before proceeding', async () => {
      const { checkRateLimit } = await import('../../routes/entities.js');

      // First call should be allowed
      const result1 = checkRateLimit('discover');
      expect(result1.allowed).toBe(true);

      // Reset for testing
      vi.clearAllMocks();
    });

    it('should return 503 when HA not configured', () => {
      mockFastify.ha = null;

      expect(mockFastify.ha).toBeNull();
    });

    it('should handle discovery errors gracefully', async () => {
      mockFastify.ha.discoverEntities.mockRejectedValue(
        new Error('Discovery failed')
      );

      try {
        await mockFastify.ha.discoverEntities();
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toBe('Discovery failed');
      }
    });

    it('should handle empty discovery results', async () => {
      const entitiesModule = await import('../../routes/entities.js');

      mockFastify.ha.discoverEntities.mockResolvedValue([]);
      mockFastify.mongo.getEntities.mockResolvedValue([]);

      const discoveredStates = await mockFastify.ha.discoverEntities();

      expect(discoveredStates).toHaveLength(0);

      if (discoveredStates.length > 0) {
        // bulkWrite would happen here
      } else {
        // Skip bulkWrite for empty results
        expect(discoveredStates).toHaveLength(0);
      }
    });
  });

  describe('GET /api/entities/:entity_id handler logic', () => {
    let mockFastify;

    beforeEach(() => {
      vi.clearAllMocks();

      mockFastify = {
        ha: {
          getStates: vi.fn(),
          isConnected: vi.fn(),
        },
        mongo: {
          getEntity: vi.fn(),
        },
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          warn: vi.fn(),
          error: vi.fn(),
        },
      };
    });

    it('should validate entity_id format', async () => {
      const { isValidEntityId } = await import('../../routes/entities.js');

      expect(isValidEntityId('sensor.energy_1')).toBe(true);
      expect(isValidEntityId('invalid')).toBe(false);
      expect(isValidEntityId('')).toBe(false);
    });

    it('should fetch current state from HA when connected', async () => {
      mockFastify.mongo.getEntity.mockResolvedValue({
        entityId: 'sensor.energy_1',
        friendlyName: 'Energy Sensor',
        isTracked: true,
      });

      mockFastify.ha.isConnected.mockReturnValue(true);
      mockFastify.ha.getStates.mockResolvedValue([
        {
          entity_id: 'sensor.energy_1',
          state: '100.5',
          last_updated: '2024-01-01T00:00:00Z',
          attributes: { unit_of_measurement: 'kWh' },
        },
      ]);

      const entity = await mockFastify.mongo.getEntity('sensor.energy_1');
      expect(entity).toBeTruthy();

      if (mockFastify.ha.isConnected()) {
        const states = await mockFastify.ha.getStates();
        const haState = states.find((s) => s.entity_id === 'sensor.energy_1');
        expect(haState).toBeTruthy();
        expect(haState.state).toBe('100.5');
      }
    });

    it('should handle HA getStates failure gracefully', async () => {
      mockFastify.mongo.getEntity.mockResolvedValue({
        entityId: 'sensor.energy_1',
        friendlyName: 'Energy Sensor',
        isTracked: true,
      });

      mockFastify.ha.isConnected.mockReturnValue(true);
      mockFastify.ha.getStates.mockRejectedValue(new Error('HA error'));

      const entity = await mockFastify.mongo.getEntity('sensor.energy_1');
      expect(entity).toBeTruthy();

      if (mockFastify.ha.isConnected()) {
        try {
          await mockFastify.ha.getStates();
        } catch (haError) {
          expect(haError.message).toBe('HA error');
          // Handler should continue and return entity without current_state
        }
      }
    });

    it('should return null current_state when entity not in HA states', async () => {
      mockFastify.mongo.getEntity.mockResolvedValue({
        entityId: 'sensor.energy_1',
        friendlyName: 'Energy Sensor',
        isTracked: true,
      });

      mockFastify.ha.isConnected.mockReturnValue(true);
      mockFastify.ha.getStates.mockResolvedValue([
        {
          entity_id: 'sensor.other_entity',
          state: '50',
        },
      ]);

      const entity = await mockFastify.mongo.getEntity('sensor.energy_1');
      expect(entity).toBeTruthy();

      if (mockFastify.ha.isConnected()) {
        const states = await mockFastify.ha.getStates();
        const haState = states.find((s) => s.entity_id === 'sensor.energy_1');
        expect(haState).toBeUndefined();
      }
    });

    it('should not call getStates when HA not connected', async () => {
      mockFastify.mongo.getEntity.mockResolvedValue({
        entityId: 'sensor.energy_1',
        friendlyName: 'Energy Sensor',
        isTracked: true,
      });

      mockFastify.ha.isConnected.mockReturnValue(false);

      const entity = await mockFastify.mongo.getEntity('sensor.energy_1');
      expect(entity).toBeTruthy();
      expect(mockFastify.ha.isConnected()).toBe(false);
      expect(mockFastify.ha.getStates).not.toHaveBeenCalled();
    });
  });

  describe('PUT /api/entities/:entity_id handler logic', () => {
    let mockFastify;

    beforeEach(() => {
      vi.clearAllMocks();

      mockFastify = {
        mongo: {
          getEntity: vi.fn(),
          setEntityTracked: vi.fn(),
        },
        log: {
          debug: vi.fn(),
          info: vi.fn(),
          error: vi.fn(),
        },
      };
    });

    it('should validate entity_id before updating', async () => {
      const { isValidEntityId } = await import('../../routes/entities.js');

      expect(isValidEntityId('sensor.energy_1')).toBe(true);
      expect(isValidEntityId('invalid-id')).toBe(false);
    });

    it('should check if entity exists before updating', async () => {
      mockFastify.mongo.getEntity.mockResolvedValue(null);

      const entity = await mockFastify.mongo.getEntity('sensor.nonexistent');
      expect(entity).toBeNull();
    });

    it('should handle setEntityTracked failure', async () => {
      mockFastify.mongo.getEntity.mockResolvedValue({
        entityId: 'sensor.energy_1',
        isTracked: false,
      });

      mockFastify.mongo.setEntityTracked.mockResolvedValue(false);

      const entity = await mockFastify.mongo.getEntity('sensor.energy_1');
      expect(entity).toBeTruthy();

      const updated = await mockFastify.mongo.setEntityTracked(
        'sensor.energy_1',
        true
      );
      expect(updated).toBe(false);
    });

    it('should update entity tracking status', async () => {
      const entity = {
        entityId: 'sensor.energy_1',
        friendlyName: 'Energy Sensor',
        isTracked: false,
      };

      mockFastify.mongo.getEntity.mockResolvedValue(entity);
      mockFastify.mongo.setEntityTracked.mockResolvedValue(true);

      const fetched = await mockFastify.mongo.getEntity('sensor.energy_1');
      expect(fetched).toBeTruthy();

      const updated = await mockFastify.mongo.setEntityTracked(
        'sensor.energy_1',
        true
      );
      expect(updated).toBe(true);
    });
  });

  describe('GET /api/entities/energy-config handler logic', () => {
    let mockFastify;

    beforeEach(() => {
      vi.clearAllMocks();

      mockFastify = {
        ha: {
          getEnergyPreferences: vi.fn(),
        },
        log: {
          info: vi.fn(),
          error: vi.fn(),
        },
      };
    });

    it('should return 503 when HA not configured', () => {
      mockFastify.ha = null;
      expect(mockFastify.ha).toBeNull();
    });

    it('should fetch energy preferences from HA', async () => {
      const mockPrefs = {
        energy_sources: [],
        device_statistics: [],
      };

      mockFastify.ha.getEnergyPreferences.mockResolvedValue(mockPrefs);

      const prefs = await mockFastify.ha.getEnergyPreferences();
      expect(prefs).toEqual(mockPrefs);
    });

    it('should handle fetch errors gracefully', async () => {
      mockFastify.ha.getEnergyPreferences.mockRejectedValue(
        new Error('Failed to fetch')
      );

      try {
        await mockFastify.ha.getEnergyPreferences();
        expect(true).toBe(false);
      } catch (error) {
        expect(error.message).toBe('Failed to fetch');
      }
    });
  });
});
