'use server';

import { revalidatePath } from 'next/cache';
import { redirect as nextRedirect, unstable_rethrow } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { isOrderError, type OrderErrorCode } from '@/lib/orders/errors';
import { getPaymentPort } from '@/lib/orders/payments';
import { placeOrder } from '@/lib/orders/place';
import { rateLimit } from '@/lib/rate-limit';
import { idSchema, idempotencyKeySchema } from '@/lib/validation';

/**
 * Checkout server action: place the order (stock reserved, idempotent) and start its payment.
 * The browser never sends a price: the server re-prices everything; `expectedTotalBaisa` only
 * lets it refuse the order if the total changed since the customer reviewed it.
 */

export type CheckoutErrorKey =
  | OrderErrorCode
  | 'unauthenticated'
  | 'rate_limited'
  | 'invalid'
  | 'generic';

export type PlaceOrderResult = { ok: false; error: CheckoutErrorKey; details?: { totalBaisa?: number } };

const inputSchema = z.object({
  idempotencyKey: idempotencyKeySchema,
  addressId: idSchema,
  deliveryType: z.enum(['STANDARD', 'EXPRESS']),
  paymentMethod: z.enum(['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO']),
  promoCode: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(500).optional().nullable(),
  expectedTotalBaisa: z.number().int().min(0).max(2_000_000_000),
});

export type PlaceOrderInput = z.input<typeof inputSchema>;

/** Only https provider pages are ever followed. */
function safeProviderUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export async function placeOrderAction(raw: PlaceOrderInput): Promise<PlaceOrderResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = inputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const input = parsed.data;
  const locale = asLocale(await getLocale());

  let number: string;
  let orderId: string;
  try {
    if (!(await rateLimit(`checkout:user:${session.user.id}`, 20, 60_000)).ok) return { ok: false, error: 'rate_limited' };
    const placed = await placeOrder({
      userId: session.user.id,
      idempotencyKey: input.idempotencyKey,
      addressId: input.addressId,
      deliveryType: input.deliveryType,
      paymentMethod: input.paymentMethod,
      locale,
      promoCode: input.promoCode || null,
      notes: input.notes || null,
      expectedTotalBaisa: input.expectedTotalBaisa,
    });
    number = placed.number;
    orderId = placed.orderId;
  } catch (err) {
    unstable_rethrow(err);
    if (isOrderError(err)) {
      return { ok: false, error: err.code, ...(err.code === 'price_changed' && typeof err.details?.totalBaisa === 'number' ? { details: { totalBaisa: err.details.totalBaisa } } : {}) };
    }
    console.error('[checkout] placeOrder failed', err);
    return { ok: false, error: 'generic' };
  }

  // The order exists (items reserved, cart emptied). From here every outcome lands on the order page.
  revalidatePath('/', 'layout');
  let next: { kind: 'internal'; href: string } | { kind: 'external'; url: string };
  try {
    const result = await getPaymentPort().startOrderPayment(orderId, input.paymentMethod, {
      userId: session.user.id,
      idempotencyKey: `${input.idempotencyKey}-pay`,
      locale,
    });
    if (result.status === 'redirect') {
      const url = safeProviderUrl(result.url);
      next = url ? { kind: 'external', url } : { kind: 'internal', href: `/orders/${number}?pay=provider_error` };
    } else if (result.status === 'succeeded') {
      next = { kind: 'internal', href: `/orders/${number}?paid=1` };
    } else if (result.status === 'pending') {
      next = { kind: 'internal', href: `/orders/${number}?pay=pending` };
    } else {
      next = { kind: 'internal', href: `/orders/${number}?pay=${encodeURIComponent(result.reason)}` };
    }
  } catch (err) {
    unstable_rethrow(err);
    console.error('[checkout] startOrderPayment failed', err);
    next = { kind: 'internal', href: `/orders/${number}?pay=generic` };
  }
  if (next.kind === 'external') nextRedirect(next.url);
  return redirect({ href: next.href, locale });
}
