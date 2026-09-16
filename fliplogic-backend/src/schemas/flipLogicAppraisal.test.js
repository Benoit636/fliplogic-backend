import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipLogicAppraisalSchema, normalizeToUniversalAppraisal, toEngineInput } from './flipLogicAppraisal.js';
import { buildBuyDecisionReport } from '../services/buyDecisionReport.js';

// A realistic payload shaped exactly like what adapters/vauto.js sends —
// explicit nulls (not omitted keys) for fields the page didn't have, and
// the extension's source tag.
const vautoStylePayload = {
  vin: '2T3B1RFV8NC290456',
  year: 2022,
  make: 'Toyota',
  model: 'RAV4',
  trim: null,
  mileage: 42000,
  condition: 'good',
  appraisalToolValue: 22000,
  lowRetail: 24947,
  avgRetail: 28500,
  highRetail: 31000,
  comparableCount: 8,
  estimatedReconCost: null,
  targetGrossProfit: null,
  targetGrossProfitMode: null,
  notes: null,
  knownRisks: 'Lots of scratches, tailgate rust staring.',
  source: 'vauto',
};

// A realistic payload shaped like the manual entry form — omitted keys
// instead of explicit nulls, and no `source` (the form doesn't send one;
// normalizeToUniversalAppraisal()'s fallback covers this).
const manualStylePayload = {
  vin: '1V2FR2CAXRC526551',
  year: 2024,
  make: 'Volkswagen',
  model: 'Atlas',
  mileage: 8000,
  condition: 'excellent',
  lowRetail: 38000,
  avgRetail: 40000,
  highRetail: 44000,
  targetGrossProfit: 10,
  targetGrossProfitMode: 'percentage',
};

// ---------------------------------------------------------------------------
// Stage 1 — wire schema
// ---------------------------------------------------------------------------

test('the vAuto path still works: accepts a vAuto-shaped payload with explicit nulls and source: vauto', () => {
  const parsed = flipLogicAppraisalSchema.parse(vautoStylePayload);
  assert.equal(parsed.vin, vautoStylePayload.vin);
  assert.equal(parsed.trim, null);
  assert.equal(parsed.source, 'vauto');
  assert.equal(parsed.knownRisks, vautoStylePayload.knownRisks);
});

test('the manual path still works: accepts a manual-entry-shaped payload with omitted optional keys and no source', () => {
  const parsed = flipLogicAppraisalSchema.parse(manualStylePayload);
  assert.equal(parsed.vin, manualStylePayload.vin);
  assert.equal(parsed.trim, undefined);
  assert.equal(parsed.source, undefined);
});

test('rejects a VIN that is not exactly 17 characters', () => {
  assert.throws(() => flipLogicAppraisalSchema.parse({ ...vautoStylePayload, vin: 'TOOSHORT' }));
});

test('rejects retail values out of low <= avg <= high order', () => {
  assert.throws(() =>
    flipLogicAppraisalSchema.parse({ ...vautoStylePayload, lowRetail: 30000, avgRetail: 28500 })
  );
});

test('rejects a percentage target gross profit over 100', () => {
  assert.throws(() =>
    flipLogicAppraisalSchema.parse({ ...manualStylePayload, targetGrossProfit: 150, targetGrossProfitMode: 'percentage' })
  );
});

test('rejects an unrecognized source value rather than silently accepting it', () => {
  assert.throws(() => flipLogicAppraisalSchema.parse({ ...vautoStylePayload, source: 'carfax' }));
});

// ---------------------------------------------------------------------------
// Stage 2 — normalizeToUniversalAppraisal()
// ---------------------------------------------------------------------------

test('both paths use the same schema: vAuto and manual payloads normalize into the identical Universal Appraisal shape', () => {
  const universalA = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload));
  const universalB = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(manualStylePayload), 'manual');

  const topLevelKeys = ['source', 'vehicle', 'condition', 'history', 'equipment', 'photos', 'market', 'recon', 'dealerEconomics', 'appraisalContext'];
  for (const key of topLevelKeys) {
    assert.ok(key in universalA, `testA missing ${key}`);
    assert.ok(key in universalB, `testB missing ${key}`);
  }
});

