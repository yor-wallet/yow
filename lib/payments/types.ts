import type { PaymentProvider, PaymentPurpose } from '@prisma/client';

export type PaymentMethodId = PaymentProvider; // 'WALLET' | 'CARD' | 'OOREDOO' | 'OMANTEL' | 'CRYPTO' | 'GIFT_CARD' | 'FLEX'
export type PaymentPurposeKey = PaymentPurpose; // 'TOPUP' | 'ORDER' | 'INSTALLMENT'

/** Providers reached through an external adapter (hosted page / carrier / crypto processor). */
export type ExternalProviderId = 'CARD' | 'OOREDOO' | 'OMANTEL' | 'CRYPTO';

export const EXTERNAL_PROVIDERS: readonly ExternalProviderId[] = ['CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO'];

export function isExternalProvider(id: string): id is ExternalProviderId {
  return (EXTERNAL_PROVIDERS as readonly string[]).includes(id);
}

/**
 * Why a method cannot be used right now. Translated by the UI with
 * `payments.reasons.<reason>`.
 */
export type UnavailableReason =
  | 'not_configured'
  | 'carrier_agreement_required'
  | 'licensed_processor_required'
  | 'login_required'
  | 'insufficient_balance'
  | 'wallet_frozen'
  | 'gift_card_via_wallet'
  | 'flex_apply_from_product'
  | 'amount_below_minimum'
  | 'amount_above_maximum';

export type PaymentMethodOption = {
  id: PaymentMethodId;
  available: boolean;
  reason?: UnavailableReason;
  /** Key in the `payments` namespace: `methods.<ID>.label`. */
  labelKey: `methods.${PaymentMethodId}.label`;
  /** Key in the `payments` namespace: `methods.<ID>.description`. */
  descriptionKey: `methods.${PaymentMethodId}.description`;
  /** Minimum amount accepted by the provider (baisa), when known. */
  minAmountBaisa?: number;
};

export type PaymentContext = {
  purpose?: PaymentPurposeKey;
  amountBaisa: number;
  userId?: string | null;
};

// ───────────── Provider adapters ─────────────

export type ProviderCustomer = { id: string; email: string; fullName: string; phone: string | null };

export type ProviderPaymentInput = {
  intentId: string;
  amountBaisa: number;
  purpose: PaymentPurposeKey;
  /** Short human description (<= 40 chars for card gateways). */
  description: string;
  locale: 'ar' | 'en' | 'fr';
  /** Customer comes back here after paying (our `/[locale]/pay/[intentId]`). */
  returnUrl: string;
  cancelUrl: string;
  /** Server-to-server notification URL (`/api/webhooks/<slug>`). */
  webhookUrl: string;
  customer: ProviderCustomer;
};

export type CreatePaymentResult = {
  providerRef: string;
  /** Hosted payment page to send the browser to. */
  redirectUrl?: string;
  /** Provider-supplied instructions (carrier USSD/SMS approval, wallet address…). */
  instructions?: string;
  expiresAt?: Date;
};

export type ProviderStatus = {
  status: 'paid' | 'pending' | 'failed' | 'cancelled' | 'expired';
  /** Amount the provider CONFIRMS as paid/settled, in baisa (OMR). Only meaningful when paid. */
  amountBaisa?: number;
  /** Our intent id as echoed back by the provider (client reference), when available. */
  clientReference?: string | null;
  raw?: unknown;
};

export type WebhookEvent = {
  /** Provider event id (or a hash of the raw body when the provider sends none) — replay key. */
  eventId: string;
  type: string | null;
  /** Provider payment reference the event is about (session id / payment id / invoice id). */
  providerRef: string | null;
  signatureVerified: boolean;
  payload: unknown;
};

export type RefundResult = { providerRef: string };

export interface ProviderAdapter {
  readonly id: ExternalProviderId;
  /** URL slug: `/api/webhooks/<slug>`. */
  readonly slug: string;
  readonly displayName: string;
  /** Reason shown when `isConfigured()` is false. */
  readonly unavailableReason: UnavailableReason;
  readonly minAmountBaisa?: number;
  isConfigured(): boolean;
  createPayment(input: ProviderPaymentInput): Promise<CreatePaymentResult>;
  /** Throws `WebhookSignatureError` when a signature is present/required and invalid. */
  verifyWebhook(req: { headers: Headers; rawBody: string }): Promise<WebhookEvent>;
  fetchStatus(providerRef: string): Promise<ProviderStatus>;
  /** Optional provider refund (full amount). Throws `ProviderError` when unsupported. */
  refund?(args: { providerRef: string; amountBaisa: number; reason: string }): Promise<RefundResult>;
  supportsRefund?(): boolean;
}

export class ProviderError extends Error {
  constructor(
    public readonly provider: string,
    public readonly code: string,
    message?: string,
    public readonly httpStatus?: number,
  ) {
    super(message ?? `${provider}: ${code}`);
    this.name = 'ProviderError';
  }
}

export class WebhookSignatureError extends Error {
  constructor(public readonly provider: string, message = 'Invalid webhook signature') {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export type StartPaymentResult =
  | { status: 'redirect'; url: string; intentId: string; replayed: boolean }
  | { status: 'succeeded'; intentId: string; replayed: boolean }
  | { status: 'pending'; intentId: string; instructions?: string; replayed: boolean }
  | { status: 'failed'; reason: string; intentId?: string; replayed: boolean };
