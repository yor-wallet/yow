import type { Prisma, ProposalSeverity, ProposalStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { AGENTS, getAgent } from '@/lib/agents/registry';
import { runAgentByKey, runAllAgents } from '@/lib/agents/runner';
import { proposalAction } from '@/lib/agents/proposals';
import { ACTION_PERMISSIONS } from '@/lib/agents/action-types';
import { assertCan, ValidationError, type Actor } from './actor';
import { enumParam, parseTableQuery, type SearchParams } from './table';

/** Admin read models for the 15 agents + the guarded "run now" entry point. */

export const SEVERITIES: readonly ProposalSeverity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'];
export const PROPOSAL_STATUSES: readonly ProposalStatus[] = ['OPEN', 'APPROVED', 'REJECTED', 'APPLIED'];

export async function agentsOverview() {
  const [lastRuns, openByAgent, runs24, recent] = await Promise.all([
    prisma.$queryRaw<{ agentKey: string; status: string; startedAt: Date; finishedAt: Date | null; error: string | null; summary: Prisma.JsonValue }[]>`
      SELECT DISTINCT ON ("agentKey") "agentKey", status::text AS status, "startedAt", "finishedAt", error, summary
      FROM "AgentRun" ORDER BY "agentKey", "startedAt" DESC`,
    prisma.agentProposal.groupBy({ by: ['agentKey', 'severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
    prisma.agentRun.groupBy({ by: ['agentKey', 'status'], where: { startedAt: { gte: new Date(Date.now() - 86_400_000) } }, _count: { _all: true } }),
    prisma.agentRun.findMany({ orderBy: { startedAt: 'desc' }, take: 20, select: { id: true, agentKey: true, status: true, trigger: true, startedAt: true, finishedAt: true, error: true } }),
  ]);
  const last = new Map(lastRuns.map((r) => [r.agentKey, r]));
  const agents = AGENTS.map((a) => {
    const open = openByAgent.filter((o) => o.agentKey === a.key);
    const r24 = runs24.filter((r) => r.agentKey === a.key);
    return {
      key: a.key,
      number: a.number,
      nameKey: a.nameKey,
      scopes: [...a.scopes],
      everyMinutes: a.schedule.everyMinutes,
      orchestrates: !!a.orchestrates,
      lastRun: last.get(a.key) ?? null,
      openProposals: open.reduce((s, o) => s + o._count._all, 0),
      openCritical: open.filter((o) => o.severity === 'CRITICAL' || o.severity === 'HIGH').reduce((s, o) => s + o._count._all, 0),
      failed24h: r24.filter((r) => r.status === 'FAILED').reduce((s, r) => s + r._count._all, 0),
      runs24h: r24.reduce((s, r) => s + r._count._all, 0),
    };
  });
  return { agents, recent };
}

export async function listProposals(sp: SearchParams) {
  const q = parseTableQuery(sp, { sortable: ['createdAt', 'severity'] as const, defaultSort: 'createdAt', pageSize: 20 });
  const status = (sp.status === 'ALL' ? undefined : (enumParam(sp, 'status', PROPOSAL_STATUSES) ?? 'OPEN')) as ProposalStatus | undefined;
  const severity = enumParam(sp, 'severity', SEVERITIES);
  const agentKey = enumParam(sp, 'agent', AGENTS.map((a) => a.key));
  const where: Prisma.AgentProposalWhereInput = {
    ...(status ? { status } : {}),
    ...(severity ? { severity } : {}),
    ...(agentKey ? { agentKey } : {}),
    ...(q.q ? { title: { contains: q.q, mode: 'insensitive' } } : {}),
  };
  const [total, rows, counts] = await Promise.all([
    prisma.agentProposal.count({ where }),
    prisma.agentProposal.findMany({
      where,
      orderBy: q.sort === 'severity' ? [{ severity: q.dir }, { createdAt: 'desc' }] : [{ createdAt: q.dir }],
      skip: q.skip,
      take: q.take,
      include: { decidedBy: { select: { fullName: true, email: true } } },
    }),
    prisma.agentProposal.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } }),
  ]);
  const items = rows.map((r) => {
    const d = (r.details && typeof r.details === 'object' && !Array.isArray(r.details) ? r.details : {}) as Record<string, unknown>;
    const action = proposalAction(r.details);
    return {
      id: r.id,
      agentKey: r.agentKey,
      severity: r.severity,
      status: r.status,
      title: r.title,
      titleKey: typeof d.titleKey === 'string' ? d.titleKey : null,
      params: (d.params && typeof d.params === 'object' ? d.params : {}) as Record<string, string | number>,
      details: d,
      action,
      actionPermission: action ? ACTION_PERMISSIONS[action.type] : null,
      createdAt: r.createdAt,
      decidedAt: r.decidedAt,
      decisionNote: r.decisionNote,
      decidedBy: r.decidedBy?.fullName ?? null,
      appliedAt: r.appliedAt,
    };
  });
  return { ...q, total, items, status: status ?? 'ALL', severity, agentKey, openBySeverity: Object.fromEntries(counts.map((c) => [c.severity, c._count._all])) as Partial<Record<ProposalSeverity, number>> };
}

/** "Run now" (permission `agents:run`), audited. `agent` omitted ⇒ every agent via supervision. */
export async function runAgentsNow(actor: Actor | null | undefined, raw: unknown) {
  assertCan(actor, 'agents:run');
  const parsed = z.object({ agent: z.string().max(40).optional().nullable() }).safeParse(raw);
  if (!parsed.success || (parsed.data.agent && !getAgent(parsed.data.agent))) throw new ValidationError({ agent: ['invalid'] });
  const key = parsed.data.agent || null;
  const results = key ? await runAgentByKey(key, { trigger: 'manual' }) : await runAllAgents({ trigger: 'manual', onlyDue: false });
  await logAudit({
    actorId: actor.id,
    actorRole: actor.role,
    action: 'agents.run',
    entity: 'AgentRun',
    entityId: results[0]?.runId ?? null,
    after: { agent: key ?? 'all', results: results.map((r) => ({ agent: r.agentKey, status: r.status, proposals: r.proposals.total })) },
  });
  return { runs: results.length, failed: results.filter((r) => r.status === 'FAILED').length, proposals: results.reduce((s, r) => s + r.proposals.total, 0) };
}
