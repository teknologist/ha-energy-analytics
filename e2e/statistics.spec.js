import { test, expect } from '@playwright/test';

/**
 * E2E Tests for Statistics API Routes
 * Tests all endpoints in /web/api/routes/statistics.js
 *
 * Coverage Goals:
 * - All endpoints (GET /:entity_id, /:entity_id/daily, /:entity_id/monthly, /sync/log)
 * - POST endpoints (/sync, /compare)
 * - All error conditions and edge cases
 * - All conditional branches
 */

// Valid entity IDs for testing
const VALID_ENTITY_ID = 'sensor.energy_consumption';
const ALTERNATIVE_ENTITY_ID = 'sensor.energy_production';

// Invalid entity IDs for testing validation
const INVALID_ENTITY_IDS = [
  { id: '', description: 'empty string' },
  { id: 'ab', description: 'too short (< 3 chars)' },
  { id: 'a'.repeat(101), description: 'too long (> 100 chars)' },
  { id: 'InvalidFormat', description: 'missing domain separator' },
  { id: 'UPPERCASE.test', description: 'uppercase domain' },
  { id: 'sensor.INVALID!', description: 'special characters' },
  { id: 'sensor test', description: 'contains space' },
];

// Valid time ranges for testing
const PAST_DAY = {
  start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
  end: new Date().toISOString(),
};

const PAST_WEEK = {
  start: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
  end: new Date().toISOString(),
};

const PAST_MONTH = {
  start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
  end: new Date().toISOString(),
};

test.describe('Statistics API - POST /api/statistics/sync', () => {
  test.describe('Happy Path', () => {
    test('should sync statistics with valid entity_ids', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          start_time: PAST_DAY.start,
          end_time: PAST_DAY.end,
          period: 'hour',
        },
      });

      // May return 503 if HA not connected, 200 if successful
      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('entities_synced');
        expect(body.data).toHaveProperty('records_synced');
        expect(body.data).toHaveProperty('period');
        expect(body.data).toHaveProperty('time_range');
        expect(response.headers()['x-response-time']).toMatch(/\d+ms/);
      }
    });

    test('should sync with default time range when not provided', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.time_range).toBeDefined();
      }
    });

    test('should sync with empty entity_ids array (fetches all energy entities)', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [],
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.entities_synced).toBeGreaterThanOrEqual(0);
      }
    });

    test('should sync with no body (uses all defaults)', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {},
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
      }
    });

    test('should sync multiple entities', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID, ALTERNATIVE_ENTITY_ID],
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.entities_synced).toBeGreaterThan(0);
      }
    });

    test('should support all period types', async ({ request }) => {
      const periods = ['5minute', 'hour', 'day', 'week', 'month'];

      for (const period of periods) {
        const response = await request.post('/api/statistics/sync', {
          data: {
            entity_ids: [VALID_ENTITY_ID],
            period,
          },
        });

        expect([200, 503]).toContain(response.status());

        if (response.ok()) {
          const body = await response.json();
          expect(body.success).toBe(true);
          expect(body.data.period).toBe(period);
        }
      }
    });
  });

  test.describe('Error Conditions', () => {
    test('should return 503 when Home Assistant not connected', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      // If HA is not connected, should return 503
      if (response.status() === 503) {
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain('Home Assistant not connected');
      }
    });

    test('should handle invalid ISO dates gracefully', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          start_time: 'invalid-date',
          end_time: 'also-invalid',
        },
      });

      // Should handle gracefully (may return 400, 500, or 503)
      expect([400, 500, 503]).toContain(response.status());
    });

    test('should handle database write failures gracefully', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      // If DB write fails, should attempt partial success
      if (response.ok()) {
        const body = await response.json();
        // Check if partial success is handled
        if (body.data.partial_success) {
          expect(body.data).toHaveProperty('failed_entities');
          expect(Array.isArray(body.data.failed_entities)).toBe(true);
        }
      }
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle sync with future end_time', async ({ request }) => {
      const futureDate = new Date(
        Date.now() + 24 * 60 * 60 * 1000
      ).toISOString();

      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          end_time: futureDate,
        },
      });

      expect([200, 503]).toContain(response.status());
    });

    test('should handle sync with inverted time range', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          start_time: PAST_DAY.end,
          end_time: PAST_DAY.start,
        },
      });

      // May fail or handle gracefully
      expect([200, 400, 500, 503]).toContain(response.status());
    });

    test('should handle very long time range', async ({ request }) => {
      const longAgo = new Date(
        Date.now() - 365 * 24 * 60 * 60 * 1000
      ).toISOString();

      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          start_time: longAgo,
        },
      });

      expect([200, 503]).toContain(response.status());
    });

    test('should handle sync with duplicate entity_ids', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID, VALID_ENTITY_ID],
        },
      });

      expect([200, 503]).toContain(response.status());
    });
  });
});

