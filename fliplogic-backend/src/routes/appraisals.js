import express from 'express';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { pool, redisClient } from '../server.js';
import logger from '../config/logger.js';
import { scrapeAutoTrader } from '../scrapers/autotrader.js';
import { analyzeWithOpenAI } from '../services/openai.js';
import { verifyAuthToken } from '../middleware/auth.js';

const router = express.Router();

// Validation schemas
const createAppraisalSchema = z.object({
  vin: z.string().length(17, 'VIN must be 17 characters'),
  appraisalType: z.enum(['on-site', 'sight-unseen']),
  conditionData: z.record(z.any()).optional(),
  customReconCost: z.number().positive().optional(),
  searchRadiusKm: z.number().min(0).max(1500).default(400),
});

/**
 * POST /api/appraisals
 * Create a new appraisal
 */
router.post('/', verifyAuthToken, async (req, res) => {
  try {
    const { vin, appraisalType, conditionData, customReconCost, searchRadiusKm } =
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
    const vehicleData = parseVIN(vin);

    // Insert appraisal
    const insertResult = await pool.query(
      `INSERT INTO appraisals (
        id, user_id, vin, appraisal_type, vehicle_year, vehicle_make, 
        vehicle_model, condition_data, custom_recon_cost, search_radius_km, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        appraisalId,
        userId,
        vin,
        appraisalType,
        vehicleData.year,
        vehicleData.make,
        vehicleData.model,
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
      appraisal.condition_data,
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
        status = $6
      WHERE id = $7
      RETURNING *`,
      [
        acquisitionCost,
        marketValue,
        reconCost,
        comparables.length,
        JSON.stringify(comparables),
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
        reconCost: updatedAppraisal.custom_recon_cost || reconCost,
        marketValue,
        totalInvestment: acquisitionCost + (updatedAppraisal.custom_recon_cost || reconCost),
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

    res.json(result.rows[0]);
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

function parseVIN(vin) {
  // Simplified VIN parsing - in production, use a proper library
  // This is just a placeholder
  return {
    year: parseInt(vin.substring(9, 10)) + 2000 || null,
    make: '',
    model: '',
  };
}

function calculateCosts(comparables, conditionData = {}, customReconCost = null) {
  if (comparables.length === 0) {
    throw new Error('No comparables to analyze');
  }

  // Calculate average price from comparables
  const prices = comparables.map((c) => c.price).filter((p) => p > 0);
  const medianPrice = prices.sort((a, b) => a - b)[Math.floor(prices.length / 2)];

  // Apply condition discount
  const discount = calculateConditionDiscount(conditionData);
  const acquisitionCost = Math.round(medianPrice * (1 - discount));

  // Calculate recon cost (if not custom)
  let reconCost = customReconCost;
  if (!reconCost) {
    reconCost = calculateReconCost(conditionData);
  }

  // Market value is median of comparables
  const marketValue = medianPrice;

  return {
    acquisitionCost,
    reconCost,
    marketValue,
  };
}

function calculateConditionDiscount(conditionData) {
  if (!conditionData) return 0;

  const discountMap = {
    good: 0,
    fair: 0.075,
    poor: 0.20,
  };

  let totalDiscount = 0;
  let count = 0;

  Object.values(conditionData).forEach((condition) => {
    if (condition in discountMap) {
      totalDiscount += discountMap[condition];
      count++;
    }
  });

  return count > 0 ? totalDiscount / count : 0;
}

function calculateReconCost(conditionData = {}) {
  const costs = {
    paint: { good: 0, fair: 500, poor: 1500 },
    tires: { good: 0, fair: 400, poor: 800 },
    brakes: { good: 0, fair: 300, poor: 600 },
    glass: { good: 0, fair: 200, poor: 600 },
    body: { good: 0, fair: 800, poor: 2000 },
    interior: { good: 0, fair: 400, poor: 1200 },
  };

  let totalCost = 500; // Base detailing

  Object.entries(conditionData).forEach(([key, value]) => {
    if (key in costs && value in costs[key]) {
      totalCost += costs[key][value];
    }
  });

  return Math.round(totalCost * 1.1); // Add 10% margin
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
