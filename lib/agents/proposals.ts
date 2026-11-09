import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { can } from '@/lib/rbac';
import { idSchema } from '@/lib/validation';
import { AdminError, assertCan, ForbiddenError, NotFoundError, ValidationError, type Actor } from '@/lib/admin/actor';
import { defineMutation, type Mutation } from '@/lib/admin/mutation';
import { fieldErrorsOf } from '@/lib/validation';
import { ACTION_PERMISSIONS, isActionType, type ActionType } from './action-types';
import { executeAction, EXTERNAL_ACTIONS } from './actions';

/**
 * Human decisions on agent proposals. Every transition is audited.
 *   OPEN ──approve──▶ APPROVED ──apply──▶ APPLIED
 *     └──reject───▶ REJECTED
 * `applyProposal` requires `agents:decide` AND the permission of the proposal's action
 * (e.g. `prices:write` for `variant.setPrice`); it runs the whitelisted handler in the
 * same transaction as the status change and the audit row.
 */

export type ProposalAction = { type: ActionType; params: Record<string, unknown> };

export function proposalAction(details: Prisma.JsonValue | null): ProposalAction | null {
  if (!details || typeof details !== 'object' || Array.isArray(details)) return null;
  const a = (details as Record<string, unknown>).action;
  if (!a || typeof a !== 'object' || Array.isArray(a)) return null;
  const type = (a as Record<string, unknown>).type;
  if (!isActionType(type)) return null;
  const params = (a as Record<string, unknown>).params;
  return { type, params: params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {} };
}

const noteSchema = z.string().trim().max(1000, 'too_long').optional();

export const decideProposal = defineMutation({
  name: 'agent.proposal.decide',
  permission: 'agents:decide',
  schema: z.object({ id: idSchema, decision: z.enum(['approve', 'reject']), note: noteSchema }),
  async run({ tx, actor, input, audit }) {
    const p = await tx.agentProposal.findUnique({ where: { id: input.id } });
    if (!p) throw new NotFoundError('AgentProposal');
    if (p.status !== 'OPEN') throw new AdminError('proposal_not_open');
    const status = input.decision === 'approve' ? 'APPROVED' : 'REJECTED';
    // Conditional update: concurrent decisions cannot both win.
    const res = await tx.agentProposal.updateMany({
      where: { id: p.id, status: 'OPEN' },
      data: { status, decidedById: actor.id, decidedAt: new Date(), decisionNote: input.note ?? null },
    });
    if (res.count !== 1) throw new AdminError('proposal_not_open');
    await audit({
      action: `agent.proposal.${input.decision}`,
      entity: 'AgentProposal',
      entityId: p.id,
      before: { status: p.status },
      after: { status, note: input.note ?? null, agentKey: p.agentKey },
    });
    return { id: p.id, status };
  },
});

const applyInput = z.object({ id: idSchema, note: noteSchema });

const applyProposalTx = defineMutation({
  name: 'agent.proposal.apply',
  permission: 'agents:decide',
  schema: applyInput.extend({ external: z.record(z.unknown()).optional() }),
  async run({ tx, actor, input, audit }) {
    const p = await tx.agentProposal.findUnique({ where: { id: input.id } });
    if (!p) throw new NotFoundError('AgentProposal');
    if (p.status !== 'OPEN' && p.status !== 'APPROVED') throw new AdminError('proposal_not_open');
    const action = proposalAction(p.details);
    if (!action) throw new AdminError('proposal_no_action');
    const required = ACTION_PERMISSIONS[action.type];
    if (!can(actor.role, required)) throw new ForbiddenError(required);

    const claimed = await tx.agentProposal.updateMany({
      where: { id: p.id, status: { in: ['OPEN', 'APPROVED'] } },
      data: {
        status: 'APPLIED',
        appliedAt: new Date(),
        decidedById: p.decidedById ?? actor.id,
        decidedAt: p.decidedAt ?? new Date(),
        decisionNote: input.note ?? p.decisionNote,
      },
    });
    if (claimed.count !== 1) throw new AdminError('proposal_not_open');
    const result = await executeAction(action.type, action.params, { tx, actor, audit, external: input.external });
    await audit({
      action: 'agent.proposal.apply',
      entity: 'AgentProposal',
      entityId: p.id,
      before: { status: p.status },
      after: { status: 'APPLIED', action: action.type, params: action.params, result },
    });
    return { id: p.id, action: action.type, result };
  },
});

/**
 * Apply an approved (or open) proposal's action. For EXTERNAL actions (owned by another
 * module, idempotent) the effect runs first, then the proposal is claimed + audited.
 */
export const applyProposal: Mutation<z.input<typeof applyInput>, Awaited<ReturnType<typeof applyProposalTx>>> = Object.assign(
  async (actor: Actor | null | undefined, raw: unknown) => {
    assertCan(actor, 'agents:decide');
    const parsed = applyInput.safeParse(raw);
    if (!parsed.success) throw new ValidationError(fieldErrorsOf(parsed.error));
    const p = await prisma.agentProposal.findUnique({ where: { id: parsed.data.id }, select: { status: true, details: true } });
    if (!p) throw new NotFoundError('AgentProposal');
    const action = proposalAction(p.details);
    const external = action ? EXTERNAL_ACTIONS[action.type] : undefined;
    if (action && external) {
      if (p.status !== 'OPEN' && p.status !== 'APPROVED') throw new AdminError('proposal_not_open');
      if (!can(actor.role, ACTION_PERMISSIONS[action.type])) throw new ForbiddenError(ACTION_PERMISSIONS[action.type]);
      const result = await external(action.params);
      return applyProposalTx(actor, { ...parsed.data, external: result });
    }
    return applyProposalTx(actor, parsed.data);
  },
  { mutationName: 'agent.proposal.apply', permission: ['agents:decide'] as const },
);
