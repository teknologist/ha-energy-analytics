import fp from 'fastify-plugin'
import WebSocket from 'ws'

class HomeAssistantClient {
  constructor(url, token) {
    this.url = url.startsWith('ws') ? url : `ws://${url}/api/websocket`
    this.token = token
    this.ws = null
    this.messageId = 1
    this.pendingRequests = new Map()
    this.connected = false
  }

  async connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url)

      this.ws.on('open', () => {
        console.log('WebSocket connected to Home Assistant')
      })

      this.ws.on('message', async (data) => {
        const message = JSON.parse(data.toString())
        
        if (message.type === 'auth_required') {
          this.ws.send(JSON.stringify({
            type: 'auth',
            access_token: this.token
          }))
        } else if (message.type === 'auth_ok') {
          this.connected = true
          console.log('Authenticated with Home Assistant')
          resolve()
        } else if (message.type === 'auth_invalid') {
          reject(new Error('Invalid Home Assistant token'))
        } else if (message.id && this.pendingRequests.has(message.id)) {
          const { resolve, reject } = this.pendingRequests.get(message.id)
          this.pendingRequests.delete(message.id)
          if (message.success === false) {
            reject(new Error(message.error?.message || 'Request failed'))
          } else {
            resolve(message.result)
          }
        }
      })

      this.ws.on('error', (error) => {
        console.error('WebSocket error:', error)
        reject(error)
      })

      this.ws.on('close', () => {
        this.connected = false
        console.log('WebSocket disconnected')
      })
    })
  }

  async send(type, payload = {}) {
    if (!this.connected) {
      throw new Error('Not connected to Home Assistant')
    }

    const id = this.messageId++
    const message = { id, type, ...payload }

    return new Promise((resolve, reject) => {
      this.pendingRequests.set(id, { resolve, reject })
      this.ws.send(JSON.stringify(message))

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 30000)
    })
  }

  async getStates() {
    return this.send('get_states')
  }

  async getEnergyEntities() {
    const states = await this.getStates()
    return states.filter(state => 
      state.entity_id.includes('energy') ||
      state.entity_id.includes('power') ||
      state.attributes?.device_class === 'energy' ||
      state.attributes?.device_class === 'power' ||
      state.attributes?.unit_of_measurement === 'kWh' ||
      state.attributes?.unit_of_measurement === 'W'
    )
  }

  async getStatistics(statisticIds, startTime, endTime, period = 'hour') {
    return this.send('recorder/statistics_during_period', {
      start_time: startTime,
      end_time: endTime,
      statistic_ids: statisticIds,
      period
    })
  }

  async getEnergyPreferences() {
    try {
      return await this.send('energy/get_prefs')
    } catch (error) {
      console.warn('Could not get energy preferences:', error.message)
      return null
    }
  }

  close() {
    if (this.ws) {
      this.ws.close()
    }
  }
}

async function homeAssistantPlugin(fastify, options) {
  const haUrl = process.env.HA_URL || 'homeassistant.local:8123'
  const haToken = process.env.HA_TOKEN

  if (!haToken) {
    fastify.log.warn('HA_TOKEN not set - Home Assistant integration disabled')
    fastify.decorate('ha', null)
    return
  }

  const client = new HomeAssistantClient(haUrl, haToken)

  try {
    await client.connect()
    fastify.decorate('ha', client)
    
    fastify.addHook('onClose', async () => {
      client.close()
    })
  } catch (error) {
    fastify.log.error('Failed to connect to Home Assistant:', error.message)
    fastify.decorate('ha', null)
  }
}

export default fp(homeAssistantPlugin, {
  name: 'home-assistant'
})
