'use server';

import { revalidatePath } from 'next/cache';
import { currentActor, errorState, type ActionState } from '@/lib/admin/action';
import { decideFlexApplication } from '@/lib/flex';
import { notifyCustomerOfFlexDecision } from '@/lib/flex/emails';
import { can } from '@/lib/rbac';
import { isMoneyError } from '@/lib/wallet/errors';

/** Money errors with a FLEX specific text under `admin.errors.flex`. */
const FLEX_ERRORS: ReadonlySet<string> = new Set(['self_review', 'flex_invalid_state', 'kyc_required', 'not_found', 'forbidden']);

/**
 * Finance decision on an instalment application: approve, refuse (note required) or mark as being
 * reviewed. Rules, identity check and audit live in `decideFlexApplication`; the customer gets an in-app
 * notice and an e-mail. Approving creates nothing yet: the schedule exists once the customer accepts the terms.
 */
export async function decideFlexAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await currentActor();
  if (!actor || !can(actor.role, 'flex:decide')) return { status: 'error', code: 'forbidden', at: Date.now() };
  const id = String(fd.get('id') ?? '').slice(0, 64);
  const decision = String(fd.get('decision') ?? '');
  const notes = String(fd.get('notes') ?? '').slice(0, 1000);
  if (decision !== 'UNDER_REVIEW' && decision !== 'APPROVED' && decision !== 'REJECTED') {
    return { status: 'error', code: 'validation', fieldErrors: { decision: ['required'] }, at: Date.now() };
  }
  if (decision === 'REJECTED' && notes.trim().length < 3) {
    return { status: 'error', code: 'validation', fieldErrors: { notes: ['notes_required'] }, at: Date.now() };
  }
  let replayed = false;
  try {
    replayed = (await decideFlexApplication({ id, decision, actorId: actor.id, notes, source: 'staff' })).replayed;
  } catch (err) {
    if (isMoneyError(err) && FLEX_ERRORS.has(err.code)) return { status: 'error', code: `flex.${err.code}`, at: Date.now() };
    return errorState(err);
  }
  if (!replayed && decision !== 'UNDER_REVIEW') await notifyCustomerOfFlexDecision(id);
  revalidatePath('/', 'layout');
  return { status: 'success', code: 'saved', at: Date.now() };
}
