import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getSettings, type SettingsMap } from '@/lib/admin/settings';
import { getStorage, type StoredObject } from '@/lib/storage';

/**
 * Maintenance sweep: removes TEMPORARY server data under an explicit allow-list.
 *
 *  - Only the targets listed in `CLEANUP_TARGETS` can ever be touched. Orders, payments, invoices,
 *    customers, products, stock, active carts, the wallet ledger, KYC and the audit log are NOT targets
 *    and no code path here reaches them.
 *  - Retention per target comes from the `cleanup.*` settings (editable, safe defaults).
 *  - `dryRun` (the default) only counts. The schedule sweeps only once `cleanup.enabled` = 1 (off by default).
 *  - Real runs work in small batches, hold a lease so two runs never overlap, re-check each row's
 *    condition at the moment of deletion, and are safe to re-run after a stop in the middle of a batch.
 */

export const CLEANUP_TARGETS = ['sessions', 'login_attempts', 'rate_limits', 'idempotency', 'agent_runs', 'orphan_images'] as const;
export type CleanupTarget = (typeof CLEANUP_TARGETS)[number];

export type TargetReport = {
  target: CleanupTarget;
  /** Human readable retention, e.g. "30 days". */
  retention: string;
  cutoff: string;
  candidates: number;
  deleted: number;
  error?: string;
};

export type CleanupReport = {
  dryRun: boolean;
  startedAt: string;
  finishedAt: string;
  skipped?: 'locked';
  /** True when a batch limit stopped the run early: the next run continues. */
  truncated: boolean;
  targets: TargetReport[];
};

export type CleanupOptions = {
  dryRun?: boolean;
  now?: Date;
  batchSize?: number;
  /** Safety valve per target and run. */
  maxBatches?: number;
  only?: readonly CleanupTarget[];
  settings?: SettingsMap;
};

const DAY = 86_400_000;
const HOUR = 3_600_000;
const LOCK_KEY = 'cleanup.lock';
const LOCK_TTL_MS = 10 * 60_000;


function plans(now: Date, s: SettingsMap) {
  const days = (n: number) => new Date(now.getTime() - n * DAY);
  const sessionsCut = days(s['cleanup.sessionsDays']);
  const loginCut = days(s['cleanup.loginAttemptsDays']);
  const rateCut = new Date(now.getTime() - s['cleanup.rateLimitHours'] * HOUR);
  const idemCut = days(s['cleanup.idempotencyDays']);
  const runsCut = days(s['cleanup.agentRunsDays']);
  return {
    sessions: { retention: `${s['cleanup.sessionsDays']} days after expiry/revocation`, cutoff: sessionsCut, where: { OR: [{ expiresAt: { lt: sessionsCut } }, { revokedAt: { lt: sessionsCut } }] } satisfies Prisma.SessionWhereInput },
    login_attempts: { retention: `${s['cleanup.loginAttemptsDays']} days`, cutoff: loginCut, where: { createdAt: { lt: loginCut } } satisfies Prisma.LoginAttemptWhereInput },
    rate_limits: { retention: `${s['cleanup.rateLimitHours']} hours after the window ended`, cutoff: rateCut, where: { resetAt: { lt: rateCut } } satisfies Prisma.RateLimitWhereInput },
    idempotency: {
      retention: `${s['cleanup.idempotencyDays']} days after expiry`,
      cutoff: idemCut,
      // A record still IN_PROGRESS under a live lock is never touched.
      where: { expiresAt: { lt: idemCut }, OR: [{ status: { not: 'IN_PROGRESS' } }, { lockedUntil: null }, { lockedUntil: { lt: now } }] } satisfies Prisma.IdempotencyRecordWhereInput,
    },
    agent_runs: {
      retention: `${s['cleanup.agentRunsDays']} days (runs without proposals only)`,
      cutoff: runsCut,
      where: { status: { not: 'RUNNING' }, startedAt: { lt: runsCut }, proposals: { none: {} } } satisfies Prisma.AgentRunWhereInput,
    },
  } as const;
}

// ───────────── lease ─────────────

async function acquireLease(now: Date): Promise<boolean> {
  const until = new Date(now.getTime() + LOCK_TTL_MS).toISOString();
  const rows = await prisma.$queryRaw<{ key: string }[]>`
    INSERT INTO "Setting" ("key", "value", "updatedAt")
    VALUES (${LOCK_KEY}, ${JSON.stringify({ until })}::jsonb, ${now})
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = EXCLUDED."updatedAt"
    WHERE ("Setting"."value"->>'until')::timestamptz < ${now}
    RETURNING "key"`;
  return rows.length === 1;
}

