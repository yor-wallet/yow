/**
 * Price engine — pure integer maths over baisa (no floats for money).
 *
 *   recommended = roundUp( max( cost × (1 + targetMargin), marketAvg × (1 − competitiveness) ), step )
 *
 * - `marketAvg` uses VERIFIED observations when any exist (basis "verified"); otherwise all
 *   observations (basis "estimate"). With neither cost nor observations there is no recommendation.
 * - Rounded UP to the configured step (default 50 baisa = 0.050 OMR) so the price never
 *   drops below the cost floor because of rounding.
 * - Percentages are basis points (100 = 1%).
 * Observations are entered manually by staff from authorised sources (no scraping).
 */

export type Observation = { priceBaisa: number; verified: boolean };

export type PriceEngineParams = {
  targetMarginBps: number;
  competitivenessBps: number;
  roundingBaisa: number;
};

export type MarketStats = { count: number; avgBaisa: number; minBaisa: number; maxBaisa: number };

export type PriceAnalysis = {
  verified: MarketStats | null;
  all: MarketStats | null;
  /** cost × (1 + margin), rounded up to the baisa. */
  costFloorBaisa: number | null;
  /** market average × (1 − competitiveness). */
  marketTargetBaisa: number | null;
  marketBasis: 'verified' | 'estimate' | null;
  recommendedBaisa: number | null;
  /** "verified" only when the market term comes from verified observations (or cost alone drives it). */
  basis: 'verified' | 'estimate' | null;
  /** Which term won the max(): cost floor or market target. */
  driver: 'cost' | 'market' | null;
  current: { priceBaisa: number | null; marginBps: number | null; profitBaisa: number | null; deviationBps: number | null };
  recommended: { marginBps: number | null; profitBaisa: number | null };
  /** True when the cost is unknown (profit/margin cannot be computed). */
  costMissing: boolean;
};

function assertInt(n: number, label: string) {
  if (!Number.isSafeInteger(n)) throw new TypeError(`${label} must be an integer`);
}

export function marketStats(values: readonly number[]): MarketStats | null {
  if (values.length === 0) return null;
  let sum = 0;
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const v of values) {
    assertInt(v, 'observation');
    sum += v;
    if (v < min) min = v;
    if (v > max) max = v;
  }
  return { count: values.length, avgBaisa: Math.round(sum / values.length), minBaisa: min, maxBaisa: max };
}

/** Round UP to a multiple of `step` (step ≥ 1). */
export function roundUpToStep(baisa: number, step: number): number {
  assertInt(baisa, 'baisa');
  if (!Number.isInteger(step) || step < 1) throw new RangeError('step must be a positive integer');
  return Math.ceil(baisa / step) * step;
}

/** cost × (1 + bps/10000), rounded up to the baisa. */
export function applyMarkupUp(costBaisa: number, bps: number): number {
  assertInt(costBaisa, 'cost');
  return Math.ceil((costBaisa * (10_000 + bps)) / 10_000);
}

/** avg × (1 − bps/10000), rounded half up. */
export function applyDiscount(baisa: number, bps: number): number {
  assertInt(baisa, 'amount');
  return Math.round((baisa * (10_000 - bps)) / 10_000);
}

/** Gross margin on the selling price in basis points: (price − cost) / price. */
export function marginBps(priceBaisa: number | null, costBaisa: number | null): number | null {
  if (priceBaisa == null || costBaisa == null || priceBaisa <= 0) return null;
  return Math.round(((priceBaisa - costBaisa) * 10_000) / priceBaisa);
}

/** Signed deviation of `price` from `reference` in basis points. */
export function deviationBps(priceBaisa: number | null, referenceBaisa: number | null): number | null {
  if (priceBaisa == null || referenceBaisa == null || referenceBaisa <= 0) return null;
  return Math.round(((priceBaisa - referenceBaisa) * 10_000) / referenceBaisa);
}

export function analysePrice(
  input: { costBaisa: number | null; priceBaisa: number | null; observations: readonly Observation[] },
  params: PriceEngineParams,
): PriceAnalysis {
  const { costBaisa, priceBaisa } = input;
  const verified = marketStats(input.observations.filter((o) => o.verified).map((o) => o.priceBaisa));
  const all = marketStats(input.observations.map((o) => o.priceBaisa));

  const costFloorBaisa = costBaisa != null ? applyMarkupUp(costBaisa, params.targetMarginBps) : null;
  const marketRef = verified ?? all;
  const marketBasis: PriceAnalysis['marketBasis'] = verified ? 'verified' : all ? 'estimate' : null;
  const marketTargetBaisa = marketRef ? applyDiscount(marketRef.avgBaisa, params.competitivenessBps) : null;

  let raw: number | null = null;
  let driver: PriceAnalysis['driver'] = null;
  if (costFloorBaisa != null && marketTargetBaisa != null) {
    driver = costFloorBaisa >= marketTargetBaisa ? 'cost' : 'market';
    raw = Math.max(costFloorBaisa, marketTargetBaisa);
  } else if (costFloorBaisa != null) {
    driver = 'cost';
    raw = costFloorBaisa;
  } else if (marketTargetBaisa != null) {
    driver = 'market';
    raw = marketTargetBaisa;
  }
  const recommendedBaisa = raw != null && raw > 0 ? roundUpToStep(raw, params.roundingBaisa) : null;

  // "verified": every input of the recommendation is a real figure (known cost and/or verified market data).
  let basis: PriceAnalysis['basis'] = null;
  if (recommendedBaisa != null) {
    const marketOk = marketTargetBaisa == null || marketBasis === 'verified';
    const costOk = costBaisa != null;
    basis = marketOk && costOk ? 'verified' : 'estimate';
  }

  const profit = (p: number | null) => (p != null && costBaisa != null ? p - costBaisa : null);

  return {
    verified,
    all,
    costFloorBaisa,
    marketTargetBaisa,
    marketBasis,
    recommendedBaisa,
    basis,
    driver,
    current: {
      priceBaisa,
      marginBps: marginBps(priceBaisa, costBaisa),
      profitBaisa: profit(priceBaisa),
      deviationBps: deviationBps(priceBaisa, verified?.avgBaisa ?? null),
    },
    recommended: { marginBps: marginBps(recommendedBaisa, costBaisa), profitBaisa: profit(recommendedBaisa) },
    costMissing: costBaisa == null,
  };
}
