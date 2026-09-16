import { z } from 'zod';

/**
 * The universal FlipLogic appraisal contract.
 *
 * This is not a new shape — it's the payload manual entry and the vAuto
 * Capture extension already both send to POST /api/appraisals/manual,
 * moved here and given a name. Every field below existed, unchanged, in
 * the inline schema that used to live in routes/appraisals.js.
 *
 * The acquisition engine (services/buyDecisionReport.js) never sees this
 * object directly — toEngineInput() below flattens it to the engine's own
 * argument shape, exactly as routes/appraisals.js did inline before this
 * file existed. The engine's signature, and every formula inside it, is
 * unchanged by this refactor.
 *
 * Optional fields use .nullish() rather than .optional(): callers like the
 * FlipLogic Capture extension send an explicit `null` (not an omitted key)
 * when a field genuinely has no value on the source page (e.g. no Black
 * Book condition checkbox selected), and .optional() alone rejects that.
 */
export const flipLogicAppraisalSchema = z
  .object({
    vin: z.string().length(17, 'VIN must be 17 characters'),
    year: z.number().int().min(1980).max(new Date().getFullYear() + 1),
    make: z.string().trim().min(1, 'Make is required'),
    model: z.string().trim().min(1, 'Model is required'),
    trim: z.string().trim().max(100).nullish(),
    mileage: z.number().min(0).max(999999).nullish(),
    condition: z.enum(['excellent', 'good', 'average', 'rough']).nullish(),
    appraisalToolValue: z.number().min(0).max(999999).nullish(),
    lowRetail: z.number().min(0).max(999999),
    avgRetail: z.number().min(0).max(999999),
    highRetail: z.number().min(0).max(999999),
    comparableCount: z.number().int().min(0).max(999).nullish(),
    estimatedReconCost: z.number().min(0).max(999999).nullish(),
    targetGrossProfit: z.number().min(0).max(999999).nullish(),
    targetGrossProfitMode: z.enum(['dollar', 'percentage']).nullish(),
    notes: z.string().max(2000).nullish(),
    knownRisks: z.string().max(2000).nullish(),
  })
  .refine(
    (data) => data.targetGrossProfitMode !== 'percentage' || data.targetGrossProfit == null || data.targetGrossProfit <= 100,
    { message: 'Target gross profit percentage must be 100 or less', path: ['targetGrossProfit'] }
  )
  .refine((data) => data.lowRetail <= data.avgRetail && data.avgRetail <= data.highRetail, {
    message: 'Retail values must satisfy low ≤ average ≤ high',
    path: ['avgRetail'],
  });

/**
 * Flattens a validated FlipLogicAppraisal into buildBuyDecisionReport()'s
 * own argument shape. This is the one place that's allowed to know both
 * shapes — the engine stays ignorant of where the data came from, and this
 * function stays ignorant of recon/confidence/verdict math.
 *
 * Pulled verbatim out of the POST /manual route handler; behavior is
 * unchanged.
 */
export function toEngineInput(data) {
  const targetGrossProfitMode = data.targetGrossProfit != null ? (data.targetGrossProfitMode || 'dollar') : null;

  return {
    engineInput: {
      vin: data.vin,
      year: data.year,
      make: data.make,
      model: data.model,
      trim: data.trim || null,
      mileage: data.mileage ?? null,
      condition: data.condition || null,
      retailData: {
        low: data.lowRetail,
        avg: data.avgRetail,
        high: data.highRetail,
        comparableCount: data.comparableCount ?? null,
      },
      appraisalToolValue: data.appraisalToolValue ?? null,
      customReconCost: data.estimatedReconCost ?? null,
      targetGrossProfit: data.targetGrossProfit ?? null,
      targetGrossProfitMode,
      notes: data.notes || null,
      knownRisks: data.knownRisks || null,
    },
    targetGrossProfitMode,
  };
}
