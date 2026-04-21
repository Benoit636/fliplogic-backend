import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../server.js';
import logger from '../config/logger.js';
import { createToken } from '../middleware/auth.js';
import Stripe from 'stripe';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * POST /api/auth/login
 * Handle OAuth callback and create/update user
 */
router.post('/login', async (req, res) => {
  try {
    const { firebaseUid, email, displayName, photoUrl } = req.body;

    if (!firebaseUid || !email) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Check if user exists
    let userResult = await pool.query(
      'SELECT * FROM users WHERE firebase_uid = $1',
      [firebaseUid]
    );

    let user;

    if (userResult.rows.length === 0) {
      // New user - create account with trial
      const userId = uuidv4();
      const trialEndsAt = new Date();
      trialEndsAt.setDate(trialEndsAt.getDate() + 14); // 14-day trial

      // Create Stripe customer
      const stripeCustomer = await stripe.customers.create({
        email,
        name: displayName,
        metadata: { firebase_uid: firebaseUid },
      });

      const insertResult = await pool.query(
        `INSERT INTO users (
          id, email, firebase_uid, display_name, profile_image_url,
          subscription_status, subscription_tier, trial_ends_at,
          stripe_customer_id, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING id, email, subscription_status, trial_ends_at`,
        [
          userId,
          email,
          firebaseUid,
          displayName || 'User',
          photoUrl || null,
          'trial',
          'starter',
          trialEndsAt,
          stripeCustomer.id,
          new Date(),
        ]
      );

      user = insertResult.rows[0];
      logger.info(`🆕 New user created: ${email}`);
    } else {
      // Existing user
      user = userResult.rows[0];
    }

    // Create JWT token
    const token = createToken(user.id);

    logger.info(`✅ User logged in: ${email}`);

    res.json({
      user: {
        id: user.id,
        email: user.email,
        subscriptionStatus: user.subscription_status,
        trialEndsAt: user.trial_ends_at,
      },
      token,
      expiresIn: '7d',
    });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/logout
 * Logout user (invalidate token on client)
 */
router.post('/logout', (req, res) => {
  // JWT tokens are stateless, logout happens on client
  // In production, you might want to maintain a blacklist
  res.json({ message: 'Logged out successfully' });
});

/**
 * POST /api/auth/refresh
 * Refresh JWT token
 */
router.post('/refresh', (req, res) => {
  try {
    const { refreshToken } = req.body;

    if (!refreshToken) {
      return res.status(400).json({ error: 'Refresh token required' });
    }

    // Verify refresh token and issue new access token
    // Implementation depends on your refresh token strategy

    res.json({ error: 'Not implemented' });
  } catch (error) {
    logger.error('Refresh token error:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
