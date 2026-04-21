import express from 'express';
import { pool } from '../server.js';
import logger from '../config/logger.js';
import { verifyAuthToken } from '../middleware/auth.js';

const router = express.Router();

/**
 * GET /api/users/me
 * Get current user profile
 */
router.get('/me', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT id, email, display_name, company_name, phone_number, 
              subscription_status, subscription_tier, trial_ends_at, profile_image_url,
              created_at, updated_at
       FROM users WHERE id = $1`,
      [userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching user:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/users/me
 * Update user profile
 */
router.patch('/me', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { displayName, companyName, phoneNumber } = req.body;

    const result = await pool.query(
      `UPDATE users SET 
        display_name = COALESCE($1, display_name),
        company_name = COALESCE($2, company_name),
        phone_number = COALESCE($3, phone_number),
        updated_at = NOW()
       WHERE id = $4
       RETURNING id, email, display_name, company_name, phone_number, updated_at`,
      [displayName, companyName, phoneNumber, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    logger.info(`✅ User updated: ${userId}`);

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error updating user:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/users/stats
 * Get user statistics
 */
router.get('/stats', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Total appraisals
    const appraisalsCount = await pool.query(
      'SELECT COUNT(*) FROM appraisals WHERE user_id = $1 AND deleted_at IS NULL',
      [userId]
    );

    // Active listings
    const listingsCount = await pool.query(
      'SELECT COUNT(*) FROM listings WHERE user_id = $1 AND status = $2',
      [userId, 'active']
    );

    // Sold vehicles
    const soldCount = await pool.query(
      'SELECT COUNT(*) FROM listings WHERE user_id = $1 AND status = $2',
      [userId, 'sold']
    );

    // Total profit
    const profitResult = await pool.query(
      'SELECT SUM(profit_loss) as total_profit FROM listings WHERE user_id = $1 AND status = $2',
      [userId, 'sold']
    );

    res.json({
      totalAppraisals: parseInt(appraisalsCount.rows[0].count),
      activeListings: parseInt(listingsCount.rows[0].count),
      soldVehicles: parseInt(soldCount.rows[0].count),
      totalProfit: profitResult.rows[0].total_profit || 0,
    });
  } catch (error) {
    logger.error('Error fetching user stats:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
