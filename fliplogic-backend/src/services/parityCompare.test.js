import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareParity } from './parityCompare.js';
import { buildBuyDecisionReport } from './buyDecisionReport.js';
import { flipLogicAppraisalSchema, normalizeToUniversalAppraisal, toEngineInput } from '../schemas/flipLogicAppraisal.js';

const baseWire = {
  vin: '2T3B1RFV8NC290456',
  year: 2022,
  make: 'Toyota',
  model: 'RAV4',
  trim: null,
  mileage: 42000,
  condition: 'good',
  lowRetail: 24947,
  avgRetail: 28500,
  highRetail: 31000,
  comparableCount: 8,
  appraisalToolValue: 22000,
  estimatedReconCost: null,
  targetGrossProfit: null,
  targetGrossProfitMode: null,
  notes: null,
  knownRisks: null,
};

function run(wireOverrides, sourceFallback) {
  const wire = flipLogicAppraisalSchema.parse({ ...baseWire, ...wireOverrides });
  const universal = normalizeToUniversalAppraisal(wire, sourceFallback);
  const report = buildBuyDecisionReport(toEngineInput(universal));
  return { wire, universal, report };
}

test('identical inputs pass on all three tiers', () => {
  const a = run({ source: 'vauto' });
  const b = run({ source: 'manual' });
  const result = compareParity(a.wire, a.wire, a.universal, a.universal, a.report, a.report);

  assert.equal(result.pass, true);
  for (const d of [...result.inputDiffs, ...result.normalizedDiffs, ...result.outputDiffs]) {
    assert.equal(d.withinTolerance, true, `${d.field} should be within tolerance`);
  }
});

test('differing source.type alone does not fail the comparison', () => {
  const a = run({}, 'vauto');
  const b = run({}, 'manual');
  const result = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report);

  assert.equal(result.pass, true);
  // source.type is intentionally excluded from normalizedDiffs entirely —
  // confirm it's genuinely absent, not just passing by coincidence.
  assert.ok(!result.normalizedDiffs.some((d) => d.field.includes('source')));
});

test('a real normalized-schema difference fails the comparison even when every output field still matches', () => {
  // make/model only ever gate PRESENCE in the confidence calculation
  // (buildBuyDecisionReport doesn't check that the value is correct) —
  // so two different real make values produce byte-identical output,
  // while still being a genuine business-input mismatch that a parity
  // test should catch. This is exactly why normalizedDiffs gates pass/
  // fail independently of outputDiffs (see the file header comment).
  const a = run({ make: 'Toyota' });
  const b = run({ make: 'Toyota Canada Inc.' }); // same real vehicle, differently-typed make
  const result = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report);

  assert.deepEqual(a.report.profitCalculation, b.report.profitCalculation);
  assert.deepEqual(a.report.riskAndConfidence, b.report.riskAndConfidence);
  assert.equal(result.pass, false);
  const makeDiff = result.normalizedDiffs.find((d) => d.field === 'vehicle.make');
  assert.equal(makeDiff.withinTolerance, false);
});

test('a real difference in Max Buy fails the comparison by default', () => {
  const a = run({});
  const b = run({ estimatedReconCost: 500 }); // cheaper recon -> higher max buy
  const result = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report);

  assert.equal(result.pass, false);
  const maxBuyDiff = result.outputDiffs.find((d) => d.field === 'profitCalculation.recommendedMaxBuyPrice');
  assert.notEqual(maxBuyDiff.diff, 0);
  assert.equal(maxBuyDiff.withinTolerance, false);
});

test('a real difference in market data fails on the normalized tier, not just the output tier', () => {
  const a = run({});
  const b = run({ avgRetail: 29500 });
  const result = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report);

  assert.equal(result.pass, false);
  const normalizedDiff = result.normalizedDiffs.find((d) => d.field === 'market.avg');
  assert.equal(normalizedDiff.withinTolerance, false);
});

test('an explicit tolerance allows a small, documented difference to pass', () => {
  const a = run({});
  const b = run({ avgRetail: baseWire.avgRetail + 1 });

  const withoutTolerance = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report);
  assert.equal(withoutTolerance.pass, false);

  const withTolerance = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report, {
    tolerances: { 'market.avg': 1, 'marketSnapshot.avgRetail': 1 },
  });
  assert.equal(withTolerance.pass, true);
});

test('a categorical mismatch (verdict) always fails regardless of tolerances', () => {
  const a = run({}); // Buy
  const walkAwayWire = flipLogicAppraisalSchema.parse({
    ...baseWire,
    lowRetail: 5000,
    avgRetail: 5000,
    highRetail: 5000,
    estimatedReconCost: 20000, // recon alone exceeds retail value -> no profitable price
  });
  const walkAwayUniversal = normalizeToUniversalAppraisal(walkAwayWire);
  const walkAwayReport = buildBuyDecisionReport(toEngineInput(walkAwayUniversal));

  const result = compareParity(a.wire, walkAwayWire, a.universal, walkAwayUniversal, a.report, walkAwayReport, {
    tolerances: { 'verdict.decision': 100 },
  });

  const verdictDiff = result.outputDiffs.find((d) => d.field === 'verdict.decision');
  assert.equal(verdictDiff.withinTolerance, false);
  assert.equal(result.pass, false);
});

test('missingInputs reflects each report\'s own missingData, not recomputed', () => {
  const a = run({});
  const b = run({ condition: null, mileage: null });
  const result = compareParity(a.wire, b.wire, a.universal, b.universal, a.report, b.report);

  assert.deepEqual(result.missingInputs.testA, a.report.riskAndConfidence.missingData);
  assert.deepEqual(result.missingInputs.testB, b.report.riskAndConfidence.missingData);
  assert.ok(result.missingInputs.testB.includes('Condition'));
  assert.ok(result.missingInputs.testB.includes('Mileage'));
});
