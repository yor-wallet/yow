import { defineAgent } from '../framework';
import { ago, DAY, HOUR, MINUTE } from '../util';
import { AGENT_INTERVALS } from '../schedule';

/**
 * 1 · Supervision — runs the other agents (orchestrator), then summarises platform
 * health from AgentRun/AgentProposal: failed runs, stale agents, critical backlog.
 */
export default defineAgent({
  key: 'supervision',
  number: 1,
  nameKey: 'supervision',
  scopes: ['agentRun', 'agentProposal'],
  schedule: { everyMinutes: AGENT_INTERVALS.supervision },
  orchestrates: true,
  async run(ctx) {
    const results = ctx.runAgents ? await ctx.runAgents({ onlyDue: true }) : [];
    const failedNow = results.filter((r) => r.status === 'FAILED');
    ctx.metric('agentsRun', results.length);
    ctx.metric('agentsFailed', failedNow.length);

    // Failed runs over the last 24h, per agent.
    const since = ago(ctx.now, DAY);
    const failed = await ctx.db.agentRun.groupBy({
      by: ['agentKey'],
      where: { status: 'FAILED', startedAt: { gte: since } },
      _count: { _all: true },
    });
    for (const f of failed) {
      const last = await ctx.db.agentRun.findFirst({
        where: { agentKey: f.agentKey, status: 'FAILED' },
        orderBy: { startedAt: 'desc' },
        select: { id: true, error: true, startedAt: true },
      });
      ctx.propose({
        severity: f._count._all >= 3 ? 'CRITICAL' : 'HIGH',
        titleKey: 'supervision.failedRuns',
        params: { agent: f.agentKey, count: f._count._all },
        title: `Agent "${f.agentKey}" failed ${f._count._all} time(s) in 24h`,
        details: { agentKey: f.agentKey, failures: f._count._all, lastError: last?.error ?? null, lastRunId: last?.id ?? null },
        fingerprint: `failed:${f.agentKey}`,
      });
    }

    // Agents that have not succeeded within 3× their interval (stuck cron / crashing).
    const lastOk = await ctx.db.agentRun.groupBy({ by: ['agentKey'], where: { status: 'SUCCEEDED' }, _max: { startedAt: true } });
    const lastOkBy = new Map(lastOk.map((r) => [r.agentKey, r._max.startedAt]));
    const stale: { agentKey: string; lastSuccess: string | null }[] = [];
    for (const [key, minutes] of Object.entries(AGENT_INTERVALS)) {
      if (key === 'supervision') continue;
      const at = lastOkBy.get(key);
      if (!at || ctx.now.getTime() - at.getTime() > 3 * minutes * MINUTE) stale.push({ agentKey: key, lastSuccess: at?.toISOString() ?? null });
    }
    // Only meaningful once the system has been running for a while (some successful run exists).
    if (stale.length > 0 && lastOk.length > 0) {
      ctx.propose({
        severity: 'MEDIUM',
        titleKey: 'supervision.staleAgents',
        params: { count: stale.length },
        title: `${stale.length} agent(s) have not completed recently`,
        details: { items: stale },
        fingerprint: 'stale',
      });
    }

    // Proposal backlog.
    const open = await ctx.db.agentProposal.groupBy({ by: ['severity'], where: { status: 'OPEN' }, _count: { _all: true } });
    const backlog = Object.fromEntries(open.map((o) => [o.severity, o._count._all]));
    const totalOpen = open.reduce((s, o) => s + o._count._all, 0);
    ctx.metric('openProposals', totalOpen);
    const oldCritical = await ctx.db.agentProposal.count({
      where: { status: 'OPEN', severity: 'CRITICAL', createdAt: { lt: ago(ctx.now, 24 * HOUR) } },
    });
    if (oldCritical > 0) {
      ctx.propose({
        severity: 'HIGH',
        titleKey: 'supervision.criticalBacklog',
        params: { count: oldCritical },
        title: `${oldCritical} critical proposal(s) open for more than 24h`,
        details: { backlog },
        fingerprint: 'critical-backlog',
      });
    }

    const healthy = failedNow.length === 0 && failed.length === 0;
    ctx.metric('healthy', healthy);
    ctx.propose({
      severity: healthy ? 'INFO' : 'MEDIUM',
      titleKey: 'supervision.healthSummary',
      params: { ok: results.length - failedNow.length, total: results.length, open: totalOpen },
      title: `Health: ${results.length - failedNow.length}/${results.length} agents OK, ${totalOpen} open proposals`,
      details: {
        results: results.map((r) => ({ agentKey: r.agentKey, status: r.status, proposals: r.proposals.total, durationMs: r.durationMs, error: r.error ?? null })),
        backlog,
      },
      fingerprint: 'health',
    });
  },
});
