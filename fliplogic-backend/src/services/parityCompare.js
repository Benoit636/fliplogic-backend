/**
 * Three-tier diff for the vAuto-vs-independent parity test (data-source
 * independence Phase 1, requirement 4):
 *
 *   1. inputDiffs      — the raw wire payloads (testA vs testB) as submitted
 *   2. normalizedDiffs — the Universal FlipLogic Appraisal Schema each one
 *                        normalized into (Stage 2)
 *   3. outputDiffs     — the Buy Decision Report each one produced (Stage 4)
 *
 * A PASS requires equivalent business inputs AND equivalent acquisition
 * outputs — normalizedDiffs and outputDiffs both have to be entirely
 * within tolerance. inputDiffs is informational only: two wire payloads
 * can legitimately differ in fields the engine never uses (e.g. one
 * captured a comparableCount the other didn't bother typing) without that
 * being a parity failure — normalizedDiffs is what actually feeds the
 * engine, so it's the tier that governs pass/fail on the input side.
 *
 * Tolerance defaults to zero on every numeric field in every tier. Pass
 * `tolerances` to opt a specific field path into a documented, non-zero
 * tolerance — there is no blanket "close enough" behavior, per the
 * constraint against concealing real differences through broad
 * tolerances.
 */

const INPUT_FIELDS = [
  { path: 'vin', type: 'categorical' },
  { path: 'year', type: 'number' },
  { path: 'make', type: 'categorical' },
  { path: 'model', type: 'categorical' },
  { path: 'mileage', type: 'number' },
  { path: 'condition', type: 'categorical' },
  { path: 'lowRetail', type: 'number' },
  { path: 'avgRetail', type: 'number' },
  { path: 'highRetail', type: 'number' },
  { path: 'comparableCount', type: 'number' },
  { path: 'estimatedReconCost', type: 'number' },
  { path: 'targetGrossProfit', type: 'number' },
  { path: 'targetGrossProfitMode', type: 'categorical' },
];

const NORMALIZED_FIELDS = [
  { path: 'vehicle.vin', type: 'categorical' },
  { path: 'vehicle.year', type: 'number' },
  { path: 'vehicle.make', type: 'categorical' },
  { path: 'vehicle.model', type: 'categorical' },
  { path: 'vehicle.mileage', type: 'number' },
  { path: 'condition.overall', type: 'categorical' },
  { path: 'market.low', type: 'number' },
  { path: 'market.avg', type: 'number' },
  { path: 'market.high', type: 'number' },
  { path: 'market.comparableCount', type: 'number' },
  { path: 'recon.estimate', type: 'number' },
  { path: 'dealerEconomics.targetGrossProfit', type: 'number' },
  { path: 'dealerEconomics.targetGrossProfitMode', type: 'categorical' },
  // Deliberately NOT diffed: source.type. The two sides of a parity test
  // are expected to differ there (that's the whole point) — it must have
  // zero bearing on whether the test passes, so it's excluded from the
  // fields that gate pass/fail rather than included with an always-high
  // tolerance, which would look like an oversight instead of a decision.
];

const OUTPUT_FIELDS = [
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
    // One side has a value and the other doesn't — a real, reportable
    // difference, never treated as "within tolerance."
    return { field: path, testA, testB, diff: null, tolerance, withinTolerance: false };
  }
  const diff = Number((testB - testA).toFixed(2));
  return { field: path, testA, testB, diff, tolerance, withinTolerance: Math.abs(diff) <= tolerance };
}

function diffCategoricalField(path, testA, testB) {
  const withinTolerance = testA === testB;
  return { field: path, testA, testB, diff: withinTolerance ? null : 'mismatch', tolerance: 0, withinTolerance };
}

function diffFields(objA, objB, fields, tolerances) {
  return fields.map(({ path, type }) => {
    const testA = getAt(objA, path);
    const testB = getAt(objB, path);
    return type === 'number'
      ? diffNumberField(path, testA, testB, tolerances[path] ?? 0)
      : diffCategoricalField(path, testA, testB);
  });
}

/**
 * @param {object} wireA - testA's raw wire payload (as validated by flipLogicAppraisalSchema)
 * @param {object} wireB - testB's raw wire payload
 * @param {object} universalA - testA normalized via normalizeToUniversalAppraisal()
 * @param {object} universalB - testB normalized via normalizeToUniversalAppraisal()
 * @param {object} reportA - buildBuyDecisionReport(toEngineInput(universalA))
 * @param {object} reportB - buildBuyDecisionReport(toEngineInput(universalB))
 * @param {object} [tolerances] - { [fieldPath]: number }, applies across all three tiers by path
 */
export function compareParity(wireA, wireB, universalA, universalB, reportA, reportB, { tolerances = {} } = {}) {
  const inputDiffs = diffFields(wireA, wireB, INPUT_FIELDS, tolerances);
  const normalizedDiffs = diffFields(universalA, universalB, NORMALIZED_FIELDS, tolerances);
  const outputDiffs = diffFields(reportA, reportB, OUTPUT_FIELDS, tolerances);

  return {
    // Equivalent business inputs AND equivalent acquisition outputs —
    // inputDiffs is diagnostic only, see the file header comment.
    pass: normalizedDiffs.every((d) => d.withinTolerance) && outputDiffs.every((d) => d.withinTolerance),
    inputDiffs,
    normalizedDiffs,
    outputDiffs,
    missingInputs: {
      testA: reportA?.riskAndConfidence?.missingData ?? [],
      testB: reportB?.riskAndConfidence?.missingData ?? [],
    },
  };
}
