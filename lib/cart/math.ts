import { assertBaisa } from '@/lib/money';
import { MAX_QTY_PER_LINE } from '@/lib/catalog/stock';

/**
 * Cart arithmetic (pure). Prices are NEVER stored in the cart: every evaluation uses
 * the current server-side variant price and availability.
 */

export type LineState = 'ok' | 'qty_reduced' | 'out_of_stock' | 'unavailable';

export type LineInput = {
  qty: number;
  /** Current unit price (null ⇒ price unavailable ⇒ not sellable). */
  priceBaisa: number | null;
  /** `stock - reserved` right now. */
  available: number;
  /** Product ACTIVE + sellable and variant active. */
  sellable: boolean;
};

export type EvaluatedLine = {
  state: LineState;
  /** Quantity that can actually be bought now (0 when not purchasable). */
  allowedQty: number;
  unitPriceBaisa: number | null;
  /** `unitPrice * allowedQty` (0 when not purchasable). */
  lineTotalBaisa: number;
};

/** Clamp a requested quantity to [0, min(available, MAX_QTY_PER_LINE)]. */
export function clampQty(requested: number, available: number): number {
  if (!Number.isFinite(requested)) return 0;
  const q = Math.trunc(requested);
  return Math.max(0, Math.min(q, Math.max(0, Math.trunc(available)), MAX_QTY_PER_LINE));
}

/** Quantity after merging two lines of the same variant (e.g. anonymous cart → user cart). */
export function mergeQty(a: number, b: number, available: number): number {
  return clampQty(a + b, available);
}

export function evaluateLine(line: LineInput): EvaluatedLine {
  if (!line.sellable || line.priceBaisa === null) {
    return { state: 'unavailable', allowedQty: 0, unitPriceBaisa: line.priceBaisa, lineTotalBaisa: 0 };
  }
  assertBaisa(line.priceBaisa, 'priceBaisa');
  if (line.available <= 0) return { state: 'out_of_stock', allowedQty: 0, unitPriceBaisa: line.priceBaisa, lineTotalBaisa: 0 };
  const allowedQty = clampQty(line.qty, line.available);
  const state: LineState = allowedQty < line.qty ? 'qty_reduced' : 'ok';
  return { state, allowedQty, unitPriceBaisa: line.priceBaisa, lineTotalBaisa: line.priceBaisa * allowedQty };
}

export type CartTotals = {
  subtotalBaisa: number;
  discountBaisa: number;
  deliveryFeeBaisa: number;
  totalBaisa: number;
  /** Units that can be bought now. */
  itemCount: number;
  /** True when every line is purchasable as requested (no warnings) and the cart is not empty. */
  checkoutReady: boolean;
};

export function computeTotals(
  lines: readonly EvaluatedLine[],
  opts: { discountBaisa?: number; deliveryFeeBaisa?: number } = {},
): CartTotals {
  const subtotalBaisa = lines.reduce((s, l) => s + l.lineTotalBaisa, 0);
  assertBaisa(subtotalBaisa, 'subtotal');
  const discountBaisa = Math.max(0, Math.min(opts.discountBaisa ?? 0, subtotalBaisa));
  const deliveryFeeBaisa = Math.max(0, opts.deliveryFeeBaisa ?? 0);
  assertBaisa(discountBaisa, 'discount');
  assertBaisa(deliveryFeeBaisa, 'deliveryFee');
  return {
    subtotalBaisa,
    discountBaisa,
    deliveryFeeBaisa,
    totalBaisa: subtotalBaisa - discountBaisa + deliveryFeeBaisa,
    itemCount: lines.reduce((s, l) => s + l.allowedQty, 0),
    checkoutReady: lines.length > 0 && lines.every((l) => l.state === 'ok'),
  };
}
