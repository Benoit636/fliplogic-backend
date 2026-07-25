/**
 * Buy Decision Report calculation engine.
 *
 * Pure functions — no DB/network access — so this is easy to test and
 * reason about in isolation from the scraping/persistence layer that
 * calls it. Produces the 7 required outputs: recommended max buy price,
 * recon estimate, retail market range, expected gross profit,
 * days-to-sell risk, confidence score, and final verdict.
 *
 * Thresholds and point weights below aren't specified by any external
 * source of truth — they're reasonable defaults, documented inline, and
 * meant to be easy to tune later.
 */

const RECON_DEFAULTS_BY_CONDITION = {
  excellent: 500,
  good: 1250,
  average: 2000,
  rough: 3500,
};

// Used when condition wasn't provided at all — a cautious middle-ground
// default rather than assuming the best case.
const RECON_DEFAULT_MISSING_CONDITION = 2000;

const DEFAULT_TARGET_GROSS_PROFIT = 3000;

function estimateReconCost({ condition, year, mileage, customReconCost }) {
  if (customReconCost != null) {
    return { amount: Number(customReconCost), source: 'manual', notes: [] };
  }

  const notes = [];
  const normalizedCondition = condition ? String(condition).toLowerCase() : null;
  let base;
  if (normalizedCondition && RECON_DEFAULTS_BY_CONDITION[normalizedCondition] != null) {
    base = RECON_DEFAULTS_BY_CONDITION[normalizedCondition];
  } else {
    base = RECON_DEFAULT_MISSING_CONDITION;
    notes.push('Condition not provided — used a cautious default recon estimate.');
  }

  let adjustment = 0;
  const age = year ? new Date().getFullYear() - year : null;
  if (age != null) {
    if (age >= 12) {
      adjustment += 700;
      notes.push('Vehicle age (12+ years) increased the recon estimate.');
    } else if (age >= 8) {
      adjustment += 300;
      notes.push('Vehicle age (8+ years) increased the recon estimate.');
    }
  }
  if (mileage != null) {
    if (mileage >= 180000) {
      adjustment += 700;
      notes.push('High mileage (180,000+ km) increased the recon estimate.');
    } else if (mileage >= 120000) {
      adjustment += 300;
      notes.push('Above-average mileage (120,000+ km) increased the recon estimate.');
    }
  }

  return { amount: base + adjustment, source: 'estimated', notes };
}

function computeRetailRange(comparables) {
  const prices = (comparables || [])
    .map((c) => c.price)
    .filter((p) => typeof p === 'number' && p > 0);

  if (prices.length === 0) {
    return { low: null, avg: null, high: null, count: 0, sufficient: false };
  }

  const sorted = [...prices].sort((a, b) => a - b);
  return {
    low: sorted[0],
    high: sorted[sorted.length - 1],
    avg: sorted[Math.floor(sorted.length / 2)], // median — consistent with the rest of the app's "market value"
    count: prices.length,
    sufficient: true,
  };
}

