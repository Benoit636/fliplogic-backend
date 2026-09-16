import { z } from 'zod';

/**
 * =============================================================================
 * STAGE 1 — the wire/transport shape.
 * =============================================================================
 *
 * This is the flat JSON body both the vAuto Capture extension and the
 * manual-entry form POST to /api/appraisals/manual. Every field, rule, and
 * refinement here is unchanged from before the Phase 1 independence work —
 * this file only adds a normalization step downstream of it, it does not
 * change what's accepted at the wire.
 *
 * `source` is the one new field, and it is optional and inert at this
 * stage — parsing never uses it for anything. It exists purely so
 * normalizeToUniversalAppraisal() below has honest provenance to record.
 * A request that omits it (an older cached extension build, for instance)
 * still parses exactly as it always has.
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
    // Transport metadata only — see the hard rule in
    // normalizeToUniversalAppraisal()'s doc comment below. Not one of the
    // 'future values' (accutrade/carfax/blackbook/dms/api) yet; those
    // aren't implemented and shouldn't validate here until they are.
    source: z.enum(['vauto', 'manual']).nullish(),
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
 * =============================================================================
 * STAGE 2 — the Universal FlipLogic Appraisal Schema.
 * =============================================================================
 *
 * Both intake paths normalize into this exact shape before anything
 * reaches the acquisition engine:
 *
 *   vAuto Adapter → flipLogicAppraisalSchema → normalizeToUniversalAppraisal() → toEngineInput() → buildBuyDecisionReport()
 *   Manual Entry  → flipLogicAppraisalSchema → normalizeToUniversalAppraisal() → toEngineInput() → buildBuyDecisionReport()
 *
 * There is one normalizer, called identically by both paths (they already
 * produce the same wire shape — see routes/appraisals.js) — not two
 * parallel implementations that happen to agree.
 *
 * Room for richer condition data, per the audit's Phase 1 scope: every
 * field below that has no current source (exterior/interior condition,
 * damage, tires, brakes, glass, mechanical, warning lights, equipment,
 * history, photos) is always explicit `null`. Nothing here infers,
 * defaults, or fabricates a value for them — a vehicle FlipLogic has no
 * data on is unknown, never "good." Wiring a real source for any of these
 * is Phase 2+ work, not this file's job.
 *
 * dataQuality / missingness is deliberately NOT computed here, even
 * though the audit's original proposal sketched a `dataQuality` field —
 * buildBuyDecisionReport() already computes the authoritative missing-data
 * list (riskAndConfidence.missingData) from these same inputs, and
 * duplicating that logic pre-engine would create two definitions of
 * "missing" that could drift apart. One engine means one place that
 * decides what counts as missing, too.
 *
 * @typedef {'vauto'|'manual'} AppraisalSourceType
 *
 * @typedef {object} FlipLogicAppraisal
 * @property {{ type: AppraisalSourceType }} source
 * @property {{ vin: string, year: number, make: string, model: string, trim: string|null, mileage: number|null }} vehicle
 * @property {{ overall: string|null, exterior: null, interior: null, damage: null, tires: null, brakes: null, glass: null, mechanical: null, warningLights: null }} condition
 * @property {null} history
 * @property {{ drivetrain: null, engine: null, transmission: null }} equipment
 * @property {null} photos
 * @property {{ low: number, avg: number, high: number, comparableCount: number|null }} market
 * @property {{ estimate: number|null }} recon
 * @property {{ appraisalToolValue: number|null, targetGrossProfit: number|null, targetGrossProfitMode: 'dollar'|'percentage'|null }} dealerEconomics
 * @property {{ notes: string|null, knownRisks: string|null }} appraisalContext
 *
 * @param {object} wireData - already validated by flipLogicAppraisalSchema
 * @param {AppraisalSourceType} [fallbackSource] - used only when wireData.source is absent (older callers)
 * @returns {FlipLogicAppraisal}
 */
export function normalizeToUniversalAppraisal(wireData, fallbackSource = 'manual') {
  return {
    source: { type: wireData.source || fallbackSource },

    vehicle: {
      vin: wireData.vin,
      year: wireData.year,
      make: wireData.make,
      model: wireData.model,
      trim: wireData.trim || null,
      mileage: wireData.mileage ?? null,
    },

    condition: {
      overall: wireData.condition || null,
      // Not sourced by anything yet — see the class-D/C gaps in the
      // architecture audit (§2/§4). Explicit null, not inferred.
      exterior: null,
      interior: null,
      damage: null,
      tires: null,
      brakes: null,
      glass: null,
      mechanical: null,
      warningLights: null,
    },

    // No accident/title history source exists anywhere in FlipLogic today
    // (audit §2) — always null, never "clean" by default.
    history: null,

    equipment: {
      drivetrain: null,
      engine: null,
      transmission: null,
    },

    // No photo capture/transmission path exists yet (audit §2).
    photos: null,

    market: {
      low: wireData.lowRetail,
      avg: wireData.avgRetail,
      high: wireData.highRetail,
      comparableCount: wireData.comparableCount ?? null,
    },

    recon: {
      estimate: wireData.estimatedReconCost ?? null,
    },

    dealerEconomics: {
      appraisalToolValue: wireData.appraisalToolValue ?? null,
      targetGrossProfit: wireData.targetGrossProfit ?? null,
      targetGrossProfitMode: wireData.targetGrossProfit != null ? (wireData.targetGrossProfitMode || 'dollar') : null,
    },

    appraisalContext: {
      notes: wireData.notes || null,
      knownRisks: wireData.knownRisks || null,
    },
  };
}

/**
 * =============================================================================
 * STAGE 3 — flattens a Universal Appraisal into buildBuyDecisionReport()'s
 * own argument shape.
 * =============================================================================
 *
 * This is the only function allowed to know both shapes. The acquisition
 * engine itself stays exactly as it was before this refactor — same
 * signature, same formulas, same thresholds.
 *
 * HARD RULE: this function must never read appraisal.source. The engine
 * has no source-awareness by construction, not by convention — there is
 * no `if (source === 'vauto')` anywhere in this file, and
 * flipLogicAppraisal.test.js asserts identical business data produces a
 * byte-identical report regardless of source.
 *
 * @param {FlipLogicAppraisal} appraisal
 */
export function toEngineInput(appraisal) {
  return {
    vin: appraisal.vehicle.vin,
    year: appraisal.vehicle.year,
    make: appraisal.vehicle.make,
    model: appraisal.vehicle.model,
    trim: appraisal.vehicle.trim,
    mileage: appraisal.vehicle.mileage,
    condition: appraisal.condition.overall,
    retailData: {
      low: appraisal.market.low,
      avg: appraisal.market.avg,
      high: appraisal.market.high,
      comparableCount: appraisal.market.comparableCount,
    },
    appraisalToolValue: appraisal.dealerEconomics.appraisalToolValue,
    customReconCost: appraisal.recon.estimate,
    targetGrossProfit: appraisal.dealerEconomics.targetGrossProfit,
    targetGrossProfitMode: appraisal.dealerEconomics.targetGrossProfitMode,
    notes: appraisal.appraisalContext.notes,
    knownRisks: appraisal.appraisalContext.knownRisks,
  };
}
