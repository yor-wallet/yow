/**
 * Stock helpers (pure). Sellable quantity is always `stock - reserved` — reservations
 * are taken at order placement (lib/orders) and converted / released later.
 */

export type Availability = 'in_stock' | 'low_stock' | 'out_of_stock' | 'unavailable';

/** Maximum quantity of one variant per cart line / order line. */
export const MAX_QTY_PER_LINE = 10;

export function availableQty(stock: number, reserved: number): number {
  return Math.max(0, Math.trunc(stock) - Math.trunc(reserved));
}

export type StockLike = {
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  priceBaisa: number | null;
  isActive?: boolean;
};

/**
 * Availability of one variant. A variant without a price (or inactive, or on a product
 * whose sale is disabled) is `unavailable` — never sellable, whatever the stock.
 */
export function variantAvailability(v: StockLike, productSellable = true): Availability {
  if (!productSellable || v.isActive === false || v.priceBaisa === null) return 'unavailable';
  const qty = availableQty(v.stock, v.reserved);
  if (qty <= 0) return 'out_of_stock';
  if (qty <= Math.max(0, v.lowStockThreshold)) return 'low_stock';
  return 'in_stock';
}

/** Aggregate availability of a product from its variants. */
export function productAvailability(variants: readonly StockLike[], productSellable = true): Availability {
  const sellable = variants.filter((v) => variantAvailability(v, productSellable) !== 'unavailable');
  if (sellable.length === 0) return 'unavailable';
  const states = sellable.map((v) => variantAvailability(v, productSellable));
  if (states.includes('in_stock')) return 'in_stock';
  if (states.includes('low_stock')) return 'low_stock';
  return 'out_of_stock';
}

/** Largest quantity a customer may hold in a cart line for this variant. */
export function maxPurchasable(stock: number, reserved: number): number {
  return Math.min(MAX_QTY_PER_LINE, availableQty(stock, reserved));
}

export function isPurchasable(v: StockLike, productSellable = true): boolean {
  const a = variantAvailability(v, productSellable);
  return a === 'in_stock' || a === 'low_stock';
}
