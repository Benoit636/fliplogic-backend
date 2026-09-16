import { test } from 'node:test';
import assert from 'node:assert/strict';
import { flipLogicAppraisalSchema, toEngineInput } from './flipLogicAppraisal.js';
import { buildBuyDecisionReport } from '../services/buyDecisionReport.js';

// A realistic payload shaped exactly like what adapters/vauto.js sends —
// explicit nulls (not omitted keys) for fields the page didn't have.
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
};

// A realistic payload shaped like the manual entry form — omitted keys
// instead of explicit nulls, per react-hook-form's `|| undefined` pattern.
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

test('accepts a vAuto-shaped payload with explicit nulls', () => {
  const parsed = flipLogicAppraisalSchema.parse(vautoStylePayload);
  assert.equal(parsed.vin, vautoStylePayload.vin);
  assert.equal(parsed.trim, null);
  assert.equal(parsed.knownRisks, vautoStylePayload.knownRisks);
});

test('accepts a manual-entry-shaped payload with omitted optional keys', () => {
  const parsed = flipLogicAppraisalSchema.parse(manualStylePayload);
  assert.equal(parsed.vin, manualStylePayload.vin);
  assert.equal(parsed.trim, undefined);
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

test('toEngineInput nests retail fields into retailData for the engine', () => {
  const parsed = flipLogicAppraisalSchema.parse(vautoStylePayload);
  const { engineInput } = toEngineInput(parsed);
  assert.deepEqual(engineInput.retailData, {
    low: 24947,
    avg: 28500,
    high: 31000,
    comparableCount: 8,
  });
  assert.equal(engineInput.customReconCost, null);
  assert.equal(engineInput.knownRisks, vautoStylePayload.knownRisks);
});

test('toEngineInput defaults targetGrossProfitMode to dollar only when a target was actually given', () => {
  const withTarget = toEngineInput(flipLogicAppraisalSchema.parse(vautoStylePayload));
  assert.equal(withTarget.targetGrossProfitMode, null); // no target in this fixture

  const withDollarTarget = toEngineInput(
    flipLogicAppraisalSchema.parse({ ...vautoStylePayload, targetGrossProfit: 3000, targetGrossProfitMode: null })
  );
  assert.equal(withDollarTarget.targetGrossProfitMode, 'dollar');

  const withPercentTarget = toEngineInput(flipLogicAppraisalSchema.parse(manualStylePayload));
  assert.equal(withPercentTarget.targetGrossProfitMode, 'percentage');
});

test('end to end: both payload shapes flow through the real engine without throwing', () => {
  for (const payload of [vautoStylePayload, manualStylePayload]) {
    const parsed = flipLogicAppraisalSchema.parse(payload);
    const { engineInput } = toEngineInput(parsed);
    const report = buildBuyDecisionReport(engineInput);
    assert.ok(['Buy', 'Negotiate', 'Walk Away'].includes(report.verdict.decision));
    assert.equal(report.vehicle.vin, payload.vin);
  }
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

  // Same data, sent two different ways: explicit nulls (vAuto) vs. the
  // exact same explicit values (manual) — this is the Phase 5 parity test
  // in miniature.
  const viaVauto = buildBuyDecisionReport(toEngineInput(flipLogicAppraisalSchema.parse(shared)).engineInput);
  const viaManual = buildBuyDecisionReport(toEngineInput(flipLogicAppraisalSchema.parse({ ...shared })).engineInput);

  assert.deepEqual(viaVauto.profitCalculation, viaManual.profitCalculation);
  assert.deepEqual(viaVauto.riskAndConfidence, viaManual.riskAndConfidence);
  assert.deepEqual(viaVauto.verdict, viaManual.verdict);
});
