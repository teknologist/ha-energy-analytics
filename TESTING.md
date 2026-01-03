# Testing Guide

This document describes the testing infrastructure for the Energy Dashboard project.

## Testing Stack

- **Vitest**: Unit testing framework for Node.js code
- **Playwright**: End-to-end testing for API and frontend
- **GitHub Actions**: CI/CD pipeline automation

## Running Tests

### Unit Tests

```bash
# Run all unit tests
npm run test:unit

# Run tests in watch mode
npm run test:unit:watch

# Run tests with coverage
npm run test:coverage

# Run specific test file
npm run test:unit -- path/to/test.js
```

### E2E Tests

```bash
# Run E2E tests (requires MongoDB and QuestDB running)
npm run test:e2e

# Run E2E tests with UI mode
npm run test:e2e:ui

# Run specific test file
npx playwright test e2e/health.spec.js
```

### All Tests

```bash
# Run all tests (unit + E2E)
npm test
```

## Writing Tests

### Unit Tests

Unit tests are located alongside the code they test, with a `.test.js` suffix.

Example structure:
```
web/api/routes/
├── root.js
└── root.test.js
```

Example unit test:

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
import Fastify from 'fastify';
import myRoute from './my-route.js';

describe('My Route', () => {
  let fastify;

  beforeEach(async () => {
    fastify = Fastify();
    // Mock dependencies
    fastify.decorate('mongo', {
      someMethod: vi.fn().mockResolvedValue({ data: 'test' }),
    });
    await fastify.register(myRoute);
    await fastify.ready();
  });

  it('should return expected response', async () => {
    const response = await fastify.inject({
      method: 'GET',
      url: '/api/my-endpoint',
    });

    expect(response.statusCode).toBe(200);
    const body = JSON.parse(response.body);
    expect(body).toHaveProperty('data');
  });
});
```

### E2E Tests

E2E tests are located in the `e2e/` directory with a `.spec.js` suffix.

Example E2E test:

```javascript
import { test, expect } from '@playwright/test';

test.describe('Feature Name', () => {
  test('should perform expected behavior', async ({ request }) => {
    const response = await request.get('/api/endpoint');
    expect(response.ok()).toBeTruthy();

    const body = await response.json();
    expect(body).toHaveProperty('expectedField');
  });
});
```

## Test Environment

### Environment Variables

Tests use these environment variables (configured in CI):

```bash
MONGODB_URI=mongodb://localhost:27017/energy_dashboard_test
QUESTDB_HOST=localhost
QUESTDB_HTTP_PORT=9000
QUESTDB_ILP_PORT=9009
HA_URL=homeassistant.local:8123
HA_TOKEN=test_token_for_ci
```

### Local Testing

For E2E tests, ensure services are running:

```bash
# Start development environment
npm run dev

# Or use Docker Compose
docker compose up -d mongodb questdb
```

## CI/CD Pipeline

The GitHub Actions workflow (`.github/workflows/ci.yml`) runs:

1. **Unit Tests**: Run on every push/PR
2. **Coverage Report**: Generated and uploaded to Codecov
3. **Build**: Ensure application builds successfully
4. **E2E Tests**: Run against live services
5. **Lint**: Code quality checks (if configured)

### Pipeline Services

The CI pipeline uses GitHub Actions services for:
- **MongoDB 7**: Database
- **QuestDB 8.0**: Time-series storage

## Coverage

Coverage reports are generated using Vitest's built-in coverage tool (V8 provider).

View coverage:
```bash
npm run test:coverage
# Open coverage/index.html in browser
```

Coverage is also uploaded to Codecov on every CI run (if `CODECOV_TOKEN` is configured).

## Debugging Tests

### Vitest

```bash
# Run with verbose output
npm run test:unit -- --reporter=verbose

# Run specific test by name
npm run test:unit -- -t "test name pattern"

# Debug with Node.js inspector
node --inspect-brk node_modules/.bin/vitest
```

### Playwright

```bash
# Run with UI mode for debugging
npm run test:e2e:ui

# Run headed (see browser)
npx playwright test --headed

# Debug specific test
npx playwright test --debug e2e/health.spec.js
```

## Best Practices

1. **Unit Tests**: Test business logic in isolation with mocked dependencies
2. **E2E Tests**: Test critical user flows and API contracts
3. **Coverage**: Aim for >80% coverage on critical paths
4. **Fast Tests**: Keep unit tests under 100ms each
5. **Isolation**: Each test should be independent and idempotent
6. **Descriptive Names**: Use clear, descriptive test names
7. **Arrange-Act-Assert**: Follow AAA pattern in tests

## Troubleshooting

### Common Issues

**Vitest can't find modules:**
```bash
# Ensure dependencies are installed
npm install
cd web/api && npm install
```

**Playwright tests timeout:**
```bash
# Increase timeout in playwright.config.js
# Ensure services are running before tests
```

**MongoDB connection failed:**
```bash
# Check MongoDB is running
docker compose ps mongodb
# Or start it
docker compose up -d mongodb
```

**QuestDB connection failed:**
```bash
# Check QuestDB is running
docker compose ps questdb
# Wait for it to be fully ready (can take 30s)
```
