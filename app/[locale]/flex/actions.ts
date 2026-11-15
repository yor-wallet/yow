'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { idempotencyKeySchema, idSchema } from '@/lib/validation';
import { asLocale } from '@/i18n/routing';
import { isMoneyError } from '@/lib/wallet/errors';
import { acceptFlexTerms, applyForFlex, cancelFlexApplication, payInstallment } from '@/lib/flex';
import { startInstallmentPayment } from '@/lib/payments/core';
import { notifyStaffOfFlexApplication } from '@/lib/flex/emails';

export type FlexActionResult = { ok: true; applicationId?: string; intentId?: string; pending?: boolean } | { ok: false; error: string; reason?: string };

function fail(err: unknown, scope: string): FlexActionResult {
  unstable_rethrow(err);
  if (isMoneyError(err)) {
    const reason = typeof err.details?.reason === 'string' ? err.details.reason : Array.isArray(err.details?.reasons) ? String(err.details.reasons[0]) : undefined;
    return { ok: false, error: err.code, reason };
  }
  console.error(`[flex] ${scope} failed`, err);
  return { ok: false, error: 'generic' };
}

const applySchema = z.object({
  productId: idSchema,
  variantId: idSchema,
  months: z.coerce.number().int(),
  idempotencyKey: idempotencyKeySchema,
});

export async function applyFlexAction(raw: z.input<typeof applySchema>): Promise<FlexActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = applySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  try {
    if (!(await rateLimit(`flex-apply:${session.user.id}`, 10, 10 * 60_000)).ok) return { ok: false, error: 'rate_limited' };
    const res = await applyForFlex({ userId: session.user.id, ...parsed.data });
    if (!res.replayed) await notifyStaffOfFlexApplication(res.applicationId);
    revalidatePath('/[locale]/flex', 'layout');
    return { ok: true, applicationId: res.applicationId };
  } catch (err) {
    return fail(err, 'apply');
  }
}

const acceptSchema = z.object({
  applicationId: idSchema,
  addressId: idSchema,
  expectedTotalBaisa: z.number().int().positive(),
  termsVersion: z.string().min(1).max(64),
  acceptTerms: z.literal(true),
});

export async function acceptFlexAction(raw: z.input<typeof acceptSchema>): Promise<FlexActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = acceptSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.some((i) => i.path[0] === 'acceptTerms') ? 'terms_required' : 'invalid_input' };
  try {
    if (!(await rateLimit(`flex-accept:${session.user.id}`, 10, 10 * 60_000)).ok) return { ok: false, error: 'rate_limited' };
    const res = await acceptFlexTerms({ ...parsed.data, userId: session.user.id, locale: asLocale(await getLocale()) });
    revalidatePath('/[locale]/flex', 'layout');
    return { ok: true, applicationId: res.applicationId };
  } catch (err) {
    return fail(err, 'accept');
  }
}

const paySchema = z.object({ installmentId: idSchema, idempotencyKey: idempotencyKeySchema, method: z.enum(['WALLET', 'CRYPTO']).default('WALLET') });

export async function payInstallmentAction(raw: z.input<typeof paySchema>): Promise<FlexActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = paySchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  try {
    if (!(await rateLimit(`flex-pay:${session.user.id}`, 20, 60_000)).ok) return { ok: false, error: 'rate_limited' };
    const { installmentId, idempotencyKey, method } = parsed.data;
    // Wallet: paid at once (atomic). Crypto: a payment is opened; the instalment is marked paid once the
    // transfer is verified on the blockchain (the customer continues on the payment page).
    const res =
      method === 'CRYPTO'
        ? await startInstallmentPayment(installmentId, 'CRYPTO', session.user.id, idempotencyKey, { locale: asLocale(await getLocale()) })
        : await payInstallment({ userId: session.user.id, installmentId, idempotencyKey });
    revalidatePath('/[locale]/flex', 'layout');
    revalidatePath('/[locale]/wallet', 'page');
    if (res.status === 'failed') return { ok: false, error: res.reason };
    return { ok: true, intentId: res.intentId, pending: res.status !== 'succeeded' };
  } catch (err) {
    return fail(err, 'pay');
  }
}

export async function cancelFlexAction(applicationId: string): Promise<FlexActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  if (!idSchema.safeParse(applicationId).success) return { ok: false, error: 'invalid_input' };
  try {
    await cancelFlexApplication({ applicationId, userId: session.user.id });
    revalidatePath('/[locale]/flex', 'layout');
    return { ok: true, applicationId };
  } catch (err) {
    return fail(err, 'cancel');
  }
}
