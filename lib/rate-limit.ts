import { prisma } from './db';

export type RateLimitResult = { ok: boolean; count: number; remaining: number; resetAt: Date; retryAfterSec: number };

/**
 * Fixed-window rate limiter backed by Postgres (works across serverless instances).
 * Atomic single-statement upsert. `key` should be namespaced, e.g. `register:ip:1.2.3.4`.
 */
export async function rateLimit(key: string, limit: number, windowMs: number): Promise<RateLimitResult> {
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  const rows = await prisma.$queryRaw<{ count: number; resetAt: Date }[]>`
    INSERT INTO "RateLimit" ("key", "count", "resetAt") VALUES (${key}, 1, ${resetAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN 1 ELSE "RateLimit"."count" + 1 END,
      "resetAt" = CASE WHEN "RateLimit"."resetAt" <= ${now} THEN EXCLUDED."resetAt" ELSE "RateLimit"."resetAt" END
    RETURNING "count", "resetAt"`;
  const row = rows[0]!;
  const count = Number(row.count);
  const ok = count <= limit;
  return {
    ok,
    count,
    remaining: Math.max(0, limit - count),
    resetAt: row.resetAt,
    retryAfterSec: ok ? 0 : Math.max(1, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000)),
  };
}

/** Housekeeping (cron): delete expired buckets. */
export async function purgeExpiredRateLimits(): Promise<number> {
  const { count } = await prisma.rateLimit.deleteMany({ where: { resetAt: { lt: new Date() } } });
  return count;
}
