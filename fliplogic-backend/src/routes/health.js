import express from 'express';
import { pool, redisClient } from '../server.js';

const router = express.Router();

/**
 * GET /api/health
 * Health check endpoint
 */
router.get('/', async (req, res) => {
  try {
    // Check database
    const dbCheck = await pool.query('SELECT NOW()');
    const dbHealthy = dbCheck.rows.length > 0;

    // Check Redis
    const redisHealthy = await redisClient.ping() === 'PONG';

    const status = dbHealthy && redisHealthy ? 'healthy' : 'degraded';

    res.status(dbHealthy && redisHealthy ? 200 : 503).json({
      status,
      timestamp: new Date().toISOString(),
      services: {
        database: dbHealthy ? 'up' : 'down',
        redis: redisHealthy ? 'up' : 'down',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString(),
    });
  }
});

export default router;
