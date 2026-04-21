import express from 'express';
import Stripe from 'stripe';
import { pool } from '../server.js';
import logger from '../config/logger.js';
import { verifyAuthToken } from '../middleware/auth.js';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

/**
 * GET /api/subscriptions/status
 * Get subscription status
 */
router.get('/status', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT subscription_status, subscription_tier, subscription_end_date, trial_ends_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = result.rows[0];

    res.json({
      status: user.subscription_status,
      tier: user.subscription_tier,
      endDate: user.subscription_end_date,
      trialEndsAt: user.trial_ends_at,
    });
  } catch (error) {
    logger.error('Error fetching subscription status:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/upgrade
 * Upgrade subscription
 */
router.post('/upgrade', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { tier } = req.body;

    if (!['starter', 'pro', 'enterprise'].includes(tier)) {
      return res.status(400).json({ error: 'Invalid tier' });
    }

    // Get user
    const userResult = await pool.query(
      'SELECT stripe_customer_id, email FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const user = userResult.rows[0];

    // Create Stripe subscription
    const pricing = {
      starter: 'price_starter', // Replace with actual Stripe price IDs
      pro: 'price_pro',
      enterprise: 'price_enterprise',
    };

    const subscription = await stripe.subscriptions.create({
      customer: user.stripe_customer_id,
      items: [{ price: pricing[tier] }],
      payment_behavior: 'default_incomplete',
      expand: ['latest_invoice.payment_intent'],
    });

    // Update user in database
    await pool.query(
      `UPDATE users SET 
        subscription_tier = $1, 
        stripe_subscription_id = $2, 
        subscription_status = $3,
        subscription_start_date = NOW(),
        subscription_end_date = NOW() + INTERVAL '1 month'
       WHERE id = $4`,
      [tier, subscription.id, 'active', userId]
    );

    logger.info(`✅ Subscription upgraded: ${userId} to ${tier}`);

    res.json({
      subscriptionId: subscription.id,
      status: subscription.status,
      tier,
    });
  } catch (error) {
    logger.error('Error upgrading subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/cancel
 * Cancel subscription
 */
router.post('/cancel', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user
    const userResult = await pool.query(
      'SELECT stripe_subscription_id FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { stripe_subscription_id } = userResult.rows[0];

    if (!stripe_subscription_id) {
      return res.status(400).json({ error: 'No active subscription' });
    }

    // Cancel Stripe subscription
    await stripe.subscriptions.del(stripe_subscription_id);

    // Update user in database
    await pool.query(
      `UPDATE users SET 
        subscription_status = $1, 
        stripe_subscription_id = NULL
       WHERE id = $2`,
      ['cancelled', userId]
    );

    logger.info(`✅ Subscription cancelled: ${userId}`);

    res.json({ message: 'Subscription cancelled' });
  } catch (error) {
    logger.error('Error cancelling subscription:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/subscriptions/webhook
 * Stripe webhook handler
 */
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

  try {
    const event = stripe.webhooks.constructEvent(req.body, sig, endpointSecret);

    switch (event.type) {
      case 'customer.subscription.updated':
        // Handle subscription update
        await handleSubscriptionUpdate(event.data.object);
        break;

      case 'customer.subscription.deleted':
        // Handle subscription cancellation
        await handleSubscriptionCancellation(event.data.object);
        break;

      case 'invoice.payment_succeeded':
        // Handle payment success
        logger.info('Payment succeeded:', event.data.object.id);
        break;

      case 'invoice.payment_failed':
        // Handle payment failure
        logger.warn('Payment failed:', event.data.object.id);
        break;

      default:
        logger.info(`Unhandled event type: ${event.type}`);
    }

    res.json({ received: true });
  } catch (error) {
    logger.error('Webhook error:', error);
    res.status(400).send(`Webhook Error: ${error.message}`);
  }
});

// Helper functions
async function handleSubscriptionUpdate(subscription) {
  try {
    await pool.query(
      `UPDATE users SET 
        subscription_status = $1,
        subscription_end_date = $2
       WHERE stripe_subscription_id = $3`,
      [
        subscription.status,
        new Date(subscription.current_period_end * 1000),
        subscription.id,
      ]
    );

    logger.info(`✅ Subscription updated in DB: ${subscription.id}`);
  } catch (error) {
    logger.error('Error handling subscription update:', error);
  }
}

async function handleSubscriptionCancellation(subscription) {
  try {
    await pool.query(
      `UPDATE users SET 
        subscription_status = $1,
        stripe_subscription_id = NULL
       WHERE stripe_subscription_id = $2`,
      ['cancelled', subscription.id]
    );

    logger.info(`✅ Subscription cancelled in DB: ${subscription.id}`);
  } catch (error) {
    logger.error('Error handling subscription cancellation:', error);
  }
}

export default router;
