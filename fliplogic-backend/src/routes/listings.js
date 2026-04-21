import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../server.js';
import logger from '../config/logger.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { sendSellerAppraisalEmail } from '../services/email.js';

const router = express.Router();

/**
 * POST /api/listings
 * Create listing from appraisal
 */
router.post('/', verifyAuthToken, async (req, res) => {
  try {
    const { appraisalId } = req.body;
    const userId = req.user.id;

    // Fetch appraisal
    const appraisalResult = await pool.query(
      'SELECT * FROM appraisals WHERE id = $1 AND user_id = $2',
      [appraisalId, userId]
    );

    if (appraisalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appraisal not found' });
    }

    const appraisal = appraisalResult.rows[0];

    if (appraisal.status !== 'complete') {
      return res.status(400).json({ error: 'Appraisal must be complete before listing' });
    }

    // Calculate pricing
    const totalInvestment = appraisal.acquisition_cost + (appraisal.custom_recon_cost || appraisal.system_recon_estimate);
    const day0to20Price = Math.round(totalInvestment * 1.1);
    const day21to30Price = Math.round(totalInvestment * 1.05);
    const day31PlusPrice = Math.round(totalInvestment * 1.02);

    // Create listing
    const listingId = uuidv4();
    const insertResult = await pool.query(
      `INSERT INTO listings (
        id, appraisal_id, user_id, vin, day_0_20_price, day_21_30_price,
        day_31_plus_price, current_price, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        listingId,
        appraisalId,
        userId,
        appraisal.vin,
        day0to20Price,
        day21to30Price,
        day31PlusPrice,
        day0to20Price,
        'active',
      ]
    );

    const listing = insertResult.rows[0];

    logger.info(`✅ Listing created: ${listingId}`);

    res.status(201).json(listing);
  } catch (error) {
    logger.error('Error creating listing:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/listings
 * Get all listings for user
 */
router.get('/', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const status = req.query.status || 'active';
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT l.*, a.vehicle_year, a.vehicle_make, a.vehicle_model
       FROM listings l
       JOIN appraisals a ON l.appraisal_id = a.id
       WHERE l.user_id = $1 AND l.status = $2
       ORDER BY l.created_at DESC
       LIMIT $3 OFFSET $4`,
      [userId, status, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM listings WHERE user_id = $1 AND status = $2',
      [userId, status]
    );

    res.json({
      listings: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Error fetching listings:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/listings/:id
 * Get specific listing
 */
router.get('/:id', verifyAuthToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT l.*, a.vehicle_year, a.vehicle_make, a.vehicle_model, a.photos
       FROM listings l
       JOIN appraisals a ON l.appraisal_id = a.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    logger.error('Error fetching listing:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * POST /api/listings/:id/send-seller-email
 * Send appraisal email to seller
 */
router.post('/:id/send-seller-email', verifyAuthToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { sellerEmail } = req.body;
    const userId = req.user.id;

    if (!sellerEmail) {
      return res.status(400).json({ error: 'Seller email required' });
    }

    // Fetch listing and appraisal
    const listingResult = await pool.query(
      `SELECT l.*, a.* FROM listings l
       JOIN appraisals a ON l.appraisal_id = a.id
       WHERE l.id = $1 AND l.user_id = $2`,
      [id, userId]
    );

    if (listingResult.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    const listing = listingResult.rows[0];

    // Get user (dealer) info
    const userResult = await pool.query(
      'SELECT company_name, email FROM users WHERE id = $1',
      [userId]
    );

    const dealer = userResult.rows[0];

    // Send email
    await sendSellerAppraisalEmail({
      sellerEmail,
      dealerName: dealer.company_name || 'FlipLogic Dealer',
      dealerEmail: dealer.email,
      appraisal: {
        year: listing.vehicle_year,
        make: listing.vehicle_make,
        model: listing.vehicle_model,
        mileage: listing.vehicle_mileage,
        acquisitionCost: listing.acquisition_cost,
        reconCost: listing.custom_recon_cost || listing.system_recon_estimate,
        marketValue: listing.market_value,
      },
    });

    // Log email sent
    await pool.query(
      `INSERT INTO email_logs (listing_id, seller_email, email_type, status)
       VALUES ($1, $2, $3, $4)`,
      [id, sellerEmail, 'appraisal', 'sent']
    );

    logger.info(`✅ Seller email sent to ${sellerEmail}`);

    res.json({ message: 'Email sent successfully' });
  } catch (error) {
    logger.error('Error sending seller email:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * PATCH /api/listings/:id
 * Update listing status
 */
router.patch('/:id', verifyAuthToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status, actualSalePrice, actualSaleDate, actualReconCost } = req.body;
    const userId = req.user.id;

    // Calculate profit/loss if sale info provided
    let profitLoss = null;
    if (actualSalePrice) {
      const result = await pool.query(
        `SELECT acquisition_cost FROM appraisals
         WHERE id = (SELECT appraisal_id FROM listings WHERE id = $1)`,
        [id]
      );

      const appraisal = result.rows[0];
      const reconCost = actualReconCost || 0;
      profitLoss = actualSalePrice - appraisal.acquisition_cost - reconCost;
    }

    const updateResult = await pool.query(
      `UPDATE listings SET status = $1, actual_sale_price = $2, actual_sale_date = $3, actual_recon_cost = $4, profit_loss = $5
       WHERE id = $6 AND user_id = $7
       RETURNING *`,
      [status, actualSalePrice, actualSaleDate, actualReconCost, profitLoss, id, userId]
    );

    if (updateResult.rows.length === 0) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    logger.info(`✅ Listing updated: ${id}`);

    res.json(updateResult.rows[0]);
  } catch (error) {
    logger.error('Error updating listing:', error);
    res.status(500).json({ error: error.message });
  }
});

export default router;
