import express from 'express';
import bcrypt from 'bcryptjs';
import Stripe from 'stripe';
import { pool } from '../config/db.js';
import logger from '../config/logger.js';
import { createToken } from '../middleware/auth.js';

const router = express.Router();

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null;

function toAuthUser(user) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.display_name,
    dealershipName: user.company_name,
    subscriptionStatus: user.subscription_status,
    trialEndsAt: user.trial_ends_at,
  };
}

/**
 * POST /api/auth/register
 */
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, dealershipName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'Email already registered' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const displayName = [firstName, lastName].filter(Boolean).join(' ').trim() || null;
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + 14);

    // Stripe is a nice-to-have for billing later, not a hard dependency
    // for account creation — never block signup on it being reachable.
    let stripeCustomerId = null;
    if (stripe) {
      try {
        const customer = await stripe.customers.create({ email, name: displayName || undefined });
        stripeCustomerId = customer.id;
      } catch (stripeErr) {
        logger.warn('Stripe customer creation failed (continuing without it):', stripeErr.message);
      }
    }

    const insertResult = await pool.query(
      `INSERT INTO users (
        email, password, password_hash, first_name, last_name, dealership_name,
        display_name, company_name, subscription_status, subscription_tier,
        trial_ends_at, stripe_customer_id
      ) VALUES ($1, $2, $2, $3, $4, $5, $6, $5, $7, $8, $9, $10)
      RETURNING *`,
      [
        email,
        passwordHash,
        firstName || null,
        lastName || null,
        dealershipName || null,
        displayName,
        'trial',
        'starter',
        trialEndsAt,
        stripeCustomerId,
      ]
    );

    const user = insertResult.rows[0];
    const token = createToken(user.id);

    logger.info(`🆕 New user registered: ${email}`);

    res.status(201).json({ token, user: toAuthUser(user) });
  } catch (error) {
    logger.error('Register error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/login
 */
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }

    const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const user = result.rows[0];
    const valid = await bcrypt.compare(password, user.password_hash || user.password);
    if (!valid) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }

    const token = createToken(user.id);

    logger.info(`✅ User logged in: ${email}`);

    res.json({ token, user: toAuthUser(user) });
  } catch (error) {
    logger.error('Login error:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/auth/logout
 */
router.post('/logout', (req, res) => {
  // JWTs are stateless — logout happens client-side by discarding the token.
  res.json({ message: 'Logged out successfully' });
});

export default router;