test('source.type reflects the wire payload when present, and falls back when absent', () => {
  const universalA = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload), 'manual');
  assert.equal(universalA.source.type, 'vauto'); // explicit on the wire, wins over the fallback

  const universalB = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(manualStylePayload), 'manual');
  assert.equal(universalB.source.type, 'manual'); // no source on the wire, uses the fallback
});

test('richer condition/equipment/history fields are always explicit null, never inferred', () => {
  const universal = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload));
  assert.equal(universal.condition.overall, 'good'); // the one field that IS sourced
  for (const field of ['exterior', 'interior', 'damage', 'tires', 'brakes', 'glass', 'mechanical', 'warningLights']) {
    assert.equal(universal.condition[field], null, `condition.${field} should be null`);
  }
  assert.equal(universal.history, null);
  assert.deepEqual(universal.equipment, { drivetrain: null, engine: null, transmission: null });
  assert.equal(universal.photos, null);
});

test('missing condition does not become "good": condition.overall is null, not defaulted', () => {
  const universal = normalizeToUniversalAppraisal(
    flipLogicAppraisalSchema.parse({ ...vautoStylePayload, condition: null })
  );
  assert.equal(universal.condition.overall, null);
});

// ---------------------------------------------------------------------------
// Stage 3 — toEngineInput()
// ---------------------------------------------------------------------------

test('toEngineInput nests retail fields into retailData for the engine', () => {
  const universal = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload));
  const engineInput = toEngineInput(universal);
  assert.deepEqual(engineInput.retailData, {
    low: 24947,
    avg: 28500,
    high: 31000,
    comparableCount: 8,
  });
  assert.equal(engineInput.customReconCost, null);
  assert.equal(engineInput.knownRisks, vautoStylePayload.knownRisks);
});

test('toEngineInput never reads appraisal.source (both paths use the same acquisition engine)', () => {
  const asVauto = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload), 'vauto');
  const asManual = { ...asVauto, source: { type: 'manual' } };
  assert.deepEqual(toEngineInput(asVauto), toEngineInput(asManual));
});

test('toEngineInput defaults targetGrossProfitMode to dollar only when a target was actually given', () => {
  const withoutTarget = toEngineInput(normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload)));
  assert.equal(withoutTarget.targetGrossProfitMode, null);

  const withDollarTarget = toEngineInput(
    normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse({ ...vautoStylePayload, targetGrossProfit: 3000, targetGrossProfitMode: null }))
  );
  assert.equal(withDollarTarget.targetGrossProfitMode, 'dollar');

  const withPercentTarget = toEngineInput(normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(manualStylePayload)));
  assert.equal(withPercentTarget.targetGrossProfitMode, 'percentage');
});

// ---------------------------------------------------------------------------
// End-to-end through the real engine
// ---------------------------------------------------------------------------

test('both payload shapes flow through the real engine without throwing', () => {
  for (const payload of [vautoStylePayload, manualStylePayload]) {
    const universal = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(payload));
    const report = buildBuyDecisionReport(toEngineInput(universal));
    assert.ok(['Buy', 'Negotiate', 'Walk Away'].includes(report.verdict.decision));
    assert.equal(report.vehicle.vin, payload.vin);
  }
});

test('source metadata cannot affect Max Buy or any other engine output', () => {
  const wire = flipLogicAppraisalSchema.parse({ ...vautoStylePayload, source: 'vauto' });
  const asVauto = buildBuyDecisionReport(toEngineInput(normalizeToUniversalAppraisal(wire, 'manual')));
  const asManual = buildBuyDecisionReport(toEngineInput(normalizeToUniversalAppraisal({ ...wire, source: 'manual' }, 'manual')));

  assert.deepEqual(asVauto, { ...asManual, generatedAt: asVauto.generatedAt });
});