async function releaseLease(now: Date) {
  await prisma.$executeRaw`UPDATE "Setting" SET "value" = ${JSON.stringify({ until: new Date(now.getTime() - 1000).toISOString() })}::jsonb WHERE "key" = ${LOCK_KEY}`;
}

// ───────────── database targets ─────────────

type Delegate = {
  count: (a: { where: never }) => Promise<number>;
  findMany: (a: { where: never; select: { id: true }; take: number }) => Promise<{ id: string }[]>;
  deleteMany: (a: { where: never }) => Promise<{ count: number }>;
};

async function sweepTable(delegate: Delegate, where: object, dryRun: boolean, batchSize: number, maxBatches: number) {
  const candidates = await delegate.count({ where: where as never });
  if (dryRun || candidates === 0) return { candidates, deleted: 0, truncated: false };
  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const rows = await delegate.findMany({ where: where as never, select: { id: true }, take: batchSize });
    if (rows.length === 0) return { candidates, deleted, truncated: false };
    // Re-check the condition at deletion time: a row that became relevant again in between is kept.
    const res = await delegate.deleteMany({ where: { AND: [where, { id: { in: rows.map((r) => r.id) } }] } as never });
    deleted += res.count;
    batches++;
    if (rows.length < batchSize) return { candidates, deleted, truncated: false };
  }
  return { candidates, deleted, truncated: true };
}

// ───────────── orphan derived images ─────────────

/** `products/<id>/2026/11/abcd-480.avif` → `products/<id>/2026/11/abcd` (the family root). */
export function imageFamilyRoot(key: string): string {
  return key.replace(/\.[a-z0-9]+$/i, '').replace(/-\d{2,4}$/, '');
}

const IMAGE_PREFIXES = ['products/', 'campaigns/'] as const;

