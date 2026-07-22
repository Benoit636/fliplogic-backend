import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

import logger from './config/logger.js';
import authRoutes from './routes/auth.js';
import appraisalsRoutes from './routes/appraisals.js';
import usersRoutes from './routes/users.js';
import listingsRoutes from './routes/listings.js';
import subscriptionsRoutes from './routes/subscriptions.js';
import healthRoutes from './routes/health.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

logger.info(`DATABASE_URL: ${process.env.DATABASE_URL ? 'SET' : 'NOT SET'}`);

app.use(cors({
  origin: process.env.FRONTEND_URL || '*',
  credentials: true,
}));

// Stripe webhooks verify a signature over the exact raw request body, so
// the webhook route (which applies its own express.raw() middleware)
// must be excluded from this global JSON parser.
app.use((req, res, next) => {
  if (req.originalUrl === '/api/subscriptions/webhook') return next();
  express.json()(req, res, next);
});

app.use('/api/health', healthRoutes);
app.use('/api/auth', authRoutes);
app.use('/api/appraisals', appraisalsRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/listings', listingsRoutes);
app.use('/api/subscriptions', subscriptionsRoutes);

app.use((err, req, res, next) => {
  logger.error('Unhandled error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info(`FlipLogic API running on port ${PORT}`);
});