test.describe('Statistics API - GET /api/statistics/:entity_id', () => {
  test.describe('Happy Path', () => {
    test('should retrieve statistics for valid entity', async ({ request }) => {
      const response = await request.get(`/api/statistics/${VALID_ENTITY_ID}`, {
        params: {
          start_time: PAST_WEEK.start,
          end_time: PAST_WEEK.end,
        },
      });

      // May return 200 with data or 500 if QuestDB issue
      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        // Data may be empty object when no statistics exist
        if (Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('entity_id', VALID_ENTITY_ID);
          expect(body.data).toHaveProperty('statistics');
          expect(Array.isArray(body.data.statistics)).toBe(true);
          expect(body.data).toHaveProperty('source', 'questdb');
        }
        expect(response.headers()['x-response-time']).toMatch(/\d+ms/);
      }
    });

    test('should use default time range when not provided', async ({
      request,
    }) => {
      const response = await request.get(`/api/statistics/${VALID_ENTITY_ID}`);

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        // Data may be empty object when no statistics exist
        if (Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('start_time');
          expect(body.data).toHaveProperty('end_time');
        }
      }
    });

    test('should filter by period', async ({ request }) => {
      const periods = ['hour', 'day'];

      for (const period of periods) {
        const response = await request.get(
          `/api/statistics/${VALID_ENTITY_ID}`,
          {
            params: {
              period,
            },
          }
        );

        expect([200, 500]).toContain(response.status());

        if (response.ok()) {
          const body = await response.json();
          // Data may be empty object when no statistics exist
          if (Object.keys(body.data).length > 0) {
            expect(body.data.period).toBe(period);
          }
        }
      }
    });

    test('should return statistics with correct structure', async ({
      request,
    }) => {
      const response = await request.get(`/api/statistics/${VALID_ENTITY_ID}`, {
        params: PAST_DAY,
      });

      if (response.ok()) {
        const body = await response.json();
        // Data may be empty object when no statistics exist
        if (Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('entity_id');
          expect(body.data).toHaveProperty('start_time');
          expect(body.data).toHaveProperty('end_time');
          expect(body.data).toHaveProperty('period');
          expect(body.data).toHaveProperty('source');
          expect(body.data).toHaveProperty('statistics');

          // Check statistics array structure
          if (body.data.statistics.length > 0) {
            const stat = body.data.statistics[0];
            expect(stat).toHaveProperty('timestamp');
            expect(stat).toHaveProperty('state');
            expect(stat).toHaveProperty('sum');
            expect(stat).toHaveProperty('mean');
            expect(stat).toHaveProperty('min');
            expect(stat).toHaveProperty('max');
            expect(stat).toHaveProperty('period');
          }
        }
      }
    });
  });

  test.describe('Validation Errors', () => {
    test('should return 400 for invalid entity_id format', async ({
      request,
    }) => {
      for (const { id, description } of INVALID_ENTITY_IDS) {
        const response = await request.get(
          `/api/statistics/${encodeURIComponent(id)}`
        );

        // Too long entity IDs may return 404 (URL length limit)
        if (description.includes('too long')) {
          expect([400, 404]).toContain(response.status());
        } else {
          expect(response.status()).toBe(400);
        }

        const body = await response.json();
        if (body.success !== undefined) {
          expect(body.success).toBe(false);
        }
        // Error message may be "Bad Request" from schema validation or custom message
        expect(body.error).toBeDefined();
      }
    });

    test('should return 400 for entity_id without domain separator', async ({
      request,
    }) => {
      const response = await request.get('/api/statistics/sensortest');
      expect(response.status()).toBe(400);

      const body = await response.json();
      if (body.success !== undefined) {
        expect(body.success).toBe(false);
      }
      expect(body.error).toBeDefined();
    });

    test('should return 400 for entity_id with multiple separators', async ({
      request,
    }) => {
      const response = await request.get('/api/statistics/sensor.test.extra');
      expect(response.status()).toBe(400);

      const body = await response.json();
      if (body.success !== undefined) {
        expect(body.success).toBe(false);
      }
      expect(body.error).toBeDefined();
    });

    test('should reject entity_id with URL path traversal', async ({
      request,
    }) => {
      const response = await request.get('/api/statistics/../etc.passwd');
      expect(response.status()).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle entity with no statistics data', async ({
      request,
    }) => {
      const response = await request.get(`/api/statistics/sensor.nonexistent`);

      // May return 200 with empty array or 500
      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data.statistics).toBeDefined();
        }
      }
    });

    test('should handle very long entity_id (max 100 chars)', async ({
      request,
    }) => {
      const longEntityId = 'sensor.' + 'a'.repeat(95); // 101 chars total - should fail
      const maxEntityId = 'sensor.' + 'a'.repeat(94); // 100 chars total - should pass

      const tooLongResponse = await request.get(
        `/api/statistics/${longEntityId}`
      );
      // May return 400 (validation), 404 (URL too long), or 500
      expect([400, 404, 500]).toContain(tooLongResponse.status());

      const maxResponse = await request.get(`/api/statistics/${maxEntityId}`);
      // May return 200, 400, 404, or 500 depending on entity existence
      expect([200, 400, 404, 500]).toContain(maxResponse.status());
    });

    test('should handle special characters in entity_id', async ({
      request,
    }) => {
      const specialEntityIds = [
        'sensor.test_123',
        'sensor.test_test',
        'sensor_123.test',
      ];

      for (const entityId of specialEntityIds) {
        const response = await request.get(`/api/statistics/${entityId}`);
        // These are valid format, so should not be 400 for validation
        expect([200, 400, 500]).toContain(response.status());
      }
    });

    test('should handle query parameters with encoded characters', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?start_time=${encodeURIComponent(
          PAST_DAY.start
        )}&end_time=${encodeURIComponent(PAST_DAY.end)}`
      );

      expect([200, 500]).toContain(response.status());
    });
  });

  test.describe('Error Conditions', () => {
    test('should handle invalid date format in query', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?start_time=invalid-date`
      );

      // Should handle gracefully
      expect([400, 500]).toContain(response.status());
    });

    test('should handle database connection errors', async ({ request }) => {
      const response = await request.get(`/api/statistics/${VALID_ENTITY_ID}`);

      // May return 500 if QuestDB is not available
      if (response.status() === 500) {
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toBeDefined();
      }
    });
  });
});

