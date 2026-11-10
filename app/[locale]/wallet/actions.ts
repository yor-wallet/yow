'use server';

import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getLocale } from 'next-intl/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { parseOmrToBaisa } from '@/lib/money';
import { rateLimit } from '@/lib/rate-limit';
import { idempotencyKeySchema } from '@/lib/validation';
import { asLocale } from '@/i18n/routing';
import { isMoneyError } from '@/lib/wallet/errors';
import { startTopUp } from '@/lib/payments/core';
import { submitGiftCard } from '@/lib/payments/giftcards';
import { isExternalProvider } from '@/lib/payments/types';

export type TopUpActionResult =
  | { ok: true; intentId: string; redirectUrl?: string; status: string }
  | { ok: false; error: string; details?: Record<string, unknown> };

const topUpSchema = z.object({
  methodId: z.string().refine(isExternalProvider),
  amount: z.string().trim().min(1).max(20),
  idempotencyKey: idempotencyKeySchema,
});

/** Only send the browser to an https provider page (http allowed outside production for local sandboxes). */
function safeRedirect(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.protocol === 'https:' || (process.env.NODE_ENV !== 'production' && u.protocol === 'http:')) return u.toString();
  } catch {
    /* invalid */
  }
  return null;
}

export async function topUpAction(raw: z.input<typeof topUpSchema>): Promise<TopUpActionResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  const parsed = topUpSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: 'invalid_input' };
  const locale = asLocale(await getLocale());
  const amountBaisa = parseOmrToBaisa(parsed.data.amount, locale);
  if (amountBaisa === null || amountBaisa <= 0) return { ok: false, error: 'invalid_amount' };
  try {
    if (!(await rateLimit(`topup:user:${session.user.id}`, 10, 60_000)).ok) return { ok: false, error: 'rate_limited' };
    const res = await startTopUp(session.user.id, parsed.data.methodId as 'CARD', amountBaisa, parsed.data.idempotencyKey, { locale });
    revalidatePath('/[locale]/wallet', 'page');
    if (res.status === 'redirect') {
      const url = safeRedirect(res.url);
      return url ? { ok: true, intentId: res.intentId, redirectUrl: url, status: res.status } : { ok: false, error: 'provider_error' };
    }
    if (res.status === 'failed') return { ok: false, error: res.reason };
    return { ok: true, intentId: res.intentId, status: res.status };
  } catch (err) {
    unstable_rethrow(err);
    if (isMoneyError(err)) return { ok: false, error: err.code, details: err.details };
    console.error('[wallet] top-up failed', err);
    return { ok: false, error: 'generic' };
  }
}

export type GiftCardFormState = {
  status: 'idle' | 'success' | 'error';
  id?: string;
  error?: string;
  fieldErrors?: Record<string, string[]>;
  values?: { brand?: string; currency?: string; value?: string };
};

export async function submitGiftCardAction(_prev: GiftCardFormState, formData: FormData): Promise<GiftCardFormState> {
  const values = {
    brand: String(formData.get('brand') ?? ''),
    currency: String(formData.get('currency') ?? 'OMR'),
    value: String(formData.get('value') ?? ''),
  };
  const session = await getSession();
  if (!session) return { status: 'error', error: 'unauthenticated', values };
  if (formData.get('consent') !== 'on') return { status: 'error', error: 'invalid_input', fieldErrors: { consent: ['consent_required'] }, values };
  const photo = formData.get('photo');
  let buffer: Buffer | null = null;
  if (photo instanceof File && photo.size > 0) {
    if (photo.size > 8 * 1024 * 1024) return { status: 'error', error: 'invalid_image', fieldErrors: { photo: ['invalid_image'] }, values };
    buffer = Buffer.from(await photo.arrayBuffer());
  }
  try {
    if (!(await rateLimit(`giftcard:user:${session.user.id}`, 10, 10 * 60_000)).ok) return { status: 'error', error: 'rate_limited', values };
    const res = await submitGiftCard({
      userId: session.user.id,
      data: { brand: values.brand as 'APPLE', code: String(formData.get('code') ?? ''), currency: values.currency as 'OMR', value: values.value },
      photo: buffer,
    });
    revalidatePath('/[locale]/wallet', 'page');
    return { status: 'success', id: res.id };
  } catch (err) {
    unstable_rethrow(err);
    if (isMoneyError(err)) {
      const fe = (err.details?.fieldErrors ?? undefined) as Record<string, string[]> | undefined;
      const fieldErrors = fe ?? (err.code === 'duplicate_code' ? { code: ['duplicate_code'] } : err.code === 'invalid_image' ? { photo: ['invalid_image'] } : undefined);
      const error = err.details?.reason === 'too_many_open' ? 'too_many_open' : err.code;
      return { status: 'error', error, fieldErrors, values };
    }
    console.error('[wallet] gift card submission failed', err);
    return { status: 'error', error: 'generic', values };
  }
}
