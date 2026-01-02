export default async function rootRoutes(fastify, options) {
  
  fastify.get('/api/health', {
    schema: {
      description: 'Health check endpoint',
      tags: ['system'],
      response: {
        200: {
          type: 'object',
          properties: {
            status: { type: 'string' },
            homeAssistant: { type: 'boolean' },
            database: { type: 'boolean' },
            timestamp: { type: 'string' }
          }
        }
      }
    }
  }, async (request, reply) => {
    return {
      status: 'ok',
      homeAssistant: fastify.ha?.connected || false,
      database: !!fastify.db,
      timestamp: new Date().toISOString()
    }
  })

  fastify.get('/api/status', {
    schema: {
      description: 'Detailed system status',
      tags: ['system']
    }
  }, async (request, reply) => {
    const cachedEntities = fastify.db.getEntities()
    
    // Get some basic stats about cached data
    const statsQuery = fastify.db.db.prepare(`
      SELECT 
        COUNT(*) as total_records,
        COUNT(DISTINCT entity_id) as entities_with_data,
        MIN(start_time) as earliest_data,
        MAX(start_time) as latest_data
      FROM energy_statistics
    `).get()

    return {
      system: {
        status: 'running',
        uptime: process.uptime(),
        memory: process.memoryUsage()
      },
      homeAssistant: {
        connected: fastify.ha?.connected || false,
        url: process.env.HA_URL || 'not configured'
      },
      cache: {
        entities: cachedEntities.length,
        totalRecords: statsQuery.total_records,
        entitiesWithData: statsQuery.entities_with_data,
        dataRange: {
          earliest: statsQuery.earliest_data,
          latest: statsQuery.latest_data
        }
      }
    }
  })
}
