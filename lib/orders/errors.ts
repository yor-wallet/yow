export type OrderErrorCode =
  | 'cart_empty'
  | 'cart_changed'
  | 'out_of_stock'
  | 'address_not_found'
  | 'delivery_unavailable'
  | 'price_changed'
  | 'promo_invalid'
  | 'payment_unavailable'
  | 'idempotency_conflict'
  | 'not_found'
  | 'not_cancellable';

export class OrderError extends Error {
  constructor(
    public readonly code: OrderErrorCode,
    public readonly details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = 'OrderError';
  }
}

export function isOrderError(err: unknown): err is OrderError {
  return err instanceof OrderError;
}
