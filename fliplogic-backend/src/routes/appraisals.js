import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool, redisClient } from '../config/db.js';
import logger from '../config/logger.js';
import { scrapeAutoTrader } from '../scrapers/autotrader.js';
import { verifyAuthToken } from '../middleware/auth.js';

const router = express.Router();

// Validation schemas
const createAppraisalSchema = z.object({
  vin: z.string().length(17, 'VIN must be 17 characters'),
  mileage: z.number().min(0).max(999999).optional(),
  appraisalType: z.enum(['on-site', 'sight-unseen']),
  conditionData: z.record(z.any()).optional(),
  customReconCost: z.number().min(0).max(999999).optional(),
  searchRadiusKm: z.number().min(0).max(1500).default(400),
});

/**
 * POST /api/appraisals
 * Create a new appraisal
 */
router.post('/', verifyAuthToken, async (req, res) => {
  try {
    const { vin, mileage, appraisalType, conditionData, customReconCost, searchRadiusKm } =
      createAppraisalSchema.parse(req.body);

    const userId = req.user.id;
    const appraisalId = uuidv4();

    // Check subscription status
    const userResult = await pool.query(
      'SELECT subscription_status FROM users WHERE id = $1',
      [userId]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const { subscription_status } = userResult.rows[0];
    if (!['trial', 'active'].includes(subscription_status)) {
      return res.status(403).json({ error: 'Subscription expired or inactive' });
    }

    // Parse VIN to get vehicle data
    let vehicleData;
    try {
      vehicleData = await parseVIN(vin);
    } catch (vinErr) {
      return res.status(400).json({ error: `Could not decode VIN: ${vinErr.message}` });
    }

    // Insert appraisal
    const insertResult = await pool.query(
      `INSERT INTO appraisals (
        id, user_id, vin, appraisal_type, vehicle_year, vehicle_make,
        vehicle_model, vehicle_mileage, condition_data, custom_recon_cost, search_radius_km, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        appraisalId,
        userId,
        vin,
        appraisalType,
        vehicleData.year,
        vehicleData.make,
        vehicleData.model,
        mileage ?? null,
        JSON.stringify(conditionData || {}),
        customReconCost || null,
        searchRadiusKm,
        'draft',
      ]
    );

    const appraisal = insertResult.rows[0];

    logger.info(`✅ Appraisal created: ${appraisalId} for user ${userId}`);

    res.status(201).json({
      id: appraisal.id,
      vin: appraisal.vin,
      status: appraisal.status,
      message: 'Appraisal created. Ready to analyze.',
    });
  } catch (error) {
    logger.error('Error creating appraisal:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * POST /api/appraisals/:id/analyze
 * Trigger appraisal analysis (scraping, AI analysis, calculations)
 */
router.post('/:id/analyze', verifyAuthToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Fetch appraisal
    const appraisalResult = await pool.query(
      'SELECT * FROM appraisals WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (appraisalResult.rows.length === 0) {
      return res.status(404).json({ error: 'Appraisal not found' });
    }

    const appraisal = appraisalResult.rows[0];

    // Check cache for comparables
    const cacheKey = `comps:${appraisal.vehicle_year}_${appraisal.vehicle_make}_${appraisal.vehicle_model}:${appraisal.search_radius_km}`;
    let comparables = null;

    try {
      const cachedComps = await redisClient.get(cacheKey);
      if (cachedComps) {
        comparables = JSON.parse(cachedComps);
        logger.info(`📦 Using cached comparables for ${cacheKey}`);
      }
    } catch (cacheErr) {
      logger.warn('Cache retrieval failed:', cacheErr);
    }

    // If not cached, scrape
    if (!comparables) {
      logger.info(`🔍 Scraping comparables for ${appraisal.vehicle_make} ${appraisal.vehicle_model}...`);

      comparables = await scrapeAutoTrader(appraisal.vin, {
        year: appraisal.vehicle_year,
        make: appraisal.vehicle_make,
        model: appraisal.vehicle_model,
        mileage: appraisal.vehicle_mileage || 0,
        radiusKm: appraisal.search_radius_km,
      });

      // Cache for 1 hour
      try {
        await redisClient.setEx(cacheKey, 3600, JSON.stringify(comparables));
      } catch (cacheErr) {
        logger.warn('Cache set failed:', cacheErr);
      }
    }

    if (comparables.length === 0) {
      return res.status(400).json({ error: 'No comparable vehicles found. Try increasing search radius.' });
    }

    // Calculate costs
    const { acquisitionCost, reconCost, marketValue } = calculateCosts(
      comparables,
      appraisal.custom_recon_cost
    );

    // Generate pricing strategy
    const pricingStrategy = generatePricingStrategy(
      acquisitionCost,
      reconCost,
      marketValue
    );

    // Update appraisal with results
    const updateResult = await pool.query(
      `UPDATE appraisals SET
        acquisition_cost = $1,
        market_value = $2,
        system_recon_estimate = $3,
        comps_analyzed = $4,
        comps_data = $5,
        pricing_strategy = $6,
        status = $7
      WHERE id = $8
      RETURNING *`,
      [
        acquisitionCost,
        marketValue,
        reconCost,
        comparables.length,
        JSON.stringify(comparables),
        JSON.stringify(pricingStrategy),
        'complete',
        id,
      ]
    );

    const updatedAppraisal = updateResult.rows[0];

    logger.info(`✅ Appraisal analyzed: ${id}`);

    res.json({
      appraisal: updatedAppraisal,
      pricingStrategy,
      analysis: {
        acquisitionCost,
        reconCost,
        marketValue,
        totalInvestment: acquisitionCost + reconCost,
        comparablesAnalyzed: comparables.length,
      },
    });
  } catch (error) {
    logger.error('Error analyzing appraisal:', error);
    res.status(error.status || 500).json({ error: error.message });
  }
});

/**
 * GET /api/appraisals/:id
 * Get appraisal details
 */
router.get('/:id', verifyAuthToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const result = await pool.query(
      'SELECT * FROM appraisals WHERE id = $1 AND user_id = $2',
      [id, userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Appraisal not found' });
    }

    const appraisal = result.rows[0];

    if (appraisal.status !== 'complete') {
      return res.json({ appraisal, pricingStrategy: null, analysis: null });
    }

    const acquisitionCost = Number(appraisal.acquisition_cost);
    const reconCost = Number(appraisal.custom_recon_cost || appraisal.system_recon_estimate);

    res.json({
      appraisal,
      pricingStrategy: appraisal.pricing_strategy,
      analysis: {
        acquisitionCost,
        reconCost,
        marketValue: Number(appraisal.market_value),
        totalInvestment: acquisitionCost + reconCost,
        comparablesAnalyzed: appraisal.comps_analyzed,
      },
    });
  } catch (error) {
    logger.error('Error fetching appraisal:', error);
    res.status(500).json({ error: error.message });
  }
});

/**
 * GET /api/appraisals
 * List all appraisals for user
 */
router.get('/', verifyAuthToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 100);
    const offset = parseInt(req.query.offset) || 0;

    const result = await pool.query(
      `SELECT * FROM appraisals 
       WHERE user_id = $1 AND deleted_at IS NULL
       ORDER BY created_at DESC
       LIMIT $2 OFFSET $3`,
      [userId, limit, offset]
    );

    const countResult = await pool.query(
      'SELECT COUNT(*) FROM appraisals WHERE user_id = $1',
      [userId]
    );

    res.json({
      appraisals: result.rows,
      total: parseInt(countResult.rows[0].count),
      limit,
      offset,
    });
  } catch (error) {
    logger.error('Error listing appraisals:', error);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

async function parseVIN(vin) {
  const response = await fetch(
    `https://vpic.nhtsa.dot.gov/api/vehicles/decodevinvalues/${encodeURIComponent(vin)}?format=json`
  );

  if (!response.ok) {
    throw new Error(`VIN decode service returned status ${response.status}`);
  }

  const data = await response.json();
  const result = data.Results?.[0] || {};

  const year = parseInt(result.ModelYear, 10);
  const make = result.Make || '';
  const model = result.Model || '';

  // Year and Make come from fixed VIN-position tables and are reliable on
  // any clean decode. Model depends on the manufacturer's own data
  // submission to NHTSA and is legitimately blank even on an otherwise
  // clean decode (NHTSA ErrorCode 14) — don't reject the VIN for that.
  if (!year || !make) {
    throw new Error('Unable to decode year and make from this VIN');
  }
  if (!model) {
    logger.warn(`VIN ${vin} decoded without a Model (NHTSA: ${result.ErrorText || 'no model data'})`);
  }

  return { year, make, model };
}

// Used when the dealer doesn't provide their own recon cost estimate.
// Matches the old condition-questionnaire's cost when every question was
// left at its default ("good": $500 base detailing + 10% margin).
const DEFAULT_RECON_COST = 550;

function calculateCosts(comparables, customReconCost = null) {
  if (comparables.length === 0) {
    throw new Error('No comparables to analyze');
  }

  // Market value is the median retail asking price of comparables — what
  // this vehicle should sell for, not what it should cost to buy.
  const prices = comparables.map((c) => c.price).filter((p) => p > 0);
  const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  const marketValue = medianPrice;

  // node-postgres returns NUMERIC columns as strings to avoid precision
  // loss, so custom_recon_cost comes back as e.g. "1500", not 1500. Left
  // uncoerced, arithmetic below string-concatenates instead of adding
  // (34388 + "1500" -> "343881500"), which then gets multiplied into
  // wildly wrong numbers.
  const reconCost = customReconCost != null ? Number(customReconCost) : DEFAULT_RECON_COST;

  // Acquisition cost is a buying target, not the retail price: reserve a
  // target profit (15% of market value) and the recon budget out of market
  // value, and whatever's left is the most this vehicle should cost to
  // acquire. Paying full market value (the old behavior) left no room to
  // profit after recon.
  const targetProfit = marketValue * 0.15;
  const acquisitionCost = Math.round(marketValue - reconCost - targetProfit);

  return {
    acquisitionCost,
    reconCost,
    marketValue,
  };
}

function generatePricingStrategy(acquisitionCost, reconCost, marketValue) {
  const totalInvestment = acquisitionCost + reconCost;

  return {
    day0to20: {
      price: Math.round(totalInvestment * 1.1),
      profitMargin: 0.1,
      profit: Math.round(totalInvestment * 0.1),
    },
    day21to30: {
      price: Math.round(totalInvestment * 1.05),
      profitMargin: 0.05,
      profit: Math.round(totalInvestment * 0.05),
    },
    day31plus: {
      price: Math.round(totalInvestment * 1.02),
      profitMargin: 0.02,
      profit: Math.round(totalInvestment * 0.02),
    },
  };
}

export default router;
