import { defineAgent } from '../framework';
import { AGENT_INTERVALS } from '../schedule';
import { ago, DAY, top } from '../util';

type ReconcileLike = { ok: boolean; checks: { key: string; ok: boolean; count: number; samples: unknown[] }[] };

function isReport(v: unknown): v is ReconcileLike {
  return !!v && typeof v === 'object' && Array.isArray((v as ReconcileLike).checks) && typeof (v as ReconcileLike).ok === 'boolean';
}

/**
 * 15 · Final audit — ledger reconciliation (money module `reconcile()`), audit-log
 * integrity (future timestamps, admin actions by non-staff actors) and RBAC sanity
 * (elevated accounts, dormant staff, suspended staff with live sessions).
 */
export default defineAgent({
  key: 'final-audit',
  number: 15,
  nameKey: 'finalAudit',
  scopes: ['ledgerAccount', 'ledgerEntry', 'auditLog', 'user', 'session'],
  schedule: { everyMinutes: AGENT_INTERVALS['final-audit'] },
  async run(ctx) {
    // 1. Ledger reconciliation.
    if (ctx.services.reconcile) {
      const report = await ctx.services.reconcile();
      if (isReport(report)) {
        ctx.metric('ledgerOk', report.ok);
        for (const c of report.checks.filter((x) => !x.ok)) {
          ctx.propose({
            severity: 'CRITICAL',
            titleKey: 'audit.reconcileFailed',
            params: { check: c.key, count: c.count },
            title: `Ledger check "${c.key}" failed (${c.count})`,
            details: { check: c.key, count: c.count, samples: top(c.samples, 10) },
            fingerprint: `reconcile:${c.key}`,
          });
        }
      }
    } else {
      // Fallback (read-only): balance cache vs SUM(entries).
      const sums = await ctx.db.ledgerEntry.groupBy({ by: ['accountId'], _sum: { amountBaisa: true } });
      const accounts = await ctx.db.ledgerAccount.findMany({ select: { id: true, code: true, balanceBaisa: true } });
      const byId = new Map(sums.map((s) => [s.accountId, s._sum.amountBaisa ?? 0]));
      const bad = accounts.filter((a) => (byId.get(a.id) ?? 0) !== a.balanceBaisa);
      ctx.metric('ledgerOk', bad.length === 0);
      if (bad.length) {
        ctx.propose({
          severity: 'CRITICAL',
          titleKey: 'audit.reconcileFailed',
          params: { check: 'account_balance_cache', count: bad.length },
          title: `Ledger check "account_balance_cache" failed (${bad.length})`,
          details: { check: 'account_balance_cache', count: bad.length, samples: top(bad.map((a) => ({ code: a.code, cached: a.balanceBaisa, entries: byId.get(a.id) ?? 0 })), 10) },
          fingerprint: 'reconcile:account_balance_cache',
        });
      }
    }

    // 2. Audit-log integrity.
    const future = await ctx.db.auditLog.count({ where: { createdAt: { gt: new Date(ctx.now.getTime() + 5 * 60_000) } } });
    const byCustomers = await ctx.db.auditLog.findMany({
      where: {
        actorRole: 'CUSTOMER',
        OR: [{ action: { startsWith: 'admin.' } }, { action: { startsWith: 'agent.' } }, { action: { startsWith: 'product.' } }, { action: { startsWith: 'variant.' } }, { action: { startsWith: 'settings.' } }],
      },
      select: { id: true, action: true, actorId: true, createdAt: true },
      take: 20,
    });
    ctx.metric('auditEntries24h', await ctx.db.auditLog.count({ where: { createdAt: { gte: ago(ctx.now, DAY) } } }));
    if (future > 0 || byCustomers.length > 0) {
      ctx.propose({
        severity: 'CRITICAL',
        titleKey: 'audit.integrity',
        params: { count: future + byCustomers.length },
        title: `Audit log integrity: ${future + byCustomers.length} suspicious entr(ies)`,
        details: { futureTimestamps: future, adminActionsByCustomers: byCustomers.map((b) => ({ ...b, createdAt: b.createdAt.toISOString() })) },
        fingerprint: 'audit-integrity',
      });
    }

    // 3. RBAC sanity.
    const elevated = await ctx.db.user.findMany({
      where: { role: { in: ['ADMIN', 'SUPERADMIN'] }, status: 'ACTIVE' },
      select: { id: true, email: true, role: true, lastLoginAt: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const superadmins = elevated.filter((u) => u.role === 'SUPERADMIN').length;
    ctx.metric('elevatedAccounts', elevated.length);
    ctx.propose({
      severity: superadmins > 3 ? 'MEDIUM' : 'INFO',
      titleKey: 'audit.elevatedUsers',
      params: { count: elevated.length, superadmins },
      title: `${elevated.length} elevated account(s), ${superadmins} superadmin(s)`,
      details: { items: elevated.map((u) => ({ userId: u.id, email: u.email, role: u.role, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })) },
      fingerprint: 'elevated',
    });

    const dormant = await ctx.db.user.findMany({
      where: {
        role: { in: ['SUPPORT', 'LOGISTICS', 'FINANCE', 'CATALOG', 'ADMIN', 'SUPERADMIN'] },
        status: 'ACTIVE',
        createdAt: { lt: ago(ctx.now, 90 * DAY) },
        OR: [{ lastLoginAt: null }, { lastLoginAt: { lt: ago(ctx.now, 90 * DAY) } }],
      },
      select: { id: true, email: true, role: true, lastLoginAt: true },
      take: 50,
    });
    if (dormant.length) {
      ctx.propose({
        severity: 'LOW',
        titleKey: 'audit.dormantStaff',
        params: { count: dormant.length },
        title: `${dormant.length} staff account(s) unused for 90 days`,
        details: { items: dormant.map((u) => ({ userId: u.id, email: u.email, role: u.role, lastLoginAt: u.lastLoginAt?.toISOString() ?? null })) },
        fingerprint: 'dormant-staff',
      });
    }

    const suspendedLive = await ctx.db.session.count({
      where: { revokedAt: null, expiresAt: { gt: ctx.now }, user: { status: { not: 'ACTIVE' }, role: { not: 'CUSTOMER' } } },
    });
    if (suspendedLive > 0) {
      ctx.propose({
        severity: 'HIGH',
        titleKey: 'audit.suspendedSessions',
        params: { count: suspendedLive },
        title: `${suspendedLive} live session(s) belong to suspended staff`,
        details: { count: suspendedLive },
        fingerprint: 'suspended-sessions',
      });
    }
  },
});