function computeConfidence({ year, make, model, mileage, condition, retailRange, reconSource }) {
  let score = 50;
  const reasons = [];

  if (year && make) {
    score += 10;
  } else {
    score -= 15;
    reasons.push('VIN did not decode complete year/make information.');
  }

  if (model) {
    score += 10;
  } else {
    score -= 10;
    reasons.push('Model could not be decoded from the VIN.');
  }

  if (retailRange.sufficient) {
    if (retailRange.count >= 3) {
      score += 15;
    } else {
      score += 8;
      reasons.push(`Only ${retailRange.count} comparable listing${retailRange.count === 1 ? '' : 's'} found.`);
    }
  } else {
    score -= 15;
    reasons.push('No comparable market listings were found.');
  }

  if (mileage != null) {
    score += 8;
  } else {
    score -= 8;
    reasons.push('Mileage was not provided.');
  }

  if (condition) {
    score += 8;
  } else {
    score -= 8;
    reasons.push('Vehicle condition was not provided.');
  }

  if (retailRange.sufficient && retailRange.avg > 0) {
    const spreadRatio = (retailRange.high - retailRange.low) / retailRange.avg;
    if (spreadRatio < 0.2) {
      score += 10;
    } else if (spreadRatio > 0.5) {
      score -= 10;
      reasons.push('Retail price range across comparables is wide.');
    }
  }

  if (reconSource === 'manual') {
    score += 5;
  } else {
    score -= 5;
    reasons.push('Reconditioning cost is an estimate, not confirmed.');
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  // Prefer showing what's hurting the score; pad with a positive note if
  // there's little to report so the reasons list isn't ever empty/thin.
  let topReasons = reasons.slice(0, 4);
  if (topReasons.length < 2) {
    if (year && make && model) topReasons.push('VIN decoded successfully with complete vehicle details.');
    if (retailRange.sufficient && retailRange.count >= 3) topReasons.push('Multiple comparable listings support this estimate.');
  }
  topReasons = topReasons.slice(0, 4);
  if (topReasons.length === 0) topReasons.push('Standard confidence based on available data.');

  return { score, reasons: topReasons };
}

function computeDaysToSellRisk({ retailRange, year, mileage }) {
  let points = 0;

  if (!retailRange.sufficient) {
    points += 3;
  } else if (retailRange.count <= 1) {
    points += 2;
  } else if (retailRange.count <= 4) {
    points += 1;
  }

  if (retailRange.sufficient && retailRange.avg > 0) {
    const spreadRatio = (retailRange.high - retailRange.low) / retailRange.avg;
    if (spreadRatio > 0.35) points += 2;
    else if (spreadRatio > 0.15) points += 1;
  }

  const age = year ? new Date().getFullYear() - year : null;
  if (age != null) {
    if (age > 10) points += 2;
    else if (age > 5) points += 1;
  } else {
    points += 1;
  }

  if (mileage != null) {
    if (mileage > 150000) points += 2;
    else if (mileage > 80000) points += 1;
  } else {
    points += 1;
  }

  if (points >= 6) return 'High';
  if (points >= 3) return 'Medium';
  return 'Low';
}

function rateGrossProfit(expectedGrossProfit, targetGrossProfit) {
  if (expectedGrossProfit == null) return 'Unknown';
  if (expectedGrossProfit <= 0) return 'Negative / Avoid';
  if (expectedGrossProfit >= targetGrossProfit * 1.15) return 'Strong';
  if (expectedGrossProfit >= targetGrossProfit * 0.85) return 'Acceptable';
  return 'Thin';
}

function formatCad(amount) {
  return `CAD $${Math.round(amount).toLocaleString('en-CA')}`;
}

function decideVerdict({
  hasSufficientData,
  grossProfitRating,
  confidenceScore,
  daysToSellRisk,
  recommendedMaxBuyPrice,
  noProfitablePrice,
}) {
  if (!hasSufficientData) {
    return {
      decision: 'Walk Away',
      explanation: 'Insufficient market data to make a confident buy decision — no comparable listings were found for this vehicle.',
    };
  }

  if (grossProfitRating === 'Negative / Avoid') {
    return {
      decision: 'Walk Away',
      explanation: noProfitablePrice
        ? "Estimated reconditioning cost alone consumes this vehicle's conservative retail value — there's no purchase price at which this acquisition is profitable."
        : "The numbers don't work at current market value — projected gross profit is negative or too thin to justify the risk.",
    };
  }

  if (confidenceScore < 40) {
    return {
      decision: 'Walk Away',
      explanation: `Confidence in this estimate is too low (${confidenceScore}/100) to recommend acquiring this vehicle without better data.`,
    };
  }

  if (daysToSellRisk === 'High' && grossProfitRating === 'Thin') {
    return {
      decision: 'Walk Away',
      explanation: 'Thin margin combined with high days-to-sell risk makes this an unattractive acquisition at the current estimated price.',
    };
  }

  if ((grossProfitRating === 'Strong' || grossProfitRating === 'Acceptable') && confidenceScore >= 60 && daysToSellRisk !== 'High') {
    return {
      decision: 'Buy',
      explanation: `Buy at or below ${formatCad(recommendedMaxBuyPrice)}. Above that number, the projected gross becomes too thin.`,
    };
  }

  return {
    decision: 'Negotiate',
    explanation: `This deal can work, but only at or below ${formatCad(recommendedMaxBuyPrice)}. Confidence and/or margin are tight enough that a higher price doesn't leave room for error.`,
  };
}

/**
 * @param {object} input
 * @param {string} input.vin
 * @param {number|null} input.year
 * @param {string|null} input.make
 * @param {string|null} input.model
 * @param {number|null} input.mileage
 * @param {string|null} input.condition - 'excellent' | 'good' | 'average' | 'rough'
 * @param {Array<{price:number}>} input.comparables
 * @param {number|null} input.customReconCost - manual override, takes priority over the estimate
 * @param {number|null} input.targetGrossProfit - defaults to DEFAULT_TARGET_GROSS_PROFIT
 * @returns {object} the full Buy Decision Report
 */
export function buildBuyDecisionReport({
  vin,
  year,
  make,
  model,
  mileage,
  condition,
  comparables,
  customReconCost,
  targetGrossProfit,
}) {
  const retailRange = computeRetailRange(comparables);
  const recon = estimateReconCost({ condition, year, mileage, customReconCost });
  const confidence = computeConfidence({ year, make, model, mileage, condition, retailRange, reconSource: recon.source });
  const daysToSellRisk = computeDaysToSellRisk({ retailRange, year, mileage });

  const missingData = [];
  if (mileage == null) missingData.push('Mileage');
  if (!condition) missingData.push('Condition');
  if (!retailRange.sufficient) missingData.push('Comparable market listings');
  if (!model) missingData.push('Vehicle model (VIN decode incomplete)');
  // No data source for this yet (no VIN history/accident-report integration) — always flag.
  missingData.push('Accident / damage history');

  const targetProfit = targetGrossProfit != null ? Number(targetGrossProfit) : DEFAULT_TARGET_GROSS_PROFIT;

  // Wider risk buffer when confidence is lower — 5% at high confidence,
  // up to 10% when data is thin.
  const riskBufferPct = confidence.score >= 80 ? 0.05 : confidence.score >= 50 ? 0.075 : 0.1;

  let conservativeRetailValue = null;
  let riskBuffer = null;
  let recommendedMaxBuyPrice = null;
  let expectedGrossProfit = null;
  let grossProfitRating = 'Unknown';
  // True when recon cost alone consumes enough of the vehicle's value that
  // no purchase price (not even $0) would hit the target profit + buffer —
  // expectedGrossProfit is otherwise a near-constant (targetProfit +
  // riskBuffer) by construction, so it can't signal this on its own; a
  // non-positive recommendedMaxBuyPrice is the real "walk away" signal.
  let noProfitablePrice = false;

  if (retailRange.sufficient) {
    // Deliberately conservative: the midpoint between the low comp and the
    // median, not the average or high end.
    conservativeRetailValue = Math.round((retailRange.low + retailRange.avg) / 2);
    riskBuffer = Math.round(conservativeRetailValue * riskBufferPct);
    recommendedMaxBuyPrice = Math.round(conservativeRetailValue - recon.amount - targetProfit - riskBuffer);

    if (recommendedMaxBuyPrice <= 0) {
      noProfitablePrice = true;
      // Best case: what you'd net if you somehow acquired it for $0.
      expectedGrossProfit = Math.round(conservativeRetailValue - recon.amount);
      grossProfitRating = 'Negative / Avoid';
    } else {
      expectedGrossProfit = Math.round(conservativeRetailValue - recommendedMaxBuyPrice - recon.amount);
      grossProfitRating = rateGrossProfit(expectedGrossProfit, targetProfit);
    }
  }

  const verdict = decideVerdict({
    hasSufficientData: retailRange.sufficient,
    grossProfitRating,
    confidenceScore: confidence.score,
    daysToSellRisk,
    recommendedMaxBuyPrice,
    noProfitablePrice,
  });

  return {
    vehicle: { vin, year, make, model, mileage, condition: condition || null },
    marketSnapshot: {
      lowRetail: retailRange.low,
      avgRetail: retailRange.avg,
      highRetail: retailRange.high,
      comparablesUsed: retailRange.count,
      sufficientData: retailRange.sufficient,
    },
    reconEstimate: {
      amount: Math.round(recon.amount),
      source: recon.source,
      notes: recon.notes,
    },
    profitCalculation: {
      conservativeRetailValue,
      targetGrossProfit: targetProfit,
      riskBufferPct,
      riskBuffer,
      recommendedMaxBuyPrice,
      expectedGrossProfit,
      grossProfitRating,
    },
    riskAndConfidence: {
      daysToSellRisk,
      confidenceScore: confidence.score,
      confidenceReasons: confidence.reasons,
      missingData,
    },
    verdict,
    generatedAt: new Date().toISOString(),
  };
}
