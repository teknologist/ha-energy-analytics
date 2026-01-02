import fp from 'fastify-plugin';
import WebSocket from 'ws';

/**
 * Home Assistant WebSocket Client
 * Runtime-level shared plugin accessible by all services via fastify.ha
 *
 * Features:
 * - WebSocket connection with token authentication
 * - Entity discovery (filters energy-related entities)
 * - Statistics fetching via recorder/statistics_during_period
 * - Event subscription for state_changed events
 * - Automatic reconnection with exponential backoff
 */

class HomeAssistantClient {
  constructor(url, token, logger) {
    this.url = url.startsWith('ws') ? url : `ws://${url}/api/websocket`;
    this.token = token;
    this.logger = logger;
    this.ws = null;
    this.messageId = 1;
    this.pendingRequests = new Map();
    this.subscriptions = new Map();
    this.connected = false;
    this.authenticated = false;
    this.reconnectAttempts = 0;
    this.maxReconnectDelay = 30000; // 30 seconds max
    this.initialReconnectDelay = 1000; // 1 second initial
    this.reconnectTimer = null;
  }

  /**
   * Connect to Home Assistant WebSocket API
   * @returns {Promise<void>}
   */
  async connect() {
    if (
      this.ws &&
      (this.ws.readyState === WebSocket.OPEN ||
        this.ws.readyState === WebSocket.CONNECTING)
    ) {
      this.logger.debug('WebSocket already connected or connecting');
      return;
    }

    return new Promise((resolve, reject) => {
      this.logger.info(
        { url: this.url },
        'Connecting to Home Assistant WebSocket'
      );
      this.ws = new WebSocket(this.url);

      const timeout = setTimeout(() => {
        if (!this.authenticated) {
          this.logger.error('WebSocket authentication timeout');
          this.ws.close();
          reject(new Error('Authentication timeout'));
        }
      }, 30000);

      this.ws.on('open', () => {
        this.connected = true;
        this.reconnectAttempts = 0;
        this.logger.info('WebSocket connected to Home Assistant');
      });

      this.ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());

          if (message.type === 'auth_required') {
            this.logger.debug('Authentication required, sending token');
            this.ws.send(
              JSON.stringify({
                type: 'auth',
                access_token: this.token,
              })
            );
          } else if (message.type === 'auth_ok') {
            this.authenticated = true;
            clearTimeout(timeout);
            this.logger.info('Successfully authenticated with Home Assistant');
            resolve();
          } else if (message.type === 'auth_invalid') {
            clearTimeout(timeout);
            this.logger.error('Invalid Home Assistant token');
            reject(new Error('Invalid Home Assistant token'));
          } else if (message.type === 'event') {
            // Handle subscription events
            this.handleEvent(message);
          } else if (message.id && this.pendingRequests.has(message.id)) {
            // Handle request responses
            const { resolve: resolveRequest, reject: rejectRequest } =
              this.pendingRequests.get(message.id);
            this.pendingRequests.delete(message.id);

            if (message.success === false) {
              this.logger.error(
                { error: message.error },
                'Home Assistant request failed'
              );
              rejectRequest(
                new Error(message.error?.message || 'Request failed')
              );
            } else {
              resolveRequest(message.result);
            }
          } else if (message.id && message.type === 'result') {
            // Handle subscription confirmations
            const { resolve: resolveRequest } =
              this.pendingRequests.get(message.id) || {};
            if (resolveRequest) {
              this.pendingRequests.delete(message.id);
              resolveRequest(message.result);
            }
          }
        } catch (error) {
          this.logger.error({ err: error }, 'Error parsing WebSocket message');
        }
      });

      this.ws.on('error', (error) => {
        this.logger.error({ err: error }, 'WebSocket error');
        clearTimeout(timeout);
        reject(error);
      });

      this.ws.on('close', () => {
        this.connected = false;
        this.authenticated = false;
        this.logger.warn('WebSocket disconnected from Home Assistant');

        // Clear all pending requests
        for (const [id, { reject: rejectRequest }] of this.pendingRequests) {
          rejectRequest(new Error('Connection closed'));
        }
        this.pendingRequests.clear();

        // Attempt reconnection
        this.scheduleReconnect();
      });
    });
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  scheduleReconnect() {
    if (this.reconnectTimer) {
      return; // Reconnection already scheduled
    }

    const delay = Math.min(
      this.initialReconnectDelay * Math.pow(2, this.reconnectAttempts),
      this.maxReconnectDelay
    );

    this.reconnectAttempts++;
    this.logger.info(
      { delay, attempt: this.reconnectAttempts },
      'Scheduling Home Assistant reconnection'
    );

    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      try {
        await this.connect();
        // Resubscribe to all active subscriptions
        await this.resubscribeAll();
      } catch (error) {
        this.logger.error({ err: error }, 'Reconnection failed');
      }
    }, delay);
  }

  /**
   * Resubscribe to all active subscriptions after reconnection
   */
  async resubscribeAll() {
    const subscriptions = Array.from(this.subscriptions.entries());
    this.logger.info(
      { count: subscriptions.length },
      'Resubscribing to events'
    );

    for (const [key, { eventType, callback }] of subscriptions) {
      try {
        const subscriptionId = await this.send('subscribe_events', {
          event_type: eventType,
        });
        this.subscriptions.set(key, { eventType, callback, subscriptionId });
        this.logger.debug(
          { eventType, subscriptionId },
          'Resubscribed to event'
        );
      } catch (error) {
        this.logger.error({ err: error, eventType }, 'Failed to resubscribe');
      }
    }
  }

  /**
   * Check if connected to Home Assistant
   * @returns {boolean}
   */
  isConnected() {
    return (
      this.connected &&
      this.authenticated &&
      this.ws &&
      this.ws.readyState === WebSocket.OPEN
    );
  }

  /**
   * Force reconnection
   * @returns {Promise<void>}
   */
  async reconnect() {
    this.logger.info('Forcing reconnection to Home Assistant');
    if (this.ws) {
      this.ws.close();
    }
    this.reconnectAttempts = 0;
    await this.connect();
  }

  /**
   * Send a message to Home Assistant
   * @param {string} type - Message type
   * @param {Object} payload - Message payload
   * @returns {Promise<any>}
   */
  async send(type, payload = {}) {
    if (!this.isConnected()) {
      throw new Error('Not connected to Home Assistant');
    }

    const id = this.messageId++;
    const message = { id, type, ...payload };

    return new Promise((resolve, reject) => {
      // Create timeout that will be cleared on completion
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 30000);

      // Store handlers that clear timeout on completion
      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeout);
          resolve(result);
        },
        reject: (err) => {
          clearTimeout(timeout);
          reject(err);
        },
      });

      this.ws.send(JSON.stringify(message));
    });
  }

  /**
   * Get all states from Home Assistant
   * @returns {Promise<Array>}
   */
  async getStates() {
    return this.send('get_states');
  }

  /**
   * Discover energy-related entities
   * Filters by keywords and device classes
   * @returns {Promise<Array>}
   */
  async discoverEntities() {
    const states = await this.getStates();
    return states.filter((state) => this.isEnergyEntity(state));
  }

  /**
   * Check if an entity is energy-related
   * @param {Object} state - Entity state object
   * @returns {boolean}
   */
  isEnergyEntity(state) {
    const entityId = state.entity_id.toLowerCase();
    const deviceClass = state.attributes?.device_class?.toLowerCase();
    const unitOfMeasurement = state.attributes?.unit_of_measurement;

    // Filter by entity_id keywords
    const keywordMatch =
      entityId.includes('energy') ||
      entityId.includes('power') ||
      entityId.includes('consumption') ||
      entityId.includes('solar') ||
      entityId.includes('battery') ||
      entityId.includes('production') ||
      entityId.includes('grid');

    // Filter by device_class
    const deviceClassMatch =
      deviceClass === 'energy' ||
      deviceClass === 'power' ||
      deviceClass === 'battery' ||
      deviceClass === 'current' ||
      deviceClass === 'voltage';

    // Filter by unit_of_measurement
    const unitMatch =
      unitOfMeasurement === 'kWh' ||
      unitOfMeasurement === 'Wh' ||
      unitOfMeasurement === 'W' ||
      unitOfMeasurement === 'kW';

    return keywordMatch || deviceClassMatch || unitMatch;
  }

  /**
   * Get statistics from Home Assistant recorder
   * @param {Array<string>} statisticIds - Entity IDs to fetch statistics for
   * @param {string|Date} startTime - Start time (ISO string or Date)
   * @param {string|Date} endTime - End time (ISO string or Date)
   * @param {string} period - Period ('5minute', 'hour', 'day', 'week', 'month')
   * @returns {Promise<Object>}
   */
  async getStatistics(statisticIds, startTime, endTime, period = 'hour') {
    const start =
      startTime instanceof Date ? startTime.toISOString() : startTime;
    const end = endTime instanceof Date ? endTime.toISOString() : endTime;

    return this.send('recorder/statistics_during_period', {
      start_time: start,
      end_time: end,
      statistic_ids: statisticIds,
      period,
    });
  }

  /**
   * Subscribe to state_changed events
   * @param {Function} callback - Callback function to handle events
   * @param {string} entityId - Optional entity ID to filter events
   * @returns {Promise<number>} Subscription ID
   */
  async subscribeToStateChanges(callback, entityId = null) {
    const eventType = 'state_changed';
    const result = await this.send('subscribe_events', {
      event_type: eventType,
    });
    const subscriptionId = result.id || result;

    // Wrap callback to filter by entity_id if provided
    const wrappedCallback = (event) => {
      if (entityId && event.data?.entity_id !== entityId) {
        return; // Skip events for other entities
      }
      callback(event);
    };

    const key = entityId || 'all';
    this.subscriptions.set(key, {
      eventType,
      callback: wrappedCallback,
      subscriptionId,
    });

    this.logger.info(
      { subscriptionId, entityId },
      'Subscribed to state_changed events'
    );
    return subscriptionId;
  }

  /**
   * Unsubscribe from state_changed events
   * @param {string} entityId - Optional entity ID to unsubscribe from
   * @returns {Promise<void>}
   */
  async unsubscribeFromStateChanges(entityId = null) {
    const key = entityId || 'all';
    const subscription = this.subscriptions.get(key);

    if (!subscription) {
      this.logger.warn({ entityId }, 'No subscription found for entity');
      return;
    }

    try {
      await this.send('unsubscribe_events', {
        subscription: subscription.subscriptionId,
      });
      this.subscriptions.delete(key);
      this.logger.info({ entityId }, 'Unsubscribed from state_changed events');
    } catch (error) {
      this.logger.error({ err: error, entityId }, 'Failed to unsubscribe');
      throw error;
    }
  }

  /**
   * Handle incoming events
   * @param {Object} message - Event message
   */
  handleEvent(message) {
    const event = message.event;

    if (!event) {
      return;
    }

    // Route event to appropriate subscription callbacks
    for (const [key, { callback }] of this.subscriptions) {
      try {
        callback(event);
      } catch (error) {
        this.logger.error(
          { err: error, key },
          'Error in subscription callback'
        );
      }
    }
  }

  /**
   * Get energy preferences from Home Assistant
   * @returns {Promise<Object|null>}
   */
  async getEnergyPreferences() {
    try {
      return await this.send('energy/get_prefs');
    } catch (error) {
      this.logger.warn({ err: error }, 'Could not get energy preferences');
      return null;
    }
  }

  /**
   * Close WebSocket connection
   */
  close() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    this.connected = false;
    this.authenticated = false;
    this.pendingRequests.clear();
    this.subscriptions.clear();
  }
}

/**
 * Home Assistant Plugin
 * Shared runtime-level plugin for WebSocket integration
 */
async function homeAssistantPlugin(fastify, options) {
  const haUrl = process.env.HA_URL || 'homeassistant.local:8123';
  const haToken = process.env.HA_TOKEN;

  if (!haToken) {
    fastify.log.warn('HA_TOKEN not set - Home Assistant integration disabled');
    fastify.decorate('ha', null);
    return;
  }

  const client = new HomeAssistantClient(haUrl, haToken, fastify.log);

  try {
    await client.connect();
    fastify.log.info('Home Assistant client initialized and connected');

    // Decorate fastify instance
    fastify.decorate('ha', client);

    // Graceful shutdown
    fastify.addHook('onClose', async () => {
      fastify.log.info('Closing Home Assistant connection');
      client.close();
    });
  } catch (error) {
    fastify.log.error({ err: error }, 'Failed to connect to Home Assistant');
    // Decorate with null so services can check availability
    fastify.decorate('ha', null);
  }
}

export default fp(homeAssistantPlugin, {
  name: 'home-assistant',
  dependencies: [],
});
