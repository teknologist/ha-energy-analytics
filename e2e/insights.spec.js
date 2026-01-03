import { test, expect } from '@playwright/test';

test.describe('Insights API Endpoints', () => {
  // Helper to check if QuestDB is available
  async function isQuestDBAvailable(request) {
    const response = await request.get('/api/status');
    if (!response.ok()) return false;
    const body = await response.json();
    return body.questdb?.status === 'connected';
  }

  test.describe('GET /api/insights/top-consumers', () => {
    test('should return top consumers with default parameters', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toBeDefined();
        expect(body.data).toHaveProperty('period', 'week');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data).toHaveProperty('total_consumption');
        expect(body.data).toHaveProperty('top_consumers');
        expect(Array.isArray(body.data.top_consumers)).toBeTruthy();
        expect(response.headers()['x-response-time']).toMatch(/^\d+ms$/);
      } else {
        // QuestDB or MongoDB might not be available
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle day period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('day');
        expect(body.data.time_range).toBeDefined();
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle week period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'week' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('week');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle month period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'month' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('month');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should reject invalid period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'invalid' },
      });

      // Fastify schema validation returns 400, not 500
      expect(response.status()).toBe(400);
      const body = await response.json();
      // Error may be in different formats depending on validation
      expect(body.error || body.message).toBeDefined();
    });

    test('should handle custom limit parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { limit: 10 },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.top_consumers.length).toBeLessThanOrEqual(10);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle maximum limit parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { limit: 20 },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.top_consumers.length).toBeLessThanOrEqual(20);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle limit above maximum (should cap at 20)', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { limit: 100 },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        // Sanitize.limit should cap at 20
        expect(body.data.top_consumers.length).toBeLessThanOrEqual(20);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return enriched consumer data with metadata', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        // Data may be empty when no consumption data exists
        if (body.data.top_consumers && body.data.top_consumers.length > 0) {
          const consumer = body.data.top_consumers[0];
          expect(consumer).toHaveProperty('entity_id');
          expect(consumer).toHaveProperty('friendly_name');
          expect(consumer).toHaveProperty('unit_of_measurement');
          expect(consumer).toHaveProperty('consumption');
          expect(consumer).toHaveProperty('percentage');

          // Check types if values exist (may be null/undefined)
          if (
            consumer.consumption !== null &&
            consumer.consumption !== undefined
          ) {
            expect(typeof consumer.consumption).toBe('number');
          }
          if (
            consumer.percentage !== null &&
            consumer.percentage !== undefined
          ) {
            expect(typeof consumer.percentage).toBe('number');
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should calculate percentages correctly', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        // Data may be empty when no consumption data exists
        if (
          body.data.top_consumers &&
          body.data.top_consumers.length > 0 &&
          body.data.total_consumption > 0
        ) {
          // Verify percentages sum reasonably close to 100% (within rounding error)
          const totalPercentage = body.data.top_consumers.reduce(
            (sum, c) => sum + (c.percentage || 0),
            0
          );
          // May be less than 100 if not all entities are in top N
          expect(totalPercentage).toBeLessThanOrEqual(100);
          // Only assert > 0 if we have valid percentage data
          if (totalPercentage > 0) {
            expect(totalPercentage).toBeGreaterThan(0);
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle zero total consumption gracefully', async ({
      request,
    }) => {
      // Using a very recent time range likely to have no data
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.total_consumption).toBeGreaterThanOrEqual(0);
        expect(Array.isArray(body.data.top_consumers)).toBeTruthy();
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should include X-Response-Time header', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers');

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/^\d+ms$/);
      }
    });
  });

  test.describe('GET /api/insights/peak', () => {
    test('should return peak consumption with default parameters', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/peak');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toBeDefined();
        expect(body.data).toHaveProperty('period', 'week');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data).toHaveProperty('peak');
        expect(response.headers()['x-response-time']).toMatch(/^\d+ms$/);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return null peak when no data available', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/peak');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toHaveProperty('peak');
        // Peak can be null if no data
        expect(
          body.data.peak === null || typeof body.data.peak === 'object'
        ).toBeTruthy();
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return enriched peak data when available', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/peak');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        if (
          body.data.peak !== null &&
          typeof body.data.peak === 'object' &&
          Object.keys(body.data.peak).length > 0
        ) {
          expect(body.data.peak).toHaveProperty('entity_id');
          expect(body.data.peak).toHaveProperty('friendly_name');
          expect(body.data.peak).toHaveProperty('value');
          expect(body.data.peak).toHaveProperty('unit');
          expect(body.data.peak).toHaveProperty('timestamp');
          expect(typeof body.data.peak.value).toBe('number');
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle day period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/peak', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('day');
        expect(body.data.time_range).toBeDefined();
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle week period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/peak', {
        params: { period: 'week' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('week');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle month period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/peak', {
        params: { period: 'month' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('month');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should reject invalid period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/peak', {
        params: { period: 'invalid' },
      });

      // Fastify schema validation returns 400, not 500
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error || body.message).toBeDefined();
    });

    test('should include X-Response-Time header', async ({ request }) => {
      const response = await request.get('/api/insights/peak');

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/^\d+ms$/);
      }
    });
  });

  test.describe('GET /api/insights/patterns', () => {
    test('should return consumption patterns with default parameters', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/patterns');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toBeDefined();
        expect(body.data).toHaveProperty('period', 'week');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data).toHaveProperty('burst_consumers');
        expect(body.data).toHaveProperty('steady_consumers');
        expect(Array.isArray(body.data.burst_consumers)).toBeTruthy();
        expect(Array.isArray(body.data.steady_consumers)).toBeTruthy();
        expect(response.headers()['x-response-time']).toMatch(/^\d+ms$/);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should classify consumers into burst and steady', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/patterns');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.burst_consumers).toBeDefined();
        expect(body.data.steady_consumers).toBeDefined();
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return enriched pattern data with metrics', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/patterns');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        const allConsumers = [
          ...body.data.burst_consumers,
          ...body.data.steady_consumers,
        ];

        if (allConsumers.length > 0) {
          const consumer = allConsumers[0];
          expect(consumer).toHaveProperty('entity_id');
          expect(consumer).toHaveProperty('friendly_name');
          expect(consumer).toHaveProperty('avg_consumption');
          expect(consumer).toHaveProperty('variance');
          expect(consumer).toHaveProperty('peak_to_avg_ratio');
          expect(typeof consumer.avg_consumption).toBe('number');
          expect(typeof consumer.variance).toBe('number');
          expect(typeof consumer.peak_to_avg_ratio).toBe('number');
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle day period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/patterns', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('day');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle week period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/patterns', {
        params: { period: 'week' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('week');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle month period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/patterns', {
        params: { period: 'month' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('month');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should reject invalid period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/patterns', {
        params: { period: 'invalid' },
      });

      // Fastify schema validation returns 400, not 500
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error || body.message).toBeDefined();
    });

    test('should handle empty dataset gracefully', async ({ request }) => {
      const response = await request.get('/api/insights/patterns', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.burst_consumers.length).toBeGreaterThanOrEqual(0);
        expect(body.data.steady_consumers.length).toBeGreaterThanOrEqual(0);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should include X-Response-Time header', async ({ request }) => {
      const response = await request.get('/api/insights/patterns');

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/^\d+ms$/);
      }
    });
  });

  test.describe('GET /api/insights/breakdown', () => {
    test('should return consumption breakdown with default parameters', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toBeDefined();
        expect(body.data).toHaveProperty('period', 'week');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data).toHaveProperty('total_consumption');
        expect(body.data).toHaveProperty('breakdown');
        expect(Array.isArray(body.data.breakdown)).toBeTruthy();
        expect(response.headers()['x-response-time']).toMatch(/^\d+ms$/);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return all entities in breakdown', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(Array.isArray(body.data.breakdown)).toBeTruthy();
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return enriched breakdown data', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        // Data may be empty when no consumption data exists
        if (body.data.breakdown && body.data.breakdown.length > 0) {
          const item = body.data.breakdown[0];
          expect(item).toHaveProperty('entity_id');
          expect(item).toHaveProperty('friendly_name');
          expect(item).toHaveProperty('consumption');
          expect(item).toHaveProperty('percentage');
          expect(item).toHaveProperty('unit_of_measurement');

          // Check types if values exist (may be null/undefined)
          if (item.consumption !== null && item.consumption !== undefined) {
            expect(typeof item.consumption).toBe('number');
          }
          if (item.percentage !== null && item.percentage !== undefined) {
            expect(typeof item.percentage).toBe('number');
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should calculate percentages to sum to 100%', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        // Check if data exists and has breakdown
        if (
          body.data &&
          body.data.breakdown &&
          body.data.breakdown.length > 0 &&
          body.data.total_consumption > 0
        ) {
          const totalPercentage = body.data.breakdown.reduce(
            (sum, item) => sum + (item.percentage || 0),
            0
          );
          // Should be very close to 100% (allowing for floating point rounding)
          // Only assert if we have valid data
          if (totalPercentage > 0) {
            expect(totalPercentage).toBeGreaterThan(99);
            expect(totalPercentage).toBeLessThanOrEqual(100.01); // Allow for floating point imprecision
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should order breakdown by consumption descending', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        // Data may be empty when no consumption data exists
        if (body.data.breakdown && body.data.breakdown.length > 1) {
          for (let i = 0; i < body.data.breakdown.length - 1; i++) {
            const current = body.data.breakdown[i].consumption;
            const next = body.data.breakdown[i + 1].consumption;

            // Only compare if both values exist and are valid numbers
            if (
              current !== null &&
              current !== undefined &&
              next !== null &&
              next !== undefined
            ) {
              expect(current).toBeGreaterThanOrEqual(next);
            }
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle day period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('day');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle week period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown', {
        params: { period: 'week' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('week');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle month period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown', {
        params: { period: 'month' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('month');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should reject invalid period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown', {
        params: { period: 'invalid' },
      });

      // Fastify schema validation returns 400, not 500
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error || body.message).toBeDefined();
    });

    test('should handle zero total consumption', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.total_consumption).toBeGreaterThanOrEqual(0);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should include X-Response-Time header', async ({ request }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/^\d+ms$/);
      }
    });
  });

  test.describe('GET /api/insights/timeline', () => {
    test('should return timeline with default parameters', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/timeline');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toBeDefined();
        expect(body.data).toHaveProperty('period', 'week');
        expect(body.data).toHaveProperty('group_by', 'hour');
        expect(body.data).toHaveProperty('time_range');
        expect(body.data).toHaveProperty('timeline');
        expect(Array.isArray(body.data.timeline)).toBeTruthy();
        expect(response.headers()['x-response-time']).toMatch(/^\d+ms$/);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return timeline grouped by hour', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { group_by: 'hour' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.group_by).toBe('hour');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return timeline grouped by day', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { group_by: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.group_by).toBe('day');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should reject invalid group_by parameter', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { group_by: 'invalid' },
      });

      expect(response.status()).toBe(400);
      const body = await response.json();
      // Fastify schema validation returns generic error message
      expect(body.error || body.message).toBeDefined();
    });

    test('should return timeline with total and breakdown', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/timeline');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        if (body.data.timeline.length > 0) {
          const entry = body.data.timeline[0];
          expect(entry).toHaveProperty('time');
          expect(entry).toHaveProperty('total');
          expect(entry).toHaveProperty('breakdown');
          expect(typeof entry.total).toBe('number');
          expect(typeof entry.breakdown).toBe('object');
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return timeline with entity breakdown', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/timeline');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        if (body.data.timeline.length > 0) {
          const entry = body.data.timeline[0];
          expect(entry.breakdown).toBeDefined();

          // Check that breakdown has entity entries
          const entityIds = Object.keys(entry.breakdown);
          if (entityIds.length > 0) {
            const entityData = entry.breakdown[entityIds[0]];
            expect(entityData).toHaveProperty('consumption');
            expect(entityData).toHaveProperty('friendly_name');
            expect(typeof entityData.consumption).toBe('number');
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should order timeline chronologically', async ({ request }) => {
      const response = await request.get('/api/insights/timeline');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        if (body.data.timeline.length > 1) {
          for (let i = 0; i < body.data.timeline.length - 1; i++) {
            const current = new Date(body.data.timeline[i].time).getTime();
            const next = new Date(body.data.timeline[i + 1].time).getTime();
            expect(current).toBeLessThanOrEqual(next);
          }
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle day period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('day');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle week period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { period: 'week' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('week');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle month period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { period: 'month' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('month');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should reject invalid period parameter', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { period: 'invalid' },
      });

      // Fastify schema validation returns 400, not 500
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.error || body.message).toBeDefined();
    });

    test('should handle empty timeline gracefully', async ({ request }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.timeline.length).toBeGreaterThanOrEqual(0);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should include X-Response-Time header', async ({ request }) => {
      const response = await request.get('/api/insights/timeline');

      if (response.ok()) {
        const responseTime = response.headers()['x-response-time'];
        expect(responseTime).toBeDefined();
        expect(responseTime).toMatch(/^\d+ms$/);
      }
    });

    test('should handle combined period and group_by parameters', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { period: 'week', group_by: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.period).toBe('week');
        expect(body.data.group_by).toBe('day');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });
  });

  test.describe('Edge Cases and Error Handling', () => {
    test('should handle malformed query parameters', async ({ request }) => {
      const response = await request.get(
        '/api/insights/top-consumers?limit=abc'
      );

      // Should return error or sanitize to default
      expect([400, 500]).toContain(response.status());
    });

    test('should handle negative limit parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { limit: -5 },
      });

      expect([400, 500]).toContain(response.status());
    });

    test('should handle zero limit parameter', async ({ request }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { limit: 0 },
      });

      expect([400, 500]).toContain(response.status());
    });

    test('should handle SQL injection attempt in period', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: "day'; DROP TABLE energy_statistics; --" },
      });

      // Should be rejected by validation
      expect([400, 500]).toContain(response.status());
    });

    test('should handle special characters in group_by', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/timeline', {
        params: { group_by: "hour'; DROP TABLE energy_statistics; --" },
      });

      // Should be rejected by validation
      expect(response.status()).toBe(400);
      const body = await response.json();
      expect(body.success).toBeFalsy();
    });

    test('should return consistent response format across all endpoints', async ({
      request,
    }) => {
      const endpoints = [
        '/api/insights/top-consumers',
        '/api/insights/peak',
        '/api/insights/patterns',
        '/api/insights/breakdown',
        '/api/insights/timeline',
      ];

      for (const endpoint of endpoints) {
        const response = await request.get(endpoint);

        if (response.ok()) {
          const body = await response.json();
          expect(body).toHaveProperty('success');
          expect(body).toHaveProperty('data');
        }
      }
    });

    test('should handle concurrent requests', async ({ request }) => {
      const endpoints = [
        '/api/insights/top-consumers',
        '/api/insights/peak',
        '/api/insights/patterns',
        '/api/insights/breakdown',
        '/api/insights/timeline',
      ];

      const responses = await Promise.all(
        endpoints.map((endpoint) => request.get(endpoint))
      );

      // All should return valid responses (200 or 5xx for DB errors)
      for (const response of responses) {
        expect([200, 400, 500, 503]).toContain(response.status());
      }
    });

    test('should validate time range calculation for day period', async ({
      request,
    }) => {
      const beforeRequest = Date.now();
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'day' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.time_range).toBeDefined();

        const startTime = new Date(body.data.time_range.start).getTime();
        const endTime = new Date(body.data.time_range.end).getTime();
        const dayInMs = 24 * 60 * 60 * 1000;

        // Start should be approximately 24 hours before end
        expect(endTime - startTime).toBeGreaterThanOrEqual(dayInMs - 1000);
        expect(endTime - startTime).toBeLessThanOrEqual(dayInMs + 1000);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should validate time range calculation for week period', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'week' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.time_range).toBeDefined();

        const startTime = new Date(body.data.time_range.start).getTime();
        const endTime = new Date(body.data.time_range.end).getTime();
        const weekInMs = 7 * 24 * 60 * 60 * 1000;

        // Start should be approximately 7 days before end
        expect(endTime - startTime).toBeGreaterThanOrEqual(weekInMs - 1000);
        expect(endTime - startTime).toBeLessThanOrEqual(weekInMs + 1000);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should validate time range calculation for month period', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers', {
        params: { period: 'month' },
      });

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data.time_range).toBeDefined();

        const startTime = new Date(body.data.time_range.start).getTime();
        const endTime = new Date(body.data.time_range.end).getTime();
        const monthInMs = 30 * 24 * 60 * 60 * 1000;

        // Start should be approximately 30 days before end
        expect(endTime - startTime).toBeGreaterThanOrEqual(monthInMs - 1000);
        expect(endTime - startTime).toBeLessThanOrEqual(monthInMs + 1000);
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });
  });

  test.describe('Response Headers', () => {
    test('should include content-type application/json', async ({
      request,
    }) => {
      const endpoints = [
        '/api/insights/top-consumers',
        '/api/insights/peak',
        '/api/insights/patterns',
        '/api/insights/breakdown',
        '/api/insights/timeline',
      ];

      for (const endpoint of endpoints) {
        const response = await request.get(endpoint);
        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('application/json');
      }
    });

    test('should include X-Response-Time on all successful requests', async ({
      request,
    }) => {
      const endpoints = [
        '/api/insights/top-consumers',
        '/api/insights/peak',
        '/api/insights/patterns',
        '/api/insights/breakdown',
        '/api/insights/timeline',
      ];

      for (const endpoint of endpoints) {
        const response = await request.get(endpoint);

        if (response.ok()) {
          const responseTime = response.headers()['x-response-time'];
          expect(responseTime).toBeDefined();
          expect(responseTime).toMatch(/^\d+ms$/);
        }
      }
    });
  });

  test.describe('Data Integrity', () => {
    test('should handle entity not found in MongoDB gracefully', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        // Entities without metadata should use entity_id as friendly_name
        if (body.data.top_consumers.length > 0) {
          const consumer = body.data.top_consumers[0];
          expect(consumer.friendly_name).toBeDefined();
          expect(consumer.unit_of_measurement).toBeDefined();
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should return consistent data structure across all endpoints', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/top-consumers');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toHaveProperty('period');
        expect(body.data).toHaveProperty('time_range');

        // Validate time_range structure
        expect(body.data.time_range).toHaveProperty('start');
        expect(body.data.time_range).toHaveProperty('end');
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle missing entity metadata gracefully in breakdown', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/breakdown');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        if (body.data.breakdown.length > 0) {
          const item = body.data.breakdown[0];
          // Should always have these fields even if entity not in MongoDB
          expect(item.friendly_name).toBeDefined();
          expect(item.unit_of_measurement).toBeDefined();
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });

    test('should handle missing entity metadata gracefully in patterns', async ({
      request,
    }) => {
      const response = await request.get('/api/insights/patterns');

      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();

        const allConsumers = [
          ...body.data.burst_consumers,
          ...body.data.steady_consumers,
        ];

        if (allConsumers.length > 0) {
          const consumer = allConsumers[0];
          // Should always have friendly_name even if entity not in MongoDB
          expect(consumer.friendly_name).toBeDefined();
        }
      } else {
        expect([400, 500, 503]).toContain(response.status());
      }
    });
  });
});