test('missing recon does not become $0: the engine still estimates a real recon cost', () => {
  const universal = normalizeToUniversalAppraisal(
    flipLogicAppraisalSchema.parse({ ...vautoStylePayload, estimatedReconCost: null })
  );
  const report = buildBuyDecisionReport(toEngineInput(universal));
  assert.ok(report.reconEstimate.amount > 0);
  assert.equal(report.reconEstimate.source, 'estimated');
});

test('missing market data is rejected at intake, not silently treated as sufficient', () => {
  // lowRetail/avgRetail/highRetail are required on the wire schema for
  // both the vAuto and manual paths — "missing market data" is caught
  // here, before normalization or the engine ever see it, rather than
  // reaching buildBuyDecisionReport() as nulls it would have to guess
  // about. (The engine's own "insufficient data -> Walk Away" behavior,
  // unchanged by this refactor, is what the legacy scraped-comparables
  // path in routes/appraisals.js still relies on — see the LEGACY
  // comment there.)
  const { lowRetail, avgRetail, highRetail, ...withoutRetail } = vautoStylePayload;
  assert.throws(() => flipLogicAppraisalSchema.parse(withoutRetail));
});

test('a real (non-legacy) report always has sufficient market data, since the wire schema requires it', () => {
  const universal = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload));
  const report = buildBuyDecisionReport(toEngineInput(universal));
  assert.equal(report.marketSnapshot.sufficientData, true);
});

test('vAuto and manual payloads for the identical vehicle/numbers produce identical reports (parity)', () => {
  const shared = {
    vin: '1HGCR2F04HA811149',
    year: 2017,
    make: 'Honda',
    model: 'Accord',
    trim: 'EX-L',
    mileage: 95000,
    condition: 'average',
    lowRetail: 9000,
    avgRetail: 9493,
    highRetail: 10200,
    comparableCount: 5,
    estimatedReconCost: 1800,
    targetGrossProfit: 3000,
    targetGrossProfitMode: 'dollar',
    notes: null,
    knownRisks: null,
    appraisalToolValue: null,
  };

  const viaVauto = buildBuyDecisionReport(
    toEngineInput(normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse({ ...shared, source: 'vauto' })))
  );
  const viaManual = buildBuyDecisionReport(
    toEngineInput(normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse({ ...shared, source: 'manual' })))
  );

  assert.deepEqual(viaVauto.profitCalculation, viaManual.profitCalculation);
  assert.deepEqual(viaVauto.riskAndConfidence, viaManual.riskAndConfidence);
  assert.deepEqual(viaVauto.verdict, viaManual.verdict);
});

test('a known appraisal example (2022 Toyota RAV4 fixture) produces the same Max Buy after this refactor as before it', () => {
  // $21,138 was verified by running this exact fixture through the
  // pre-Phase-1 pipeline (commit d020f1c's toEngineInput(wireData), one
  // stage instead of two) and reading its actual output — not
  // remembered or assumed. This test exists specifically to catch the
  // refactor silently changing that number, per Phase 1 requirement 5's
  // "known appraisal examples produce the same outputs before and after
  // this refactor." (Note: this fixture's $22,000 appraisalToolValue is
  // the same VIN used elsewhere in this project's demo materials, but
  // its Max Buy there reflects different real market/recon inputs from
  // an actual historical deal — $21,138 is what THIS specific synthetic
  // fixture produces, not that unrelated figure.)
  const universal = normalizeToUniversalAppraisal(flipLogicAppraisalSchema.parse(vautoStylePayload));
  const report = buildBuyDecisionReport(toEngineInput(universal));
  assert.equal(report.profitCalculation.recommendedMaxBuyPrice, 21138);
  assert.equal(report.verdict.decision, 'Buy');
});
