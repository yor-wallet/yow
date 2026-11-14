'use server';

import { revalidatePath } from 'next/cache';
import type { KycDocumentType } from '@prisma/client';
import { currentActor, errorState, type ActionState } from '@/lib/admin/action';
import { decideKyc, KycError, KYC_DOCUMENT_TYPES } from '@/lib/kyc';
import { notifyCustomerOfKycDecision } from '@/lib/kyc/emails';
import { getRequestMeta } from '@/lib/request';
import { can } from '@/lib/rbac';

/** Validate / refuse / ask for other documents. Rules, audit and in-app notice live in lib/kyc; the customer also gets an e-mail. */
export async function decideKycAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const actor = await currentActor();
  if (!actor || !can(actor.role, 'kyc:decide')) return { status: 'error', code: 'forbidden', at: Date.now() };
  const submissionId = String(fd.get('submissionId') ?? '');
  const decision = String(fd.get('decision') ?? '');
  const notes = String(fd.get('notes') ?? '').slice(0, 2000);
  const requestedDocs = KYC_DOCUMENT_TYPES.filter((t) => fd.get(`doc_${t}`)) as KycDocumentType[];
  if (decision !== 'VERIFIED' && decision !== 'REJECTED' && decision !== 'DOCUMENTS_REQUESTED') {
    return { status: 'error', code: 'validation', fieldErrors: { decision: ['required'] }, at: Date.now() };
  }
  try {
    await decideKyc({ submissionId, decision, notes, reviewerId: actor.id, requestedDocs, meta: await getRequestMeta() });
  } catch (err) {
    if (err instanceof KycError && err.code === 'notes_required') return { status: 'error', code: 'validation', fieldErrors: { notes: ['kyc_notes_required'] }, at: Date.now() };
    if (err instanceof KycError && err.code === 'requested_docs_required') return { status: 'error', code: 'validation', fieldErrors: { requestedDocs: ['kyc_docs_required'] }, at: Date.now() };
    return errorState(err);
  }
  await notifyCustomerOfKycDecision(submissionId);
  revalidatePath('/', 'layout');
  return { status: 'success', code: 'saved', at: Date.now() };
}
