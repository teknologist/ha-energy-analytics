# Platformatic Watt: Sharing a Database Plugin Between Services

## Overview

This guide explains how to share a database plugin (e.g., MongoDB) between multiple services in a Platformatic Watt application using the shared plugin approach.

## 1. Create the Shared Plugin

Create a runtime-level plugin that will be available to all services:

```javascript
// runtime-plugins/db.js
const fp = require('fastify-plugin')

module.exports = fp(async function (app, opts) {
  app.register(require('@fastify/mongodb'), {
    url: process.env.MONGODB_URL,
    database: opts.database || 'default'
  })
}, {
  name: 'shared-db',
  encapsulate: false  // Ensures the decorator propagates to all child services
})
```

## 2. Configure in watt.json

Register the plugin at the runtime level in your `watt.json`:

```json
{
  "$schema": "https://schemas.platformatic.dev/watt/2.0.0.json",
  "server": {
    "port": "{PORT}"
  },
  "plugins": {
    "paths": [{
      "path": "./runtime-plugins/db.js",
      "options": {
        "database": "your-database-name"
      }
    }]
  },
  "services": [
    { "id": "service-a", "path": "./services/service-a" },
    { "id": "service-b", "path": "./services/service-b" }
  ]
}
```

## 3. Use in Your Services

Both services now have access to `app.mongo`:

```javascript
// services/service-a/routes/root.js
module.exports = async function (app) {
  app.get('/users', async (req, reply) => {
    const users = await app.mongo.db.collection('users').find().toArray()
    return users
  })
}
```

```javascript
// services/service-b/routes/root.js
module.exports = async function (app) {
  app.get('/orders', async (req, reply) => {
    const orders = await app.mongo.db.collection('orders').find().toArray()
    return orders
  })
}
```

## 4. Accessing Parent Runtime Decorators (Fallback)

With `encapsulate: false`, decorators should propagate automatically. However, if you still encounter issues (since Watt services run in their own Fastify instances), you can access the parent runtime decorators via `platformatic.root`:

```javascript
// Fallback: access via platformatic.root if direct access doesn't work
module.exports = async function (app) {
  const db = app.platformatic.root.mongo

  app.get('/data', async (req, reply) => {
    const result = await db.db.collection('data').find().toArray()
    return result
  })
}
```

## Directory Structure

```
my-watt-app/
├── watt.json
├── runtime-plugins/
│   └── db.js
├── services/
│   ├── service-a/
│   │   ├── platformatic.json
│   │   └── routes/
│   │       └── root.js
│   └── service-b/
│       ├── platformatic.json
│       └── routes/
│           └── root.js
└── .env
```

## Environment Variables

Make sure to set your MongoDB connection string:

```bash
# .env
MONGODB_URL=mongodb://localhost:27017
```

## Notes

- The shared plugin approach is ideal when you need direct database access from multiple services without HTTP overhead
- Connection pooling is handled by the MongoDB driver automatically
- All services share the same connection pool, which is more efficient than each service having its own connection
