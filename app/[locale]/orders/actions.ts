'use server';

import { revalidatePath } from 'next/cache';
import { redirect as nextRedirect, unstable_rethrow } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { cancelOrder } from '@/lib/orders/lifecycle';
import { ORDER_NUMBER_RE } from '@/lib/orders/number';
import { getPaymentPort } from '@/lib/orders/payments';
import { rateLimit } from '@/lib/rate-limit';
import { idempotencyKeySchema } from '@/lib/validation';

export type OrderActionResult = { ok: false; error: string } | { ok: true };

const paySchema = z.object({
  number: z.string().regex(ORDER_NUMBER_RE),
  method: z.enum(['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO']),
  idempotencyKey: idempotencyKeySchema,
});

function safeProviderUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === 'https:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** (Re)start the payment of an unpaid order. Redirects on success; returns an error code otherwise. */
export async function payOrderAction(raw: z.input<typeof paySchema>): Promise<OrderActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = paySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const { number, method, idempotencyKey } = parsed.data;
  const locale = asLocale(await getLocale());

  let target: { kind: 'internal'; href: string } | { kind: 'external'; url: string };
  try {
    if (!(await rateLimit(`pay:user:${session.user.id}`, 20, 60_000)).ok) return { ok: false, error: 'provider_unavailable' };
    const order = await prisma.order.findFirst({ where: { number, userId: session.user.id }, select: { id: true, status: true } });
    if (!order) return { ok: false, error: 'not_found' };
    if (order.status !== 'PENDING_PAYMENT') return { ok: false, error: 'order_not_payable' };
    const result = await getPaymentPort().startOrderPayment(order.id, method, { userId: session.user.id, idempotencyKey, locale });
    if (result.status === 'failed') return { ok: false, error: result.reason };
    if (result.status === 'redirect') {
      const url = safeProviderUrl(result.url);
      if (!url) return { ok: false, error: 'provider_error' };
      target = { kind: 'external', url };
    } else {
      target = {
        kind: 'internal',
        href: result.status === 'succeeded' ? `/orders/${number}?paid=1` : method === 'CRYPTO' ? `/pay/${result.intentId}` : `/orders/${number}?pay=pending`,
      };
    }
  } catch (err) {
    unstable_rethrow(err);
    console.error('[orders] pay failed', err);
    return { ok: false, error: 'generic' };
  }
  revalidatePath('/', 'layout');
  if (target.kind === 'external') nextRedirect(target.url);
  return redirect({ href: target.href, locale });
}

/** Customer cancellation of an UNPAID order (releases the reserved stock). */
export async function cancelOrderAction(number: string): Promise<OrderActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  if (!ORDER_NUMBER_RE.test(number)) return { ok: false, error: 'not_found' };
  try {
    const order = await prisma.order.findFirst({ where: { number, userId: session.user.id }, select: { id: true } });
    if (!order) return { ok: false, error: 'not_found' };
    const res = await cancelOrder(order.id, { reason: 'customer_cancelled', userId: session.user.id, actorId: session.user.id, actorRole: session.user.role });
    if (!res.ok) return { ok: false, error: res.reason };
    revalidatePath('/', 'layout');
    return { ok: true };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[orders] cancel failed', err);
    return { ok: false, error: 'generic' };
  }
}
