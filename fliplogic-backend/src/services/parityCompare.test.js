import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareReports } from './parityCompare.js';
import { buildBuyDecisionReport } from './buyDecisionReport.js';

const baseInput = {
  vin: '2T3B1RFV8NC290456',
  year: 2022,
  make: 'Toyota',
  model: 'RAV4',
  trim: null,
  mileage: 42000,
  condition: 'good',
  retailData: { low: 24947, avg: 28500, high: 31000, comparableCount: 8 },
  appraisalToolValue: 22000,
  customReconCost: null,
  targetGrossProfit: null,
  targetGrossProfitMode: null,
  notes: null,
  knownRisks: null,
};

test('identical inputs produce a passing comparison with zero diffs', () => {
  const reportA = buildBuyDecisionReport(baseInput);
  const reportB = buildBuyDecisionReport({ ...baseInput });
  const result = compareReports(reportA, reportB);

  assert.equal(result.pass, true);
  for (const d of result.fieldDiffs) {
    assert.equal(d.withinTolerance, true, `${d.field} should be within tolerance`);
  }
});

test('a real difference in Max Buy fails the comparison by default', () => {
  const reportA = buildBuyDecisionReport(baseInput);
  const reportB = buildBuyDecisionReport({ ...baseInput, customReconCost: 500 }); // cheaper recon -> higher max buy
  const result = compareReports(reportA, reportB);

  assert.equal(result.pass, false);
  const maxBuyDiff = result.fieldDiffs.find((d) => d.field === 'profitCalculation.recommendedMaxBuyPrice');
  assert.notEqual(maxBuyDiff.diff, 0);
  assert.equal(maxBuyDiff.withinTolerance, false);
});

test('an explicit tolerance allows a small, documented difference to pass', () => {
  const reportA = buildBuyDecisionReport(baseInput);
  // avgRetail 1 dollar apart purely from rounding two different manual
  // entries of "the same" market data.
  const reportB = buildBuyDecisionReport({
    ...baseInput,
    retailData: { ...baseInput.retailData, avg: baseInput.retailData.avg + 1 },
  });

  const withoutTolerance = compareReports(reportA, reportB);
  assert.equal(withoutTolerance.pass, false);

  const withTolerance = compareReports(reportA, reportB, {
    tolerances: { 'marketSnapshot.avgRetail': 1 },
  });
  const avgDiff = withTolerance.fieldDiffs.find((d) => d.field === 'marketSnapshot.avgRetail');
  assert.equal(avgDiff.withinTolerance, true);
});

test('a categorical mismatch (verdict) always fails regardless of tolerances', () => {
  const reportA = buildBuyDecisionReport(baseInput); // Buy
  const reportB = buildBuyDecisionReport({ ...baseInput, retailData: null, comparables: [] }); // Walk Away — no market data
  const result = compareReports(reportA, reportB, { tolerances: { 'verdict.decision': 100 } });

  const verdictDiff = result.fieldDiffs.find((d) => d.field === 'verdict.decision');
  assert.equal(verdictDiff.withinTolerance, false);
  assert.equal(result.pass, false);
});

test('missingInputs reflects each report\'s own missingData, not recomputed', () => {
  const reportA = buildBuyDecisionReport(baseInput);
  const reportB = buildBuyDecisionReport({ ...baseInput, condition: null, mileage: null });
  const result = compareReports(reportA, reportB);

  assert.deepEqual(result.missingInputs.testA, reportA.riskAndConfidence.missingData);
  assert.deepEqual(result.missingInputs.testB, reportB.riskAndConfidence.missingData);
  assert.ok(result.missingInputs.testB.includes('Condition'));
  assert.ok(result.missingInputs.testB.includes('Mileage'));
});
