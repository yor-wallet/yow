'use server';

import { revalidatePath } from 'next/cache';
import { getLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { currentActor, errorState, type ActionState } from '@/lib/admin/action';
import { parseOmrToBaisa } from '@/lib/money';
import { reviewGiftCard, revealGiftCardCode } from '@/lib/payments/giftcards';
import { notifyCustomerOfGiftCardDecision } from '@/lib/payments/giftcard-emails';
import { rateLimit } from '@/lib/rate-limit';
import { can } from '@/lib/rbac';
import { isMoneyError } from '@/lib/wallet/errors';

/** Money errors with a gift-card specific text under `admin.errors.giftcard`. */
const GIFT_CARD_ERRORS: ReadonlySet<string> = new Set(['self_review', 'already_decided', 'invalid_amount', 'not_found', 'forbidden']);

/**
 * Finance decision on a customer's gift card: start the review, verify it (the value ACTUALLY encashed
 * is credited to the wallet, minus the exchange commission) or refuse it. Rules, ledger and audit live in
 * `reviewGiftCard`; the customer gets an in-app notice and an e-mail.
 */
export async function reviewGiftCardAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await currentActor();
  if (!actor || !can(actor.role, 'giftcards:review')) return { status: 'error', code: 'forbidden', at: Date.now() };
  const id = String(fd.get('id') ?? '').slice(0, 64);
  const decision = String(fd.get('decision') ?? '');
  const notes = String(fd.get('notes') ?? '').slice(0, 1000);
  if (decision !== 'UNDER_REVIEW' && decision !== 'VERIFIED' && decision !== 'REJECTED') {
    return { status: 'error', code: 'validation', fieldErrors: { decision: ['required'] }, at: Date.now() };
  }
  let encashedValueBaisa: number | null = null;
  if (decision === 'VERIFIED') {
    encashedValueBaisa = parseOmrToBaisa(String(fd.get('encashedValue') ?? ''), asLocale(await getLocale()));
    if (encashedValueBaisa === null || encashedValueBaisa <= 0) {
      return { status: 'error', code: 'validation', fieldErrors: { encashedValue: ['encashed_required'] }, at: Date.now() };
    }
  }
  if (decision === 'REJECTED' && !notes.trim()) {
    return { status: 'error', code: 'validation', fieldErrors: { notes: ['notes_required'] }, at: Date.now() };
  }
  let replayed = false;
  try {
    const res = await reviewGiftCard({ id, decision, encashedValueBaisa, notes, reviewerId: actor.id });
    replayed = res.replayed;
  } catch (err) {
    if (isMoneyError(err) && GIFT_CARD_ERRORS.has(err.code)) return { status: 'error', code: `giftcard.${err.code}`, at: Date.now() };
    return errorState(err);
  }
  if (!replayed && decision !== 'UNDER_REVIEW') await notifyCustomerOfGiftCardDecision(id);
  revalidatePath('/', 'layout');
  return { status: 'success', code: 'saved', at: Date.now() };
}

export type RevealCodeResult = { ok: true; code: string } | { ok: false; error: string };

/** Shows the card code to the reviewer. Every reveal is written to the audit log. */
export async function revealGiftCardCodeAction(id: string): Promise<RevealCodeResult> {
  const actor = await currentActor();
  if (!actor || !can(actor.role, 'giftcards:review')) return { ok: false, error: 'forbidden' };
  if (!(await rateLimit(`giftcard-reveal:${actor.id}`, 30, 10 * 60_000)).ok) return { ok: false, error: 'rate_limited' };
  try {
    return { ok: true, code: await revealGiftCardCode({ id: String(id).slice(0, 64), actorId: actor.id }) };
  } catch (err) {
    const code = err instanceof Error && typeof (err as { code?: unknown }).code === 'string' ? (err as unknown as { code: string }).code : 'generic';
    if (code === 'generic') console.error('[admin] gift card code reveal failed', err instanceof Error ? err.message : err);
    return { ok: false, error: code };
  }
}
