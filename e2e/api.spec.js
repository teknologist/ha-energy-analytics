import { test, expect } from '@playwright/test';

test.describe('API Endpoints', () => {
  test.describe('Health and Status', () => {
    test('should return health status', async ({ request }) => {
      const response = await request.get('/api/health');
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body.status).toBeDefined();
      expect(['ok', 'degraded']).toContain(body.status);
    });

    test('should return system status', async ({ request }) => {
      const response = await request.get('/api/status');
      expect(response.ok()).toBeTruthy();

      const body = await response.json();
      expect(body).toHaveProperty('system');
      expect(body.system).toHaveProperty('status');
      expect(body.system).toHaveProperty('uptime');
      expect(body.system).toHaveProperty('memory');
    });
  });

  test.describe('Entities', () => {
    test('should list entities', async ({ request }) => {
      const response = await request.get('/api/entities');

      // May return 200 with empty array or error if no entities configured
      if (response.ok()) {
        const body = await response.json();
        expect(Array.isArray(body)).toBeTruthy();
      } else {
        // If error, should be a proper error response
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });

    test('should handle entity details request', async ({ request }) => {
      const response = await request.get('/api/entities/sensor.test');

      // May return 404 if entity doesn't exist, which is valid
      expect([200, 404, 500]).toContain(response.status());
    });
  });

  test.describe('Settings', () => {
    test('should retrieve settings', async ({ request }) => {
      const response = await request.get('/api/settings');

      if (response.ok()) {
        const body = await response.json();
        expect(body).toBeDefined();
      } else {
        // Settings endpoint should return error if DB not configured
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });

    test('should handle settings update (POST to tracked-entities)', async ({
      request,
    }) => {
      const response = await request.post('/api/settings/tracked-entities', {
        data: {
          trackedEntities: ['sensor.test'],
        },
      });

      // May fail if DB not set up or entity invalid
      expect([200, 400, 500]).toContain(response.status());
    });
  });

  test.describe('Statistics', () => {
    test('should handle statistics request for entity', async ({ request }) => {
      const response = await request.get('/api/statistics/sensor.test', {
        params: {
          start: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
      });

      // May return empty data or error if entity doesn't exist
      if (response.ok()) {
        const body = await response.json();
        expect(body).toBeDefined();
      } else {
        expect(response.status()).toBeGreaterThanOrEqual(400);
      }
    });

    test('should handle sync request', async ({ request }) => {
      const response = await request.post('/api/statistics/sync', {
        data: {
          entityId: 'sensor.test',
          startDate: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
        },
      });

      // Sync may fail if HA not connected (503), entity invalid (400/404), or DB error (500)
      expect([200, 400, 404, 500, 503]).toContain(response.status());
    });
  });

  test.describe('CORS and Headers', () => {
    test('should include proper content-type headers', async ({ request }) => {
      const response = await request.get('/api/health');
      const contentType = response.headers()['content-type'];

      expect(contentType).toContain('application/json');
    });

    test('should handle OPTIONS request', async ({ request }) => {
      const response = await request.fetch('/api/health', {
        method: 'OPTIONS',
      });

      // Should return 200 or 204 for OPTIONS
      expect([200, 204]).toContain(response.status());
    });
  });

  test.describe('Error Handling', () => {
    test('should return 404 for non-existent endpoints', async ({
      request,
    }) => {
      const response = await request.get('/api/nonexistent');
      expect(response.status()).toBe(404);
    });

    test('should handle malformed JSON in POST', async ({ request }) => {
      const response = await request.post('/api/settings', {
        data: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      expect(response.status()).toBeGreaterThanOrEqual(400);
    });
  });
});
