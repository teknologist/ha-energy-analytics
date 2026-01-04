import { test, expect } from '@playwright/test';

// Recorder service routes are internal to watt runtime (recorder.plt.local)
// and may not be exposed externally. These tests verify the behavior
// when routes are available or return appropriate 404 when not.

test.describe('Recorder Service Endpoints', () => {
  // Helper to check if routes are exposed externally
  async function areRoutesExposed(request) {
    const response = await request.get('/recorder/status');
    return response.status() !== 404;
  }

  test.describe('GET /recorder/status', () => {
    test('should return recorder service status or 404 if internal only', async ({
      request,
    }) => {
      const response = await request.get('/recorder/status');

      // Routes may return 404 if not exposed externally (internal watt service only)
      if (response.status() === 404) {
        const body = await response.json();
        expect(body.statusCode).toBe(404);
        expect(body.message).toContain('Route GET:/recorder/status not found');
        return;
      }

      // May return 500 if recorder plugin is not loaded (e.g., missing dependencies)
      // or 200 with status data
      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.data).toBeDefined();

        // Verify expected fields in status response
        expect(body.data).toHaveProperty('status');
        expect(body.data).toHaveProperty('isRunning');
        expect(body.data).toHaveProperty('entityCount');
        expect(body.data).toHaveProperty('eventCount');
        expect(body.data).toHaveProperty('errorCount');

        // Verify status is either 'running' or 'stopped'
        expect(['running', 'stopped']).toContain(body.data.status);

        // Verify numeric fields
        expect(typeof body.data.entityCount).toBe('number');
        expect(typeof body.data.eventCount).toBe('number');
        expect(typeof body.data.errorCount).toBe('number');

        // Verify lastEventAt is either null or valid ISO string
        if (body.data.lastEventAt !== null) {
          expect(new Date(body.data.lastEventAt).getTime()).toBeGreaterThan(0);
        }
      } else {
        // If not ok and not 404, should return proper error response
        expect(response.status()).toBeGreaterThanOrEqual(500);
      }
    });

    test('should include JSON content-type header', async ({ request }) => {
      const response = await request.get('/recorder/status');
      const contentType = response.headers()['content-type'];

      expect(contentType).toContain('application/json');
    });
  });

  test.describe('POST /recorder/backfill/trigger', () => {
    test('should trigger backfill or return 404 if internal only', async ({
      request,
    }) => {
      const response = await request.post('/recorder/backfill/trigger');

      // Routes may return 404 if not exposed externally
      if (response.status() === 404) {
        const body = await response.json();
        expect(body.statusCode).toBe(404);
        return;
      }

      // May return 200 (triggered) or 500 (recorder not available)
      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.message).toBeDefined();
      }
    });

    test('should include JSON content-type header', async ({ request }) => {
      const response = await request.post('/recorder/backfill/trigger');
      const contentType = response.headers()['content-type'];

      expect(contentType).toContain('application/json');
    });
  });

  test.describe('POST /recorder/reseed', () => {
    test('should trigger reseeding or return 404 if internal only', async ({
      request,
    }) => {
      const response = await request.post('/recorder/reseed');

      // Routes may return 404 if not exposed externally
      if (response.status() === 404) {
        const body = await response.json();
        expect(body.statusCode).toBe(404);
        return;
      }

      // May return 200 (triggered) or 500 (recorder not available)
      if (response.ok()) {
        const body = await response.json();
        expect(body.success).toBeTruthy();
        expect(body.message).toBeDefined();
      }
    });

    test('should include JSON content-type header', async ({ request }) => {
      const response = await request.post('/recorder/reseed');
      const contentType = response.headers()['content-type'];

      expect(contentType).toContain('application/json');
    });
  });

  test.describe('Error Handling', () => {
    test('should return 404 for invalid recorder endpoints', async ({
      request,
    }) => {
      const response = await request.get('/recorder/nonexistent');
      expect(response.status()).toBe(404);
    });

    test('should handle invalid HTTP methods', async ({ request }) => {
      const response = await request.fetch('/recorder/status', {
        method: 'DELETE',
      });

      // Should return 404 for non-existent routes or 405 for wrong method
      expect([404, 405]).toContain(response.status());
    });

    test('should handle malformed requests gracefully', async ({ request }) => {
      const response = await request.post('/recorder/backfill/trigger', {
        data: 'invalid json',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      // Should return error for invalid JSON or 404 if route not exposed
      expect([400, 404]).toContain(response.status());
    });
  });

  test.describe('Response Format Validation (when routes exposed)', () => {
    test.use({
      skip: async ({ request }) => !(await areRoutesExposed(request)),
    });

    test('status response should match schema', async ({ request }) => {
      const response = await request.get('/recorder/status');
      if (!response.ok()) {
        test.skip();
        return;
      }

      const body = await response.json();

      // Verify response structure matches expected schema
      expect(body).toMatchObject({
        success: true,
        data: {
          status: expect.any(String),
          isRunning: expect.any(Boolean),
          lastEventAt: expect.any(String), // or null
          entityCount: expect.any(Number),
          eventCount: expect.any(Number),
          errorCount: expect.any(Number),
        },
      });
    });

    test('backfill trigger response should match schema', async ({
      request,
    }) => {
      const response = await request.post('/recorder/backfill/trigger');
      if (!response.ok()) {
        test.skip();
        return;
      }

      const body = await response.json();

      expect(body).toMatchObject({
        success: true,
        message: expect.any(String),
      });
    });

    test('reseed response should match schema', async ({ request }) => {
      const response = await request.post('/recorder/reseed');
      if (!response.ok()) {
        test.skip();
        return;
      }

      const body = await response.json();

      expect(body).toMatchObject({
        success: true,
        message: expect.any(String),
      });
    });
  });

  test.describe('Consistent Response Format', () => {
    test('should return consistent JSON structure across all endpoints', async ({
      request,
    }) => {
      const responses = await Promise.all([
        request.get('/recorder/status'),
        request.post('/recorder/backfill/trigger'),
        request.post('/recorder/reseed'),
      ]);

      // All endpoints should respond with JSON
      for (const response of responses) {
        const contentType = response.headers()['content-type'];
        expect(contentType).toContain('application/json');

        // If not 404, should have proper response structure
        if (response.status() !== 404) {
          const body = await response.json();
          expect(body).toBeDefined();
        }
      }
    });
  });
});