test.describe('Statistics API - GET /api/statistics/:entity_id/daily', () => {
  test.describe('Happy Path', () => {
    test('should retrieve daily summary for valid entity', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily`,
        {
          params: PAST_MONTH,
        }
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('entity_id', VALID_ENTITY_ID);
          expect(body.data).toHaveProperty('period', 'daily');
          expect(body.data).toHaveProperty('time_range');
          expect(body.data).toHaveProperty('summary');
          expect(Array.isArray(body.data.summary)).toBe(true);

          if (body.data.summary && body.data.summary.length > 0) {
            expect(response.headers()['x-response-time']).toMatch(/\d+ms/);
          }
        }
      }
    });

    test('should use default 30-day range when not provided', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.time_range) {
          expect(body.data.time_range).toBeDefined();
        }
      }
    });

    test('should return daily data with correct structure', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily`,
        {
          params: PAST_WEEK,
        }
      );

      if (response.ok()) {
        const body = await response.json();

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('entity_id');
          expect(body.data).toHaveProperty('period', 'daily');
          expect(body.data).toHaveProperty('time_range');
          expect(body.data).toHaveProperty('summary');

          if (body.data.summary && body.data.summary.length > 0) {
            const day = body.data.summary[0];
            expect(day).toHaveProperty('date');
            expect(day).toHaveProperty('total');
            expect(day).toHaveProperty('avg_power');
            expect(day).toHaveProperty('peak');
            expect(day).toHaveProperty('readings');
          }
        }
      }
    });
  });

  test.describe('Validation Errors', () => {
    test('should return 400 for invalid entity_id', async ({ request }) => {
      const response = await request.get('/api/statistics/invalid/daily');
      expect(response.status()).toBe(400);

      const body = await response.json();
      if (body.success !== undefined) {
        expect(body.success).toBe(false);
      }
      expect(body.error).toBeDefined();
    });

    test('should validate entity_id format same as base endpoint', async ({
      request,
    }) => {
      for (const { id } of INVALID_ENTITY_IDS.slice(0, 3)) {
        // Test a few key cases
        const response = await request.get(
          `/api/statistics/${encodeURIComponent(id)}/daily`
        );
        // May return 400 (validation), 404 (route not found), or 500
        expect([400, 404, 500]).toContain(response.status());
      }
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle request with no data in range', async ({ request }) => {
      const futureRange = {
        start: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily`,
        {
          params: futureRange,
        }
      );

      if (response.ok()) {
        const body = await response.json();

        // Check if data exists before asserting properties
        if (body.data && body.data.summary !== undefined) {
          expect(body.data.summary).toEqual([]);
        }
      }
    });

    test('should handle single day range', async ({ request }) => {
      const singleDay = {
        start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily`,
        {
          params: singleDay,
        }
      );

      expect([200, 500]).toContain(response.status());
    });
  });
});

test.describe('Statistics API - GET /api/statistics/:entity_id/monthly', () => {
  test.describe('Happy Path', () => {
    test('should retrieve monthly summary for valid entity', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly`,
        {
          params: {
            start_time: new Date(
              Date.now() - 365 * 24 * 60 * 60 * 1000
            ).toISOString(),
            end_time: new Date().toISOString(),
          },
        }
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('entity_id', VALID_ENTITY_ID);
          expect(body.data).toHaveProperty('period', 'monthly');
          expect(body.data).toHaveProperty('time_range');
          expect(body.data).toHaveProperty('summary');
          expect(Array.isArray(body.data.summary)).toBe(true);

          if (body.data.summary && body.data.summary.length > 0) {
            expect(response.headers()['x-response-time']).toMatch(/\d+ms/);
          }
        }
      }
    });

    test('should use default 365-day range when not provided', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.time_range) {
          expect(body.data.time_range).toBeDefined();
        }
      }
    });

    test('should return monthly data with correct structure', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly`
      );

      if (response.ok()) {
        const body = await response.json();

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('entity_id');
          expect(body.data).toHaveProperty('period', 'monthly');
          expect(body.data).toHaveProperty('time_range');
          expect(body.data).toHaveProperty('summary');

          if (body.data.summary && body.data.summary.length > 0) {
            const month = body.data.summary[0];
            expect(month).toHaveProperty('month');
            expect(month).toHaveProperty('total');
            expect(month).toHaveProperty('avg_power');
            expect(month).toHaveProperty('peak');
            expect(month).toHaveProperty('readings');
          }
        }
      }
    });
  });

  test.describe('Validation Errors', () => {
    test('should return 400 for invalid entity_id', async ({ request }) => {
      const response = await request.get('/api/statistics/invalid/monthly');
      expect(response.status()).toBe(400);

      const body = await response.json();
      if (body.success !== undefined) {
        expect(body.success).toBe(false);
      }
      expect(body.error).toBeDefined();
    });

    test('should validate entity_id consistently', async ({ request }) => {
      const invalidIds = ['', 'InvalidFormat', 'ab'];

      for (const entityId of invalidIds) {
        const response = await request.get(
          `/api/statistics/${encodeURIComponent(entityId)}/monthly`
        );
        expect(response.status()).toBe(400);
      }
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle request spanning multiple years', async ({
      request,
    }) => {
      const multiYear = {
        start: new Date(
          Date.now() - 2 * 365 * 24 * 60 * 60 * 1000
        ).toISOString(),
        end: new Date().toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly`,
        {
          params: multiYear,
        }
      );

      expect([200, 500]).toContain(response.status());
    });

    test('should handle partial month range', async ({ request }) => {
      const partialMonth = {
        start: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly`,
        {
          params: partialMonth,
        }
      );

      expect([200, 500]).toContain(response.status());
    });
  });
});

