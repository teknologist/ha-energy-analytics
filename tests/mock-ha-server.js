#!/usr/bin/env node

/**
 * Mock Home Assistant WebSocket Server for CI/E2E Testing
 *
 * Implements a minimal HA WebSocket API that responds to basic requests
 */

const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.HA_MOCK_PORT || 8123;
const AUTH_TOKEN = process.env.HA_TOKEN || 'test_token_for_ci';

// Mock entity states
const mockStates = {
  'sensor.test_energy_today': {
    entity_id: 'sensor.test_energy_today',
    state: '15.5',
    attributes: {
      unit_of_measurement: 'kWh',
      friendly_name: 'Test Energy Today',
      device_class: 'energy',
    },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'test_context', user_id: null },
  },
  'sensor.test_power': {
    entity_id: 'sensor.test_power',
    state: '450',
    attributes: {
      unit_of_measurement: 'W',
      friendly_name: 'Test Power',
      device_class: 'power',
    },
    last_changed: new Date().toISOString(),
    last_updated: new Date().toISOString(),
    context: { id: 'test_context', user_id: null },
  },
};

// Create HTTP server for health checks
const server = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
  } else {
    res.writeHead(404);
    res.end();
  }
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws, req) => {
  console.log('New WebSocket connection');

  // Handle incoming messages
  ws.on('message', (data) => {
    try {
      const message = JSON.parse(data);
      console.log('Received:', message.type);

      switch (message.type) {
        case 'auth':
          // Authentication request
          if (message.access_token === AUTH_TOKEN) {
            ws.send(
              JSON.stringify({
                type: 'auth_ok',
                ha_version: '2024.1.0',
              })
            );
            console.log('Authentication successful');
          } else {
            ws.send(
              JSON.stringify({
                type: 'auth_invalid',
                message: 'Invalid access token',
              })
            );
            console.log('Authentication failed');
            ws.close();
          }
          break;

        case 'get_states':
          // Return all mock states
          ws.send(
            JSON.stringify({
              type: 'result',
              success: true,
              result: Object.values(mockStates),
              id: message.id,
            })
          );
          break;

        case 'subscribe_events':
          // Send initial state_changed event after subscription
          setTimeout(() => {
            ws.send(
              JSON.stringify({
                type: 'event',
                event: {
                  event_type: 'state_changed',
                  data: {
                    entity_id: 'sensor.test_energy_today',
                    old_state: null,
                    new_state: mockStates['sensor.test_energy_today'],
                  },
                },
                origin: 'LOCAL',
              })
            );
          }, 100);
          break;

        case 'call_service':
          // Handle service calls (just acknowledge)
          ws.send(
            JSON.stringify({
              type: 'result',
              success: true,
              result: {
                context: { id: 'mock_context', parent_id: null },
                service: message.domain,
              },
              id: message.id,
            })
          );
          break;

        default:
          // Unknown message type - just send result
          ws.send(
            JSON.stringify({
              type: 'result',
              success: true,
              result: {},
              id: message.id,
            })
          );
      }
    } catch (error) {
      console.error('Error handling message:', error);
    }
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Start server
server.listen(PORT, () => {
  console.log(`Mock Home Assistant server listening on port ${PORT}`);
  console.log(`WebSocket: ws://localhost:${PORT}/api/websocket`);
  console.log(`Health: http://localhost:${PORT}/health`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down...');
  wss.close(() => {
    server.close(() => {
      console.log('Server closed');
      process.exit(0);
    });
  });
});
