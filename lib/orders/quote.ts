import type { DeliveryType } from '@prisma/client';
import { prisma, type Db } from '@/lib/db';
import { loadLivePromotions, exhaustedPromotionsForUser } from '@/lib/catalog/promotions-db';
import { discountFor, isPromotionLive } from '@/lib/catalog/promotions';
import { priceCart, priceItems, toPromoLines, type PricedCartLine } from '@/lib/cart/pricing';
import { cartItems } from '@/lib/cart/store';
import { computeTotals } from '@/lib/cart/math';
import { aggregateParcel, quoteDelivery, type DeliveryQuote } from '@/lib/delivery/quote';
import { getAddress, type AddressWithGeo } from '@/lib/delivery/addresses';

/**
 * Checkout quote: the exact amounts placeOrder() will charge (same code path), computed
 * from the user's server cart, live prices/stock, live promotions and the delivery
 * engine (lib/delivery). A delivery type whose zone has no configured fee is reported
 * unavailable — never priced by guess.
 */

export type DeliveryOption = Pick<DeliveryQuote, 'available' | 'feeBaisa' | 'etaHours' | 'reason'> & { type: DeliveryType };

export type PromoStatus = 'none' | 'applied' | 'invalid' | 'not_better';

export type CheckoutQuote = {
  lines: PricedCartLine[];
  /** Every line purchasable as requested. */
  ready: boolean;
  subtotalBaisa: number;
  discountBaisa: number;
  promotionId: string | null;
  promoStatus: PromoStatus;
  address: AddressWithGeo | null;
  delivery: Record<DeliveryType, DeliveryOption> | null;
  expressEligible: boolean;
  /** Total for the requested delivery type (null when that type is unavailable / no address). */
  totalBaisa: number | null;
  deliveryFeeBaisa: number | null;
};

export type QuoteRequest = {
  userId: string;
  locale: string;
  addressId?: string | null;
  deliveryType?: DeliveryType | null;
  promoCode?: string | null;
};

export async function quoteLines(
  lines: PricedCartLine[],
  req: QuoteRequest,
  db: Db = prisma,
): Promise<CheckoutQuote> {
  const promotions = await loadLivePromotions(db);
  const excluded = promotions.length ? await exhaustedPromotionsForUser(req.userId, promotions, db) : new Set<string>();
  const code = req.promoCode?.trim().toUpperCase() || null;
  const priced = priceCart(lines, promotions, { code, excluded });

  let promoStatus: PromoStatus = 'none';
  if (code) {
    const coded = promotions.find((p) => p.code?.toUpperCase() === code);
    const usable = coded && !excluded.has(coded.id) && isPromotionLive(coded) && discountFor(coded, toPromoLines(lines));
    if (!usable) promoStatus = 'invalid';
    else promoStatus = priced.promotion?.id === coded.id ? 'applied' : 'not_better';
  }

  const subtotal = priced.totals.subtotalBaisa;
  const discount = priced.totals.discountBaisa;
  const ready = priced.totals.checkoutReady;
  const expressEligible = lines.every((l) => l.expressEligible);
  const address = req.addressId ? await getAddress(req.userId, req.addressId, db) : null;

  let delivery: Record<DeliveryType, DeliveryOption> | null = null;
  if (address && address.deletedAt === null && lines.length) {
    const parcel = aggregateParcel(lines.map((l) => ({ weightGrams: l.weightGrams, volumeCm3: l.volumeCm3, qty: l.allowedQty || l.qty })));
    const base = {
      wilayaId: address.wilayaId,
      governorateId: address.governorateId,
      weightGrams: parcel.weightGrams,
      volumeCm3: parcel.volumeCm3,
      subtotalBaisa: Math.max(0, subtotal - discount),
      expressEligible,
    };
    const [std, exp] = await Promise.all([quoteDelivery({ ...base, type: 'STANDARD' }, db), quoteDelivery({ ...base, type: 'EXPRESS' }, db)]);
    const pick = (q: DeliveryQuote, type: DeliveryType): DeliveryOption => ({
      type,
      available: q.available,
      feeBaisa: q.feeBaisa,
      etaHours: q.etaHours,
      reason: q.reason,
    });
    delivery = { STANDARD: pick(std, 'STANDARD'), EXPRESS: pick(exp, 'EXPRESS') };
  }

  let totalBaisa: number | null = null;
  let deliveryFeeBaisa: number | null = null;
  const chosen = req.deliveryType && delivery ? delivery[req.deliveryType] : null;
  if (chosen?.available && chosen.feeBaisa !== undefined) {
    deliveryFeeBaisa = chosen.feeBaisa;
    totalBaisa = computeTotals(
      lines.map((l) => ({ state: l.state, allowedQty: l.allowedQty, unitPriceBaisa: l.unitPriceBaisa, lineTotalBaisa: l.lineTotalBaisa })),
      { discountBaisa: discount, deliveryFeeBaisa: chosen.feeBaisa },
    ).totalBaisa;
  }

  return {
    lines,
    ready,
    subtotalBaisa: subtotal,
    discountBaisa: discount,
    promotionId: priced.promotion?.id ?? null,
    promoStatus,
    address: address && address.deletedAt === null ? address : null,
    delivery,
    expressEligible,
    totalBaisa,
    deliveryFeeBaisa,
  };
}

/** Quote the signed-in user's server cart. */
export async function quoteCheckout(req: QuoteRequest, db: Db = prisma): Promise<CheckoutQuote> {
  const items = await cartItems({ userId: req.userId }, db);
  const lines = await priceItems(items, req.locale, db);
  return quoteLines(lines, req, db);
}