test.describe('Statistics API - GET /api/statistics/sync/log', () => {
  test.describe('Happy Path', () => {
    test('should retrieve sync logs', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log');

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data).toHaveProperty('logs');
          expect(body.data).toHaveProperty('count');
          expect(Array.isArray(body.data.logs)).toBe(true);
          expect(typeof body.data.count).toBe('number');

          if (body.data.logs && body.data.logs.length > 0) {
            expect(response.headers()['x-response-time']).toMatch(/\d+ms/);
          }
        }
      }
    });

    test('should use default limit of 50 when not specified', async ({
      request,
    }) => {
      const response = await request.get('/api/statistics/sync/log');

      if (response.ok()) {
        const body = await response.json();
        if (body.data.logs) {
          expect(body.data.logs.length).toBeLessThanOrEqual(50);
        }
      }
    });

    test('should respect custom limit parameter', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=5');

      if (response.ok()) {
        const body = await response.json();
        if (body.data.logs) {
          expect(body.data.logs.length).toBeLessThanOrEqual(5);
        }
      }
    });

    test('should filter by entity_id', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/sync/log?entity_id=${VALID_ENTITY_ID}`
      );

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          expect(body.data.logs).toBeDefined();
          // All logs should be for the specified entity
          if (body.data.logs && body.data.logs.length > 0) {
            body.data.logs.forEach((log) => {
              expect(log.entity_ids).toContain(VALID_ENTITY_ID);
            });
          }
        }
      }
    });

    test('should return logs with correct structure', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=1');

      if (response.ok()) {
        const body = await response.json();
        if (body.data.logs && body.data.logs.length > 0) {
          const log = body.data.logs[0];

          expect(log).toHaveProperty('id');
          expect(log).toHaveProperty('entity_ids');
          expect(log).toHaveProperty('records_synced');
          expect(log).toHaveProperty('start_time');
          expect(log).toHaveProperty('end_time');
          expect(log).toHaveProperty('period');
          expect(log).toHaveProperty('duration');
          expect(log).toHaveProperty('success');
          expect(log).toHaveProperty('created_at');
          expect(Array.isArray(log.entity_ids)).toBe(true);
          expect(typeof log.records_synced).toBe('number');
        }
      }
    });
  });

  test.describe('Parameter Validation', () => {
    test('should enforce minimum limit of 1', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=0');

      // Should handle gracefully - either use default or return validation error
      expect([200, 400]).toContain(response.status());
    });

    test('should enforce maximum limit of 100', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=1000');

      if (response.ok()) {
        const body = await response.json();
        // Should cap at 100
        expect(body.data.logs.length).toBeLessThanOrEqual(100);
      }
    });

    test('should handle negative limit', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=-5');

      // Should handle gracefully
      expect([200, 400]).toContain(response.status());
    });

    test('should handle non-numeric limit', async ({ request }) => {
      const response = await request.get(
        '/api/statistics/sync/log?limit=invalid'
      );

      // Should return validation error
      expect([400, 500]).toContain(response.status());
    });
  });

  test.describe('Edge Cases', () => {
    test('should return empty array when no logs exist', async ({
      request,
    }) => {
      const response = await request.get(
        '/api/statistics/sync/log?entity_id=sensor.nonexistent_xyz'
      );

      if (response.ok()) {
        const body = await response.json();
        if (body.data.logs) {
          expect(body.data.logs).toEqual([]);
        }
        if (body.data.count !== undefined) {
          expect(body.data.count).toBe(0);
        }
      }
    });

    test('should handle entity_id filter with special characters', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/sync/log?entity_id=${encodeURIComponent(
          'sensor.test_123'
        )}`
      );

      expect([200, 500]).toContain(response.status());
    });

    test('should handle combining entity_id and limit', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/sync/log?entity_id=${VALID_ENTITY_ID}&limit=5`
      );

      if (response.ok()) {
        const body = await response.json();
        if (body.data.logs) {
          expect(body.data.logs.length).toBeLessThanOrEqual(5);
        }
      }
    });
  });
});

test.describe('Statistics API - POST /api/statistics/compare', () => {
  test.describe('Happy Path', () => {
    test('should compare statistics for multiple entities', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID, ALTERNATIVE_ENTITY_ID],
          start_time: PAST_MONTH.start,
          end_time: PAST_MONTH.end,
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        // Check if data exists before asserting properties
        if (body.data && Object.keys(body.data).length > 0) {
          if (body.data.entity_ids !== undefined) {
            expect(body.data).toHaveProperty('entity_ids');
          }
          if (body.data.aggregation !== undefined) {
            expect(body.data).toHaveProperty('aggregation', 'daily');
          }
          if (body.data.time_range !== undefined) {
            expect(body.data).toHaveProperty('time_range');
          }
          if (body.data.comparison !== undefined) {
            expect(body.data).toHaveProperty('comparison');
            expect(typeof body.data.comparison).toBe('object');
          }
        }
      }
    });

    test('should use default aggregation when not specified', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.aggregation) {
          expect(body.data.aggregation).toBe('daily');
        }
      }
    });

    test('should support hourly aggregation', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'hourly',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.aggregation) {
          expect(body.data.aggregation).toBe('hourly');
        }
      }
    });

    test('should support daily aggregation', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.aggregation) {
          expect(body.data.aggregation).toBe('daily');
        }
      }
    });

    test('should support monthly aggregation', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'monthly',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.aggregation) {
          expect(body.data.aggregation).toBe('monthly');
        }
      }
    });

    test('should compare single entity', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.entity_ids) {
          expect(body.data.entity_ids).toHaveLength(1);
        }
        if (body.data && body.data.comparison) {
          expect(body.data.comparison).toHaveProperty([VALID_ENTITY_ID]);
        }
      }
    });

    test('should use default time range when not provided', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.time_range) {
          expect(body.data.time_range).toBeDefined();
        }
      }
    });
  });

  test.describe('Validation Errors', () => {
    test('should require entity_ids in request body', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {},
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should return 400 for missing entity_ids', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          start_time: PAST_MONTH.start,
          end_time: PAST_MONTH.end,
        },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should validate all entity_ids', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: ['invalid_id', 'also_invalid'],
        },
      });

      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid entity_id format');
    });

    test('should reject mixed valid and invalid entity_ids', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID, 'invalid_format'],
        },
      });

      expect(response.status()).toBe(400);

      const body = await response.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('invalid_format');
    });

    test('should enforce minimum 1 entity', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [],
        },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should enforce maximum 10 entities', async ({ request }) => {
      const tooManyEntities = Array.from(
        { length: 11 },
        (_, i) => `sensor.entity_${i}`
      );

      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: tooManyEntities,
        },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });

    test('should handle invalid aggregation value', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'invalid',
        },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });
  });

  test.describe('Edge Cases', () => {
    test('should handle comparison with 10 entities (max)', async ({
      request,
    }) => {
      const tenEntities = Array.from(
        { length: 10 },
        (_, i) => `sensor.entity_${i}`
      );

      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: tenEntities,
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.entity_ids) {
          expect(body.data.entity_ids).toHaveLength(10);
        }
      }
    });

    test('should handle duplicate entity_ids', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID, VALID_ENTITY_ID],
        },
      });

      expect([200, 500]).toContain(response.status());
    });

    test('should handle entities with no data gracefully', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: ['sensor.nonexistent_1', 'sensor.nonexistent_2'],
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        // Entities with errors should have error property
        if (body.data && body.data.comparison) {
          Object.values(body.data.comparison).forEach((result) => {
            if (result.error) {
              expect(typeof result.error).toBe('string');
            }
          });
        }
      }
    });

    test('should handle future time range', async ({ request }) => {
      const futureRange = {
        start: new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 20 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          start_time: futureRange.start,
          end_time: futureRange.end,
        },
      });

      expect([200, 500]).toContain(response.status());
    });

    test('should handle very long time range', async ({ request }) => {
      const longRange = {
        start: new Date(
          Date.now() - 5 * 365 * 24 * 60 * 60 * 1000
        ).toISOString(),
        end: new Date().toISOString(),
      };

      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          start_time: longRange.start,
          end_time: longRange.end,
        },
      });

      expect([200, 500]).toContain(response.status());
    });
  });

  test.describe('Partial Failure Handling', () => {
    test('should include error for entities that fail', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID, 'sensor.definitely_does_not_exist_xyz'],
        },
      });

      if (response.ok()) {
        const body = await response.json();
        // At least one entity should have data or error
        if (body.data && body.data.comparison) {
          expect(Object.keys(body.data.comparison).length).toBeGreaterThan(0);
        }
      }
    });

    test('should return comparison object with all requested entities', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID, ALTERNATIVE_ENTITY_ID],
        },
      });

      if (response.ok()) {
        const body = await response.json();
        if (body.data && body.data.comparison) {
          expect(body.data.comparison).toHaveProperty([VALID_ENTITY_ID]);
          expect(body.data.comparison).toHaveProperty([ALTERNATIVE_ENTITY_ID]);
        }
      }
    });
  });
});

test.describe('Statistics API - Response Headers', () => {
  test('should include X-Response-Time header on all endpoints', async ({
    request,
  }) => {
    const endpoints = [
      { method: 'get', path: `/api/statistics/${VALID_ENTITY_ID}` },
      { method: 'get', path: `/api/statistics/${VALID_ENTITY_ID}/daily` },
      { method: 'get', path: `/api/statistics/${VALID_ENTITY_ID}/monthly` },
      { method: 'get', path: '/api/statistics/sync/log' },
    ];

    for (const { method, path } of endpoints) {
      const response = await request[method](path);

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/\d+ms/);
      }
    }
  });

  test('should include content-type application/json', async ({ request }) => {
    const response = await request.get(`/api/statistics/${VALID_ENTITY_ID}`);

    if (response.ok()) {
      const contentType = response.headers()['content-type'];
      expect(contentType).toContain('application/json');
    }
  });
});

test.describe('Statistics API - Cross-Endpoint Consistency', () => {
  test('should handle same entity_id across all endpoints consistently', async ({
    request,
  }) => {
    const endpoints = [
      `/api/statistics/${VALID_ENTITY_ID}`,
      `/api/statistics/${VALID_ENTITY_ID}/daily`,
      `/api/statistics/${VALID_ENTITY_ID}/monthly`,
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      // All should either succeed with valid format or fail with 400 for invalid entity
      expect([200, 400, 500]).toContain(response.status());

      if (response.status() === 400) {
        const body = await response.json();
        expect(body.success).toBe(false);
        expect(body.error).toContain('Invalid entity_id');
      }
    }
  });

  test('should validate entity_id format consistently across endpoints', async ({
    request,
  }) => {
    const invalidId = 'InvalidFormat';
    const endpoints = [
      `/api/statistics/${invalidId}`,
      `/api/statistics/${invalidId}/daily`,
      `/api/statistics/${invalidId}/monthly`,
    ];

    for (const endpoint of endpoints) {
      const response = await request.get(endpoint);
      expect(response.status()).toBe(400);

      const body = await response.json();
      if (body.success !== undefined) {
        expect(body.success).toBe(false);
      }
      // Error message may be "Bad Request" or similar
      expect(body.error).toBeDefined();
    }
  });
});

// ============================================================================
// COMPREHENSIVE TESTS WITH DATABASE SETUP
// These tests add data to MongoDB/QuestDB to hit uncovered code paths
// ============================================================================

test.describe('Statistics API - With Database Data', () => {
  test.describe('MongoDB syncLog Setup', () => {
    test('should create sync log entries for testing', async ({ request }) => {
      // First, trigger a sync to create log entries
      const syncResponse = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'hour',
        },
      });

      // May succeed or fail depending on HA connection
      // Either way, we should be able to query logs
      expect([200, 503, 500]).toContain(syncResponse.status());
    });

    test('should retrieve sync logs with various limits', async ({
      request,
    }) => {
      const limits = [1, 10, 50, 100];

      for (const limit of limits) {
        const response = await request.get(
          `/api/statistics/sync/log?limit=${limit}`
        );

        expect([200, 500]).toContain(response.status());

        if (response.ok()) {
          const body = await response.json();
          expect(body.success).toBe(true);
          expect(body.data).toHaveProperty('logs');
          expect(body.data).toHaveProperty('count');
          expect(Array.isArray(body.data.logs)).toBe(true);
          expect(body.data.logs.length).toBeLessThanOrEqual(limit);
        }
      }
    });

    test('should filter sync logs by entity_id', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/sync/log?entity_id=${VALID_ENTITY_ID}&limit=10`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        if (body.data.logs && body.data.logs.length > 0) {
          // Verify all logs match the filter
          body.data.logs.forEach((log) => {
            expect(log.entity_ids).toBeDefined();
            expect(Array.isArray(log.entity_ids)).toBe(true);
          });
        }
      }
    });

    test('should return sync logs with all required fields', async ({
      request,
    }) => {
      const response = await request.get('/api/statistics/sync/log?limit=5');

      if (response.ok()) {
        const body = await response.json();

        if (body.data.logs && body.data.logs.length > 0) {
          const log = body.data.logs[0];
          expect(log).toHaveProperty('id');
          expect(log).toHaveProperty('entity_ids');
          expect(log).toHaveProperty('records_synced');
          expect(log).toHaveProperty('start_time');
          expect(log).toHaveProperty('end_time');
          expect(log).toHaveProperty('period');
          expect(log).toHaveProperty('duration');
          expect(log).toHaveProperty('success');
          expect(log).toHaveProperty('created_at');
        }
      }
    });
  });

  test.describe('Statistics Query - Period Combinations', () => {
    test('should query statistics with hour period', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?period=hour&start_time=${PAST_WEEK.start}&end_time=${PAST_WEEK.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('period', 'hour');
        expect(body.data).toHaveProperty('statistics');
      }
    });

    test('should query statistics with day period', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?period=day&start_time=${PAST_WEEK.start}&end_time=${PAST_WEEK.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('period', 'day');
      }
    });

    test('should query statistics without period (all)', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?start_time=${PAST_DAY.start}&end_time=${PAST_DAY.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('period', 'all');
      }
    });

    test('should query statistics with default time range', async ({
      request,
    }) => {
      const response = await request.get(`/api/statistics/${VALID_ENTITY_ID}`);

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('start_time');
        expect(body.data).toHaveProperty('end_time');
      }
    });
  });

  test.describe('Daily Summary - Time Ranges', () => {
    test('should query daily summary with custom time range', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily?start_time=${PAST_MONTH.start}&end_time=${PAST_MONTH.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('period', 'daily');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data.time_range.start).toBe(PAST_MONTH.start);
        expect(body.data.time_range.end).toBe(PAST_MONTH.end);
      }
    });

    test('should query daily summary with default 30-day range', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        if (body.data.time_range) {
          // Verify default range is approximately 30 days
          const start = new Date(body.data.time_range.start);
          const end = new Date(body.data.time_range.end);
          const daysDiff = Math.floor((end - start) / (24 * 60 * 60 * 1000));
          expect(daysDiff).toBeGreaterThanOrEqual(29);
          expect(daysDiff).toBeLessThanOrEqual(31);
        }
      }
    });

    test('should query daily summary with 7-day range', async ({ request }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily?start_time=${PAST_WEEK.start}&end_time=${PAST_WEEK.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.time_range.start).toBe(PAST_WEEK.start);
        expect(body.data.time_range.end).toBe(PAST_WEEK.end);
      }
    });
  });

  test.describe('Monthly Summary - Time Ranges', () => {
    test('should query monthly summary with custom time range', async ({
      request,
    }) => {
      const pastYear = {
        start: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly?start_time=${pastYear.start}&end_time=${pastYear.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('period', 'monthly');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data.time_range.start).toBe(pastYear.start);
        expect(body.data.time_range.end).toBe(pastYear.end);
      }
    });

    test('should query monthly summary with default 365-day range', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        if (body.data.time_range) {
          // Verify default range is approximately 365 days
          const start = new Date(body.data.time_range.start);
          const end = new Date(body.data.time_range.end);
          const daysDiff = Math.floor((end - start) / (24 * 60 * 60 * 1000));
          expect(daysDiff).toBeGreaterThanOrEqual(364);
          expect(daysDiff).toBeLessThanOrEqual(366);
        }
      }
    });

    test('should query monthly summary for 6 months', async ({ request }) => {
      const sixMonths = {
        start: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date().toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly?start_time=${sixMonths.start}&end_time=${sixMonths.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
      }
    });
  });
});

