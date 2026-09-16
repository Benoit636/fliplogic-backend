import express from 'express';
import logger from '../config/logger.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { flipLogicAppraisalSchema, normalizeToUniversalAppraisal, toEngineInput } from '../schemas/flipLogicAppraisal.js';
import { buildBuyDecisionReport } from '../services/buyDecisionReport.js';
import { compareParity } from '../services/parityCompare.js';

const router = express.Router();

// Development-only tooling for the data-source independence work
// (Architecture Audit §9 / Phase 1 requirement 4, the parity harness).
// Both routes below run real appraisal data through the exact same
// production pipeline POST /api/appraisals/manual uses — same wire
// schema, same normalizeToUniversalAppraisal(), same toEngineInput(),
// same buildBuyDecisionReport() — but never touch the database. No
// duplicate Max Buy logic lives here.
//
// Hidden with a 404 (not 403) in production, rather than gated behind a
// role: this backend has no admin-role concept to gate behind yet, and a
// 404 doesn't even confirm the route exists on a production host.
function devOnly(req, res, next) {
  if (process.env.NODE_ENV === 'production') {
    return res.status(404).json({ error: 'Not found' });
  }
  next();
}

/**
 * POST /api/dev/parity/run
 * Body: a single FlipLogicAppraisal-shaped wire payload (the same shape
 * POST /api/appraisals/manual accepts, `source` optional).
 * Returns the full Buy Decision Report the real engine would produce, and
 * the intermediate Universal Appraisal it normalized to — no appraisal
 * row is created.
 */
router.post('/run', devOnly, verifyAuthToken, (req, res) => {
  try {
    const wireData = flipLogicAppraisalSchema.parse(req.body);
    const universalAppraisal = normalizeToUniversalAppraisal(wireData, 'manual');
    const engineInput = toEngineInput(universalAppraisal);
    const report = buildBuyDecisionReport(engineInput);
    res.json({ ok: true, universalAppraisal, report });
  } catch (error) {
    logger.error('Parity run failed:', error);
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/dev/parity/compare
 * Body: { testA, testB, tolerances? } — testA/testB are each a full wire
 * payload (e.g. testA = what the vAuto extension actually captured,
 * with source: 'vauto'; testB = the identical deal entered manually,
 * with source: 'manual'). `tolerances` is optional: e.g.
 * { "market.avg": 1 } to explicitly allow a documented, non-zero
 * tolerance on one normalized-schema or output field — every field
 * defaults to exact-match.
 *
 * Runs both through the identical normalize → engine pipeline and
 * returns the three-tier diff Phase 1 requirement 4 asks for: input
 * differences, normalized-schema differences, and output differences,
 * plus an overall pass/fail. See services/parityCompare.js.
 */
router.post('/compare', devOnly, verifyAuthToken, (req, res) => {
  try {
    const { testA, testB, tolerances } = req.body || {};
    if (!testA || !testB) {
      return res.status(400).json({ ok: false, error: 'Body must include both testA and testB' });
    }

    const wireA = flipLogicAppraisalSchema.parse(testA);
    const wireB = flipLogicAppraisalSchema.parse(testB);

    const universalA = normalizeToUniversalAppraisal(wireA, 'vauto');
    const universalB = normalizeToUniversalAppraisal(wireB, 'manual');

    const reportA = buildBuyDecisionReport(toEngineInput(universalA));
    const reportB = buildBuyDecisionReport(toEngineInput(universalB));

    const comparison = compareParity(wireA, wireB, universalA, universalB, reportA, reportB, { tolerances });

    logger.info(`Parity compare — VIN ${wireA.vin}: ${comparison.pass ? 'PASS' : 'FAIL'}`);

    res.json({
      ok: true,
      vin: wireA.vin,
      ...comparison,
      universalA,
      universalB,
      reportA,
      reportB,
    });
  } catch (error) {
    logger.error('Parity compare failed:', error);
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

export default router;
