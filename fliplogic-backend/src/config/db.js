import { Pool } from 'pg';
import { createClient } from 'redis';
import logger from './logger.js';

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

// Redis is a cache, not a dependency: if it's unset or unreachable, every
// caller already wraps its use in try/catch (comparable caching, health
// check), so a client that fails fast is safer than one that hangs the
// process waiting to connect.
function createRedisClient() {
  if (!process.env.REDIS_URL) {
    logger.warn('REDIS_URL not set — comparable caching disabled');
    return {
      isOpen: false,
      get: async () => null,
      setEx: async () => {},
      ping: async () => {
        throw new Error('Redis not configured');
      },
    };
  }

  const client = createClient({ url: process.env.REDIS_URL });
  client.on('error', (err) => logger.warn('Redis client error:', err.message));
  client.connect().catch((err) => logger.warn('Redis connect failed:', err.message));
  return client;
}

export const redisClient = createRedisClient();