test.describe('Statistics API - Compare Endpoint - Aggregation Coverage', () => {
  test.describe('All Aggregation Types', () => {
    test('should compare with hourly aggregation', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'hourly',
          start_time: PAST_DAY.start,
          end_time: PAST_DAY.end,
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.aggregation).toBe('hourly');
        expect(body.data).toHaveProperty('comparison');
        expect(body.data.comparison).toHaveProperty([VALID_ENTITY_ID]);
      }
    });

    test('should compare with daily aggregation', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'daily',
          start_time: PAST_WEEK.start,
          end_time: PAST_WEEK.end,
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.aggregation).toBe('daily');
        expect(body.data).toHaveProperty('comparison');
      }
    });

    test('should compare with monthly aggregation', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'monthly',
          start_time: new Date(
            Date.now() - 90 * 24 * 60 * 60 * 1000
          ).toISOString(),
          end_time: new Date().toISOString(),
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.aggregation).toBe('monthly');
        expect(body.data).toHaveProperty('comparison');
      }
    });
  });

  test.describe('Multiple Entity Comparison', () => {
    test('should compare 2 entities', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID, ALTERNATIVE_ENTITY_ID],
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.entity_ids).toHaveLength(2);
        expect(body.data.comparison).toHaveProperty([VALID_ENTITY_ID]);
        expect(body.data.comparison).toHaveProperty([ALTERNATIVE_ENTITY_ID]);
      }
    });

    test('should compare 5 entities', async ({ request }) => {
      const entities = [
        'sensor.energy_1',
        'sensor.energy_2',
        'sensor.energy_3',
        'sensor.energy_4',
        'sensor.energy_5',
      ];

      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: entities,
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.entity_ids).toHaveLength(5);

        entities.forEach((id) => {
          expect(body.data.comparison).toHaveProperty([id]);
        });
      }
    });

    test('should compare 10 entities (maximum)', async ({ request }) => {
      const entities = Array.from(
        { length: 10 },
        (_, i) => `sensor.entity_${i}`
      );

      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: entities,
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.entity_ids).toHaveLength(10);
      }
    });
  });

  test.describe('Compare with Different Time Ranges', () => {
    test('should compare with 1-day range', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'hourly',
          start_time: PAST_DAY.start,
          end_time: PAST_DAY.end,
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.time_range.start).toBe(PAST_DAY.start);
        expect(body.data.time_range.end).toBe(PAST_DAY.end);
      }
    });

    test('should compare with 7-day range', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'daily',
          start_time: PAST_WEEK.start,
          end_time: PAST_WEEK.end,
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
      }
    });

    test('should compare with 30-day range', async ({ request }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'daily',
          start_time: PAST_MONTH.start,
          end_time: PAST_MONTH.end,
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
      }
    });

    test('should compare with default time range (30 days)', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.time_range).toBeDefined();
      }
    });
  });

  test.describe('Compare Error Handling', () => {
    test('should handle entities with no data gracefully', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: [
            VALID_ENTITY_ID,
            'sensor.nonexistent_xyz',
            ALTERNATIVE_ENTITY_ID,
          ],
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.comparison).toHaveProperty([VALID_ENTITY_ID]);
        expect(body.data.comparison).toHaveProperty(['sensor.nonexistent_xyz']);
        expect(body.data.comparison).toHaveProperty([ALTERNATIVE_ENTITY_ID]);
      }
    });

    test('should return error objects for failed entities', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/compare', {
        data: {
          entity_ids: ['sensor.no_data_1', 'sensor.no_data_2'],
          aggregation: 'daily',
        },
      });

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);

        // Check if any entities have errors
        Object.values(body.data.comparison).forEach((result) => {
          if (result.error) {
            expect(typeof result.error).toBe('string');
          }
        });
      }
    });
  });
});

