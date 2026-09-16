import express from 'express';
import logger from '../config/logger.js';
import { verifyAuthToken } from '../middleware/auth.js';
import { flipLogicAppraisalSchema, toEngineInput } from '../schemas/flipLogicAppraisal.js';
import { buildBuyDecisionReport } from '../services/buyDecisionReport.js';
import { compareReports } from '../services/parityCompare.js';

const router = express.Router();

// Development-only tooling for the data-source independence work
// (Architecture Audit §9, "manual input test mode" / parity harness). Both
// routes below run real appraisal data through the exact same production
// engine POST /api/appraisals/manual uses — same schema, same
// toEngineInput(), same buildBuyDecisionReport() — but never touch the
// database. No duplicate Max Buy logic lives here.
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
 * Body: a single FlipLogicAppraisal-shaped payload (the same shape
 * POST /api/appraisals/manual accepts).
 * Returns the full Buy Decision Report the real engine would produce —
 * no appraisal row is created.
 */
router.post('/run', devOnly, verifyAuthToken, (req, res) => {
  try {
    const data = flipLogicAppraisalSchema.parse(req.body);
    const { engineInput } = toEngineInput(data);
    const report = buildBuyDecisionReport(engineInput);
    res.json({ ok: true, report });
  } catch (error) {
    logger.error('Parity run failed:', error);
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

/**
 * POST /api/dev/parity/compare
 * Body: { testA, testB, tolerances? } — testA/testB are each a full
 * FlipLogicAppraisal payload (e.g. testA = what the vAuto extension
 * actually captured, testB = the identical deal entered manually).
 * `tolerances` is optional: { "profitCalculation.recommendedMaxBuyPrice": 1 }
 * to explicitly allow a documented, non-zero tolerance on one field —
 * every field defaults to exact-match.
 *
 * Runs both through the identical engine call and diffs exactly the
 * fields Phase 5 asks for — see services/parityCompare.js.
 */
router.post('/compare', devOnly, verifyAuthToken, (req, res) => {
  try {
    const { testA, testB, tolerances } = req.body || {};
    if (!testA || !testB) {
      return res.status(400).json({ ok: false, error: 'Body must include both testA and testB' });
    }

    const parsedA = flipLogicAppraisalSchema.parse(testA);
    const parsedB = flipLogicAppraisalSchema.parse(testB);

    const reportA = buildBuyDecisionReport(toEngineInput(parsedA).engineInput);
    const reportB = buildBuyDecisionReport(toEngineInput(parsedB).engineInput);

    const comparison = compareReports(reportA, reportB, { tolerances });

    logger.info(`Parity compare — VIN ${parsedA.vin}: ${comparison.pass ? 'PASS' : 'FAIL'}`);

    res.json({
      ok: true,
      vin: parsedA.vin,
      ...comparison,
      reportA,
      reportB,
    });
  } catch (error) {
    logger.error('Parity compare failed:', error);
    res.status(error.status || 400).json({ ok: false, error: error.message });
  }
});

export default router;
