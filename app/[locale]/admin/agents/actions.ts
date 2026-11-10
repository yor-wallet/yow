'use server';

import { runAdminAction, type ActionState } from '@/lib/admin/action';
import { runAgentsNow } from '@/lib/admin/agents';
import { applyProposal, decideProposal } from '@/lib/agents/proposals';
import { text, textOrNull } from '@/lib/admin/form';

/** Agents: run now (agents:run), approve / reject (agents:decide), apply (agents:decide + action permission). */

export async function runAgentsAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(runAgentsNow, { agent: textOrNull(fd, 'agent') }, { successCode: 'agentsRun', data: (r) => r });
}

export async function decideProposalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const decision = text(fd, 'decision');
  return runAdminAction(decideProposal, { id: text(fd, 'id'), decision, note: textOrNull(fd, 'note') ?? undefined }, { successCode: decision === 'reject' ? 'rejected' : 'approved' });
}

export async function applyProposalAction(_prev: ActionState, fd: FormData): Promise<ActionState> {
  return runAdminAction(applyProposal, { id: text(fd, 'id'), note: textOrNull(fd, 'note') ?? undefined }, { successCode: 'applied', idempotent: true, idempotencyKey: text(fd, 'idempotencyKey') });
}