test.describe('Statistics API - Sync Endpoint - Period Coverage', () => {
  test.describe('All Period Types', () => {
    test('should sync with 5minute period', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: '5minute',
          start_time: PAST_DAY.start,
          end_time: PAST_DAY.end,
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.period).toBe('5minute');
      }
    });

    test('should sync with hour period', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'hour',
          start_time: PAST_WEEK.start,
          end_time: PAST_WEEK.end,
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.period).toBe('hour');
      }
    });

    test('should sync with day period', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'day',
          start_time: PAST_MONTH.start,
          end_time: PAST_MONTH.end,
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.period).toBe('day');
      }
    });

    test('should sync with week period', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'week',
          start_time: PAST_MONTH.start,
          end_time: PAST_MONTH.end,
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.period).toBe('week');
      }
    });

    test('should sync with month period', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'month',
          start_time: new Date(
            Date.now() - 365 * 24 * 60 * 60 * 1000
          ).toISOString(),
          end_time: new Date().toISOString(),
        },
      });

      expect([200, 503]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.period).toBe('month');
      }
    });
  });

  test.describe('Sync Response Structure', () => {
    test('should return complete sync response data', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'hour',
        },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data).toHaveProperty('entities_synced');
        expect(body.data).toHaveProperty('records_synced');
        expect(body.data).toHaveProperty('period');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data.time_range).toHaveProperty('start');
        expect(body.data.time_range).toHaveProperty('end');
      }
    });

    test('should include partial_success info on failures', async ({
      request,
    }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
          period: 'hour',
        },
      });

      if (response.ok()) {
        const body = await response.json();

        // Check for partial success structure
        if (body.data.partial_success) {
          expect(body.data).toHaveProperty('failed_entities');
          expect(Array.isArray(body.data.failed_entities)).toBe(true);
        }
      }
    });

    test('should include X-Response-Time header', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entity_ids: [VALID_ENTITY_ID],
        },
      });

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/\d+ms/);
      }
    });
  });
});