async function referencedRoots(): Promise<Set<string>> {
  const roots = new Set<string>();
  const add = (k: string | null | undefined) => {
    if (k) roots.add(imageFamilyRoot(k));
  };
  for (let cursor: string | undefined; ; ) {
    const rows = await prisma.productImage.findMany({ select: { id: true, key: true }, orderBy: { id: 'asc' }, take: 2000, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    rows.forEach((r) => add(r.key));
    if (rows.length < 2000) break;
    cursor = rows[rows.length - 1]!.id;
  }
  const campaigns = await prisma.campaign.findMany({ select: { mediaKey: true, mediaKeyMobile: true, posterKey: true } });
  campaigns.forEach((c) => [c.mediaKey, c.mediaKeyMobile, c.posterKey].forEach(add));
  return roots;
}

async function sweepOrphanImages(now: Date, graceDays: number, dryRun: boolean, batchSize: number, maxBatches: number) {
  const storage = getStorage();
  if (!storage.list) return { candidates: 0, deleted: 0, truncated: false, error: 'storage_driver_cannot_list' };
  const cutoff = new Date(now.getTime() - graceDays * DAY);
  // Referenced roots are read BEFORE listing: an image attached after this point has a newer file than the grace period.
  const roots = await referencedRoots();
  const found: StoredObject[] = [];
  for (const prefix of IMAGE_PREFIXES) found.push(...(await storage.list('public', prefix)));

  const families = new Map<string, StoredObject[]>();
  for (const o of found) {
    const root = imageFamilyRoot(o.key);
    (families.get(root) ?? families.set(root, []).get(root)!).push(o);
  }
  const doomed: string[] = [];
  for (const [root, files] of families) {
    if (roots.has(root)) continue;
    // Every file of the family must be older than the grace period (an upload in progress keeps it alive).
    if (files.some((f) => f.updatedAt >= cutoff)) continue;
    doomed.push(...files.map((f) => f.key));
  }
  if (dryRun || doomed.length === 0) return { candidates: doomed.length, deleted: 0, truncated: false };

  let deleted = 0;
  const limit = batchSize * maxBatches;
  for (let i = 0; i < Math.min(doomed.length, limit); i += batchSize) {
    const slice = doomed.slice(i, i + batchSize);
    // Re-check the reference at deletion time (a product image may have been attached since the listing).
    const fresh = await referencedRoots();
    for (const key of slice) {
      if (fresh.has(imageFamilyRoot(key))) continue;
      await storage.delete('public', key);
      deleted++;
    }
  }
  return { candidates: doomed.length, deleted, truncated: doomed.length > limit };
}

// ───────────── public API ─────────────

export async function runCleanup(opts: CleanupOptions = {}): Promise<CleanupReport> {
  const dryRun = opts.dryRun ?? true;
  const now = opts.now ?? new Date();
  const batchSize = Math.max(1, Math.min(opts.batchSize ?? 500, 5000));
  const maxBatches = Math.max(1, opts.maxBatches ?? 20);
  const only = new Set<CleanupTarget>(opts.only?.length ? opts.only : CLEANUP_TARGETS);
  const startedAt = new Date().toISOString();
  const settings = opts.settings ?? (await getSettings());
  const plan = plans(now, settings);

  const leased = dryRun ? true : await acquireLease(now);
  if (!leased) return { dryRun, startedAt, finishedAt: new Date().toISOString(), skipped: 'locked', truncated: false, targets: [] };

  const targets: TargetReport[] = [];
  let truncated = false;
  try {
    const run = async (target: CleanupTarget, retention: string, cutoff: Date, fn: () => Promise<{ candidates: number; deleted: number; truncated: boolean; error?: string }>) => {
      if (!only.has(target)) return;
      try {
        const r = await fn();
        truncated ||= r.truncated;
        targets.push({ target, retention, cutoff: cutoff.toISOString(), candidates: r.candidates, deleted: r.deleted, ...(r.error ? { error: r.error } : {}) });
      } catch (e) {
        targets.push({ target, retention, cutoff: cutoff.toISOString(), candidates: 0, deleted: 0, error: e instanceof Error ? e.message.slice(0, 200) : 'failed' });
      }
    };
    await run('sessions', plan.sessions.retention, plan.sessions.cutoff, () => sweepTable(prisma.session as unknown as Delegate, plan.sessions.where, dryRun, batchSize, maxBatches));
    await run('login_attempts', plan.login_attempts.retention, plan.login_attempts.cutoff, () => sweepTable(prisma.loginAttempt as unknown as Delegate, plan.login_attempts.where, dryRun, batchSize, maxBatches));
    await run('rate_limits', plan.rate_limits.retention, plan.rate_limits.cutoff, async () => {
      // RateLimit has no `id`: its key is the primary key.
      const where = plan.rate_limits.where;
      const candidates = await prisma.rateLimit.count({ where });
      if (dryRun || candidates === 0) return { candidates, deleted: 0, truncated: false };
      let deleted = 0;
      for (let i = 0; i < maxBatches; i++) {
        const rows = await prisma.rateLimit.findMany({ where, select: { key: true }, take: batchSize });
        if (rows.length === 0) return { candidates, deleted, truncated: false };
        deleted += (await prisma.rateLimit.deleteMany({ where: { AND: [where, { key: { in: rows.map((r) => r.key) } }] } })).count;
        if (rows.length < batchSize) return { candidates, deleted, truncated: false };
      }
      return { candidates, deleted, truncated: true };
    });
    await run('idempotency', plan.idempotency.retention, plan.idempotency.cutoff, () => sweepTable(prisma.idempotencyRecord as unknown as Delegate, plan.idempotency.where, dryRun, batchSize, maxBatches));
    await run('agent_runs', plan.agent_runs.retention, plan.agent_runs.cutoff, () => sweepTable(prisma.agentRun as unknown as Delegate, plan.agent_runs.where, dryRun, batchSize, maxBatches));
    await run('orphan_images', `${settings['cleanup.orphanImagesDays']} days without any product or campaign reference`, new Date(now.getTime() - settings['cleanup.orphanImagesDays'] * DAY), () =>
      sweepOrphanImages(now, settings['cleanup.orphanImagesDays'], dryRun, batchSize, maxBatches),
    );
  } finally {
    if (!dryRun) await releaseLease(now).catch(() => undefined);
  }

  const report: CleanupReport = { dryRun, startedAt, finishedAt: new Date().toISOString(), truncated, targets };
  if (!dryRun) {
    await prisma.auditLog
      .create({ data: { actorId: null, action: 'maintenance.cleanup', entity: 'Maintenance', entityId: 'cleanup', after: report as unknown as Prisma.InputJsonValue } })
      .catch(() => undefined);
  }
  return report;
}

/**
 * Scheduled entry point (cron). Does nothing until the setting `cleanup.enabled` is 1: the preview is
 * an explicit step (`npm run maintenance:cleanup`, or the maintenance route with `?dryRun=1`), read by
 * a person before the schedule is switched on. Never throws: a maintenance problem must not break the
 * job that calls it.
 */
export async function runScheduledCleanup(opts: Omit<CleanupOptions, 'dryRun'> = {}): Promise<CleanupReport | { skipped: 'disabled' } | { error: string }> {
  try {
    const settings = opts.settings ?? (await getSettings());
    if (settings['cleanup.enabled'] !== 1) return { skipped: 'disabled' };
    return await runCleanup({ ...opts, settings, dryRun: false });
  } catch (e) {
    return { error: e instanceof Error ? e.message.slice(0, 200) : 'failed' };
  }
}
