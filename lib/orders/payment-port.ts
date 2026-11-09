import type { PaymentProvider } from '@prisma/client';

/**
 * Payment port consumed by the storefront checkout (lib/orders + checkout UI).
 *
 * The money module owns the implementation (`lib/payments/registry.ts` →
 * `listPaymentMethods()` and `lib/payments/core.ts` → `startOrderPayment(...)`), bound in
 * `lib/orders/payments.ts`.
 * The storefront only depends on this interface; `getPaymentPort()` binds it to the
 * money module's registry. A method that is not configured (missing contract /
 * credentials) MUST be reported as `available: false` with a reason — never faked.
 */

export type PaymentMethodId = PaymentProvider;

export type PaymentMethodStatus = {
  id: PaymentMethodId;
  available: boolean;
  /** Machine-readable reason when unavailable, e.g. `not_configured`, `kyc_required`, `insufficient_balance`. */
  reason?: string | null;
};

export type StartOrderPaymentResult =
  /** Send the browser to the provider (hosted payment page, 3-D Secure, carrier consent…). */
  | { status: 'redirect'; url: string; intentId: string }
  /** Confirmed synchronously (e.g. wallet balance) — the order is already PAID. */
  | { status: 'succeeded'; intentId: string }
  /** Waiting for an asynchronous confirmation (webhook / admin verification). */
  | { status: 'pending'; intentId: string }
  /** `reason` = money module error code (insufficient_balance, method_unavailable, order_already_paid…). */
  | { status: 'failed'; reason: string; intentId: string | null };

export interface OrderPaymentPort {
  /** Methods for an order of `amountBaisa` placed by `userId`, in display order. */
  listPaymentMethods(ctx: { userId: string; amountBaisa: number }): Promise<PaymentMethodStatus[]>;
  /** Start paying an order (PENDING_PAYMENT). Idempotent per `idempotencyKey`. */
  startOrderPayment(
    orderId: string,
    method: PaymentMethodId,
    ctx: { userId: string; idempotencyKey: string; locale: 'ar' | 'en' | 'fr' },
  ): Promise<StartOrderPaymentResult>;
}

/** Display order of every provider the checkout knows about. */
export const PAYMENT_METHOD_ORDER: readonly PaymentMethodId[] = ['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO', 'FLEX', 'GIFT_CARD'];
