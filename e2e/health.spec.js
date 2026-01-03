import { test, expect } from '@playwright/test';

test.describe('Health Endpoint', () => {
  test('should return ok status', async ({ request }) => {
    const response = await request.get('/api/health');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body.status).toBeDefined();
  });

  test('should include database status', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = await response.json();

    expect(body).toHaveProperty('mongodb');
    expect(body).toHaveProperty('questdb');
  });

  test('should include timestamp', async ({ request }) => {
    const response = await request.get('/api/health');
    const body = await response.json();

    expect(body).toHaveProperty('timestamp');
    expect(new Date(body.timestamp).getTime()).toBeGreaterThan(0);
  });
});
