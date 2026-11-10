import 'server-only';
import { quoteDeliveryOptions, aggregateParcel, type DeliveryTypeInput, type QuoteUnavailableReason } from '@/lib/delivery/quote';
import { listPaymentMethods } from '@/lib/payments/registry';
import type { PaymentMethodId, UnavailableReason } from '@/lib/payments/types';
import { currentCartOwner } from './index';
import { priceItems } from './pricing';
import { cartItems } from './store';

/**
 * What the cart page may say before checkout: delivery options quoted for the shopper's area with the
 * real parcel, and which payment methods are really usable. Nothing here is a promise the checkout would
 * not make: the same quote engine and the same payment registry are used, and anything not configured
 * comes back unavailable with its reason.
 */

export type CartDeliveryOption = {
  type: DeliveryTypeInput;
  available: boolean;
  feeBaisa: number | null;
  etaHours: number | null;
  reason: QuoteUnavailableReason | null;
};

export type CartPaymentOption = { id: PaymentMethodId; available: boolean; reason: UnavailableReason | null };

export type CartPreview = {
  /** null = no delivery area chosen yet (nothing can be quoted). */
  delivery: CartDeliveryOption[] | null;
  payments: CartPaymentOption[];
};

/** Methods an order can be paid with at checkout (FLEX and gift cards have their own flows). */
const CART_METHODS: readonly PaymentMethodId[] = ['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO'];

export async function getCartPreview(input: { locale: string; governorateId: string | null; subtotalBaisa: number; totalBaisa: number; userId: string | null }): Promise<CartPreview> {
  const methods = await listPaymentMethods({ purpose: 'ORDER', amountBaisa: input.totalBaisa, userId: input.userId });
  const payments = CART_METHODS.flatMap((id) => {
    const m = methods.find((x) => x.id === id);
    return m ? [{ id, available: m.available, reason: m.reason ?? null }] : [];
  });
  if (!input.governorateId) return { delivery: null, payments };

  const owner = await currentCartOwner();
  const lines = (await priceItems(owner ? await cartItems(owner) : [], input.locale)).filter((l) => l.state === 'ok' || l.state === 'qty_reduced');
  const parcel = aggregateParcel(lines.map((l) => ({ weightGrams: l.weightGrams, volumeCm3: l.volumeCm3, qty: l.allowedQty })));
  const quotes = await quoteDeliveryOptions({
    governorateId: input.governorateId,
    weightGrams: parcel.weightGrams,
    volumeCm3: parcel.volumeCm3,
    subtotalBaisa: input.subtotalBaisa,
    expressEligible: lines.every((l) => l.expressEligible),
  });
  const delivery = (['STANDARD', 'EXPRESS'] as const).map((type) => {
    const q = quotes[type];
    return { type, available: q.available, feeBaisa: q.available ? (q.feeBaisa ?? null) : null, etaHours: q.available ? (q.etaHours ?? null) : null, reason: q.available ? null : (q.reason ?? null) };
  });
  return { delivery, payments };
}