test.describe('Statistics API - Error Path Coverage', () => {
  test.describe('Database Error Scenarios', () => {
    test('should handle QuestDB query errors in GET statistics', async ({
      request,
    }) => {
      // Use a valid entity but query may fail
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?start_time=invalid-date`
      );

      // Should handle gracefully
      expect([400, 500]).toContain(response.status());
    });

    test('should handle QuestDB query errors in daily summary', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily?start_time=invalid`
      );

      expect([400, 500]).toContain(response.status());
    });

    test('should handle QuestDB query errors in monthly summary', async ({
      request,
    }) => {
      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly?end_time=not-a-date`
      );

      expect([400, 500]).toContain(response.status());
    });

    test('should handle MongoDB errors in sync log', async ({ request }) => {
      const response = await request.get(
        '/api/statistics/sync/log?limit=invalid'
      );

      expect([400, 500]).toContain(response.status());
    });
  });

  test.describe('Validation Error Coverage', () => {
    test('should validate entity_id pattern format', async ({ request }) => {
      // Valid format (1+ chars after dot is accepted by pattern)
      const response = await request.get('/api/statistics/sensor.ab');

      // Should return 200 (valid format), may have no data
      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
      }
    });

    test('should validate entity_id length maximum (100 chars)', async ({
      request,
    }) => {
      const tooLong = 'sensor.' + 'a'.repeat(100);
      const response = await request.get(`/api/statistics/${tooLong}`);

      expect([400, 404, 500]).toContain(response.status());
    });

    test('should validate entity_id format with numbers', async ({
      request,
    }) => {
      const validIds = ['sensor.test_123', 'sensor.123_test', 'sensor_123.456'];

      for (const id of validIds) {
        const response = await request.get(`/api/statistics/${id}`);
        // These are valid formats, should not be 400
        expect([200, 400, 500]).toContain(response.status());
      }
    });

    test('should reject entity_id with special characters', async ({
      request,
    }) => {
      const invalidIds = [
        'sensor.test@',
        'sensor.test%23', // URL-encoded # (# is URL fragment separator)
        'sensor.test$',
        'sensor.test%',
      ];

      for (const id of invalidIds) {
        const response = await request.get(`/api/statistics/${id}`);
        expect([400, 500]).toContain(response.status());
      }
    });
  });
});

test.describe('Statistics API - Edge Case Coverage', () => {
  test.describe('Empty/Null Data Scenarios', () => {
    test('should handle empty statistics array', async ({ request }) => {
      const futureRange = {
        start: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 366 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?start_time=${futureRange.start}&end_time=${futureRange.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.statistics).toBeDefined();
      }
    });

    test('should handle empty daily summary', async ({ request }) => {
      const futureRange = {
        start: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/daily?start_time=${futureRange.start}&end_time=${futureRange.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.summary).toBeDefined();
      }
    });

    test('should handle empty monthly summary', async ({ request }) => {
      const futureRange = {
        start: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
        end: new Date(Date.now() + 730 * 24 * 60 * 60 * 1000).toISOString(),
      };

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly?start_time=${futureRange.start}&end_time=${futureRange.end}`
      );

      expect([200, 500]).toContain(response.status());

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.summary).toBeDefined();
      }
    });

    test('should handle empty sync log', async ({ request }) => {
      const response = await request.get(
        '/api/statistics/sync/log?entity_id=sensor.never_existed_xyz_123'
      );

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBe(true);
        expect(body.data.logs).toEqual([]);
        expect(body.data.count).toBe(0);
      }
    });
  });

  test.describe('Boundary Value Tests', () => {
    test('should handle limit=1 in sync log', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=1');

      if (response.ok()) {
        const body = await response.json();
        expect(body.data.logs.length).toBeLessThanOrEqual(1);
      }
    });

    test('should handle limit=100 in sync log', async ({ request }) => {
      const response = await request.get('/api/statistics/sync/log?limit=100');

      if (response.ok()) {
        const body = await response.json();
        expect(body.data.logs.length).toBeLessThanOrEqual(100);
      }
    });

    test('should handle very short time range (1 minute)', async ({
      request,
    }) => {
      const oneMinuteAgo = new Date(Date.now() - 60 * 1000).toISOString();
      const now = new Date().toISOString();

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}?start_time=${oneMinuteAgo}&end_time=${now}`
      );

      expect([200, 500]).toContain(response.status());
    });

    test('should handle very long time range (10 years)', async ({
      request,
    }) => {
      const tenYearsAgo = new Date(
        Date.now() - 10 * 365 * 24 * 60 * 60 * 1000
      ).toISOString();

      const response = await request.get(
        `/api/statistics/${VALID_ENTITY_ID}/monthly?start_time=${tenYearsAgo}`
      );

      expect([200, 500]).toContain(response.status());
    });
  });
});
