import { Prisma } from '@prisma/client';
import { prisma, isUniqueViolation } from './db';
import { sha256Hex } from './crypto';

/**
 * Idempotent execution for mutations (orders, payments, top-ups, refunds...).
 * The client sends a fresh key per *intent* (e.g. crypto.randomUUID() generated
 * when the checkout page loads, re-used on retries/double-clicks/back-forward).
 *
 *   const { result, replayed } = await withIdempotency(
 *     { scope: 'order.create', key, userId, request: payload },
 *     () => placeOrder(payload),
 *   );
 *
 * - same key + same payload, completed  → returns the stored result (replayed=true), fn NOT re-run
 * - same key + different payload        → IdempotencyError('key_reused')
 * - same key while first call in flight → IdempotencyError('in_progress')
 * - first call threw                    → record marked FAILED; a retry runs fn again
 * The result must be JSON-serialisable. Money tables additionally carry their own
 * unique idempotency keys (PaymentIntent, LedgerTransaction, Order, Refund) as a DB-level backstop.
 */

export class IdempotencyError extends Error {
  constructor(public readonly code: 'key_reused' | 'in_progress' | 'forbidden') {
    super(`Idempotency error: ${code}`);
    this.name = 'IdempotencyError';
  }
}

export type IdempotencyOptions = {
  scope: string;
  key: string;
  userId?: string | null;
  /** Anything describing the request; hashed to detect key reuse with another payload. */
  request?: unknown;
  /** How long the record is kept (default 48h). */
  ttlHours?: number;
  /** Lock duration for an in-flight call before another attempt may take over (default 60s). */
  lockSeconds?: number;
};

/** Deterministic JSON (sorted keys) for hashing. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
}

export async function withIdempotency<T>(
  opts: IdempotencyOptions,
  fn: () => Promise<T>,
): Promise<{ result: T; replayed: boolean }> {
  const { scope, key } = opts;
  const userId = opts.userId ?? null;
  const requestHash = sha256Hex(stableStringify(opts.request ?? null));
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + (opts.lockSeconds ?? 60) * 1000);
  const expiresAt = new Date(now.getTime() + (opts.ttlHours ?? 48) * 3600 * 1000);

  let recordId: string;
  try {
    const rec = await prisma.idempotencyRecord.create({
      data: { scope, key, userId, requestHash, status: 'IN_PROGRESS', lockedUntil, expiresAt },
    });
    recordId = rec.id;
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const existing = await prisma.idempotencyRecord.findUnique({ where: { scope_key: { scope, key } } });
    if (!existing) throw err;
    if (existing.userId !== userId) throw new IdempotencyError('forbidden');
    if (existing.requestHash !== requestHash) throw new IdempotencyError('key_reused');
    if (existing.status === 'COMPLETED') {
      return { result: existing.response as T, replayed: true };
    }
    if (existing.status === 'IN_PROGRESS' && existing.lockedUntil && existing.lockedUntil > now) {
      throw new IdempotencyError('in_progress');
    }
    // FAILED, or IN_PROGRESS with an expired lock: take over atomically.
    const taken = await prisma.idempotencyRecord.updateMany({
      where: { id: existing.id, status: existing.status, updatedAt: existing.updatedAt },
      data: { status: 'IN_PROGRESS', lockedUntil, expiresAt },
    });
    if (taken.count !== 1) throw new IdempotencyError('in_progress');
    recordId = existing.id;
  }

  try {
    const result = await fn();
    await prisma.idempotencyRecord.update({
      where: { id: recordId },
      data: {
        status: 'COMPLETED',
        response: (result === undefined ? Prisma.JsonNull : (JSON.parse(JSON.stringify(result)) as Prisma.InputJsonValue)),
        lockedUntil: null,
      },
    });
    return { result, replayed: false };
  } catch (err) {
    await prisma.idempotencyRecord
      .update({ where: { id: recordId }, data: { status: 'FAILED', lockedUntil: null } })
      .catch(() => undefined);
    throw err;
  }
}

/** Housekeeping (cron): delete expired records. */
export async function purgeExpiredIdempotencyRecords(): Promise<number> {
  const { count } = await prisma.idempotencyRecord.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  return count;
}
