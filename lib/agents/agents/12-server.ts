import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, HOUR, ratioBps } from '../util';

const GB = 1024 ** 3;

/**
 * 12 · Server monitoring — DB latency probe, agent error rate, failure-type audit
 * events, private storage disk usage (local driver) and cron freshness (last
 * cron-triggered agent run).
 */
export default defineAgent({
  key: 'server',
  number: 12,
  nameKey: 'server',
  scopes: ['agentRun', 'auditLog', 'idempotencyRecord'],
  schedule: { everyMinutes: AGENT_INTERVALS.server },
  async run(ctx) {
    const now = ctx.now;
    // Latency: best of 3 probes (avoid one-off jitter).
    const samples: number[] = [];
    for (let i = 0; i < 3; i++) samples.push(await ctx.probes.dbLatencyMs());
    const latency = Math.min(...samples);
    ctx.metric('dbLatencyMs', latency);
    if (latency > 200) {
      ctx.propose({
        severity: latency > 1000 ? 'CRITICAL' : latency > 500 ? 'HIGH' : 'MEDIUM',
        titleKey: 'server.dbLatency',
        params: { ms: Math.round(latency) },
        title: `Database latency ${Math.round(latency)} ms`,
        details: { samplesMs: samples },
        fingerprint: 'db-latency',
      });
    }

    const since = ago(now, DAY);
    const [runs, failedRuns, failureEvents] = await Promise.all([
      ctx.db.agentRun.count({ where: { startedAt: { gte: since } } }),
      ctx.db.agentRun.count({ where: { startedAt: { gte: since }, status: 'FAILED' } }),
      ctx.db.auditLog.count({ where: { createdAt: { gte: since }, OR: [{ action: { contains: 'fail' } }, { action: { contains: 'error' } }] } }),
    ]);
    const errorRate = ratioBps(failedRuns, runs);
    ctx.metric('agentRuns24h', runs);
    ctx.metric('agentErrorRateBps', errorRate);
    ctx.metric('failureAuditEvents24h', failureEvents);
    if (runs >= 5 && errorRate > 1000) {
      ctx.propose({
        severity: errorRate > 3000 ? 'HIGH' : 'MEDIUM',
        titleKey: 'server.errorRate',
        params: { pct: Math.round(errorRate / 100) },
        title: `Agent error rate ${Math.round(errorRate / 100)}% over 24h`,
        details: { runs, failedRuns, failureAuditEvents: failureEvents },
        fingerprint: 'error-rate',
      });
    }

    const bytes = await ctx.probes.privateStorageBytes();
    ctx.metric('privateStorageBytes', bytes);
    if (bytes != null && bytes > 5 * GB) {
      ctx.propose({
        severity: bytes > 20 * GB ? 'HIGH' : 'MEDIUM',
        titleKey: 'server.disk',
        params: { gb: Math.round((bytes / GB) * 10) / 10 },
        title: `Private storage uses ${Math.round((bytes / GB) * 10) / 10} GB`,
        details: { bytes },
        fingerprint: 'disk',
      });
    }

    // Cron freshness: only meaningful once a cron run has ever happened.
    const lastCron = await ctx.db.agentRun.findFirst({ where: { trigger: 'cron' }, orderBy: { startedAt: 'desc' }, select: { startedAt: true } });
    ctx.metric('lastCronRun', lastCron?.startedAt.toISOString() ?? null);
    if (lastCron && now.getTime() - lastCron.startedAt.getTime() > 3 * HOUR) {
      const hours = Math.round((now.getTime() - lastCron.startedAt.getTime()) / HOUR);
      ctx.propose({
        severity: hours > 24 ? 'HIGH' : 'MEDIUM',
        titleKey: 'server.cronStale',
        params: { hours },
        title: `No cron-triggered run for ${hours}h`,
        details: { lastCronRun: lastCron.startedAt.toISOString() },
        fingerprint: 'cron-stale',
      });
    }

    const expiredIdem = await ctx.db.idempotencyRecord.count({ where: { expiresAt: { lt: now } } });
    ctx.metric('expiredIdempotencyRecords', expiredIdem);
    if (expiredIdem > 10_000) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'server.idempotencyBacklog',
        params: { count: expiredIdem },
        title: `${expiredIdem} expired idempotency records awaiting purge`,
        details: { count: expiredIdem },
        fingerprint: 'idempotency-backlog',
      });
    }
  },
});
