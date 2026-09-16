/**
 * Diffs two Buy Decision Reports on exactly the fields Phase 5 of the
 * data-source independence plan asks for: retail range, recon, Max Buy,
 * expected gross, turn risk, confidence, and verdict. Nothing else is
 * compared — this isn't a general-purpose deep-diff, it's the specific
 * parity check the audit's Test Plan (§9) describes.
 *
 * Tolerance defaults to zero on every field. Pass `tolerances` to opt a
 * specific field path into a documented, non-zero tolerance — there is no
 * blanket "close enough" behavior, per the constraint against concealing
 * real differences through broad tolerances.
 */

const DIFF_FIELDS = [
  { path: 'marketSnapshot.lowRetail', type: 'number' },
  { path: 'marketSnapshot.avgRetail', type: 'number' },
  { path: 'marketSnapshot.highRetail', type: 'number' },
  { path: 'reconEstimate.amount', type: 'number' },
  { path: 'profitCalculation.recommendedMaxBuyPrice', type: 'number' },
  { path: 'profitCalculation.expectedGrossProfit', type: 'number' },
  { path: 'riskAndConfidence.confidenceScore', type: 'number' },
  { path: 'riskAndConfidence.daysToSellRisk', type: 'categorical' },
  { path: 'verdict.decision', type: 'categorical' },
];

function getAt(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

function diffNumberField(path, testA, testB, tolerance) {
  if (testA == null && testB == null) {
    return { field: path, testA, testB, diff: 0, tolerance, withinTolerance: true };
  }
  if (testA == null || testB == null) {
    // One side has a value and the other doesn't (e.g. one report had
    // insufficient market data) — this is a real, reportable difference,
    // never treated as "within tolerance."
    return { field: path, testA, testB, diff: null, tolerance, withinTolerance: false };
  }
  const diff = Number((testB - testA).toFixed(2));
  return { field: path, testA, testB, diff, tolerance, withinTolerance: Math.abs(diff) <= tolerance };
}

function diffCategoricalField(path, testA, testB) {
  const withinTolerance = testA === testB;
  return { field: path, testA, testB, diff: withinTolerance ? null : 'mismatch', tolerance: 0, withinTolerance };
}

export function compareReports(reportA, reportB, { tolerances = {} } = {}) {
  const fieldDiffs = DIFF_FIELDS.map(({ path, type }) => {
    const testA = getAt(reportA, path);
    const testB = getAt(reportB, path);
    return type === 'number'
      ? diffNumberField(path, testA, testB, tolerances[path] ?? 0)
      : diffCategoricalField(path, testA, testB);
  });

  return {
    pass: fieldDiffs.every((d) => d.withinTolerance),
    fieldDiffs,
    missingInputs: {
      testA: reportA?.riskAndConfidence?.missingData ?? [],
      testB: reportB?.riskAndConfidence?.missingData ?? [],
    },
  };
}
