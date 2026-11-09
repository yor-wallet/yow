import { Prisma, PrismaClient } from '@prisma/client';

/**
 * Prisma singleton. In development the client is cached on `globalThis` so hot
 * reloads do not exhaust connections.
 */
const globalForPrisma = globalThis as unknown as { __doomPrisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.__doomPrisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

if (process.env.NODE_ENV !== 'production') globalForPrisma.__doomPrisma = prisma;

/** Either the root client or an interactive-transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Run `fn` in a SERIALIZABLE transaction, retrying on serialization failures
 * (Prisma P2034 / Postgres 40001) with jittered backoff. Use for every money or
 * stock mutation (ledger postings, reservations, order placement).
 */
export async function serializable<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { maxRetries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        timeout: opts.timeoutMs ?? 15_000,
        maxWait: 5_000,
      });
    } catch (err) {
      if (attempt < maxRetries && isSerializationFailure(err)) {
        await new Promise((r) => setTimeout(r, 25 * 2 ** attempt + Math.random() * 25));
        continue;
      }
      throw err;
    }
  }
}

export function isSerializationFailure(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2034') return true;
  const msg = err instanceof Error ? err.message : String(err);
  return /40001|could not serialize access|deadlock detected|40P01/.test(msg);
}

/** True when `err` is a unique-constraint violation (optionally on a given field). */
export function isUniqueViolation(err: unknown, field?: string): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError) || err.code !== 'P2002') return false;
  if (!field) return true;
  const target = (err.meta as { target?: string[] | string } | undefined)?.target;
  return Array.isArray(target) ? target.includes(field) : typeof target === 'string' && target.includes(field);
}
