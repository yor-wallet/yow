/**
 * Errors raised by the money module (wallet, ledger, payments, gift cards, FLEX, refunds).
 * `code` is a stable machine-readable identifier: UIs translate it with
 * `payments.errors.<code>` (messages/*\/payments.json), APIs return it as `error.code`.
 */

export const MONEY_ERROR_STATUS = {
  // validation / client errors
  invalid_input: 422,
  invalid_amount: 422,
  amount_below_minimum: 422,
  amount_above_maximum: 422,
  balance_limit_exceeded: 422,
  method_unavailable: 422,
  idempotency_key_reused: 409,
  // ledger
  ledger_unbalanced: 500,
  ledger_invalid_entries: 500,
  ledger_integrity: 500,
  idempotency_conflict: 409,
  insufficient_balance: 402,
  wallet_frozen: 423,
  // payments
  not_found: 404,
  forbidden: 403,
  order_not_payable: 409,
  order_already_paid: 409,
  provider_unavailable: 502,
  provider_error: 502,
  provider_ref_mismatch: 409,
  payment_not_pending: 409,
  // gift cards
  duplicate_code: 409,
  invalid_image: 422,
  already_decided: 409,
  self_review: 403,
  // refunds
  refund_exceeds_paid: 422,
  order_not_refundable: 409,
  flex_partial_refund_unsupported: 422,
  // flex
  kyc_required: 403,
  flex_not_eligible: 422,
  flex_invalid_state: 409,
  flex_active_limit: 409,
  terms_required: 422,
  installment_not_payable: 409,
  orders_unavailable: 503,
} as const;

export type MoneyErrorCode = keyof typeof MONEY_ERROR_STATUS;

export class MoneyError extends Error {
  readonly status: number;
  constructor(
    public readonly code: MoneyErrorCode,
    message?: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message ?? code);
    this.name = 'MoneyError';
    this.status = MONEY_ERROR_STATUS[code];
  }
}

export function isMoneyError(err: unknown, code?: MoneyErrorCode): err is MoneyError {
  return err instanceof MoneyError && (code === undefined || err.code === code);
}
