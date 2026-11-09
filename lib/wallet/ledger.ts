import { randomBytes } from 'node:crypto';
import { Prisma, type LedgerAccountType, type LedgerTransactionType, type WalletStatus } from '@prisma/client';
import { prisma, isSerializationFailure, isUniqueViolation, type Db } from '@/lib/db';
import { isBaisa } from '@/lib/money';
import { MoneyError } from './errors';

/**
 * DOOM Wallet — double-entry ledger.
 *
 * Invariants (enforced here AND in the database):
 *  - a transaction has >= 2 entries, every amount is a non-zero integer of baisa, and the
 *    entries sum to exactly 0 (deferred constraint trigger checks it again at COMMIT);
 *  - `reference` and `idempotencyKey` are unique; posting twice with the same idempotency
 *    key returns the existing transaction (never double posts);
 *  - entries are append-only (DB trigger) — corrections are reversal transactions;
 *  - `LedgerAccount.balanceBaisa` is a cache of SUM(entries) updated in the same DB
 *    transaction, after locking the account rows (`SELECT … FOR UPDATE`, id order ⇒ no
 *    deadlock between two postings);
 *  - a CUSTOMER_WALLET account can never go negative: its balance is recomputed from its
 *    entries under the row lock before any debit (DB CHECK constraint as a backstop).
 *
 * Sign convention: money flows FROM the account with the negative entry TO the account
 * with the positive entry. A customer wallet's balance (= SUM of its entries) is the
 * spendable amount; crediting a wallet is a positive entry.
 */

export const SYSTEM_ACCOUNTS = [
  'PLATFORM_CASH',
  'PAYMENT_CLEARING',
  'PLATFORM_REVENUE',
  'DELIVERY_REVENUE',
  'GIFT_CARD_CLEARING',
  'REFUNDS',
  'FLEX_RECEIVABLE',
  'DISCOUNTS',
  'ADJUSTMENTS',
] as const satisfies readonly LedgerAccountType[];

export type SystemAccountCode = (typeof SYSTEM_ACCOUNTS)[number];

export type LedgerEntryInput = { accountId: string; amountBaisa: number };

export type PostTransactionInput = {
  reference: string;
  type: LedgerTransactionType;
  idempotencyKey: string;
  entries: LedgerEntryInput[];
  createdById?: string | null;
  metadata?: Record<string, unknown> | null;
  description?: string | null;
  paymentIntentId?: string | null;
  orderId?: string | null;
  refundId?: string | null;
  giftCardSubmissionId?: string | null;
  flexInstallmentId?: string | null;
  reversesId?: string | null;
};

export type LedgerTransactionWithEntries = Prisma.LedgerTransactionGetPayload<{ include: { entries: true } }>;

export type PostTransactionResult = { transaction: LedgerTransactionWithEntries; replayed: boolean };

/** Human-friendly unique reference, e.g. `TOP-261109-7KQ2M9XC`. */
export function makeReference(prefix: string, date = new Date()): string {
  const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no 0/O/1/I/L
  const bytes = randomBytes(8);
  let rand = '';
  for (const b of bytes) rand += alphabet[b % alphabet.length];
  const muscat = new Date(date.getTime() + 4 * 3600_000); // Asia/Muscat = UTC+4, no DST
  const ymd = muscat.toISOString().slice(2, 10).replace(/-/g, '');
  return `${prefix.toUpperCase()}-${ymd}-${rand}`;
}

/** Validate entries without touching the DB (exported for tests). */
export function validateEntries(entries: readonly LedgerEntryInput[]): void {
  if (!Array.isArray(entries) || entries.length < 2) {
    throw new MoneyError('ledger_invalid_entries', 'A ledger transaction needs at least two entries');
  }
  let sum = 0;
  for (const e of entries) {
    if (!e || typeof e.accountId !== 'string' || !e.accountId) {
      throw new MoneyError('ledger_invalid_entries', 'Every entry needs an accountId');
    }
    if (!isBaisa(e.amountBaisa) || e.amountBaisa === 0) {
      throw new MoneyError('ledger_invalid_entries', `Entry amounts must be non-zero integers of baisa (got ${String(e.amountBaisa)})`);
    }
    sum += e.amountBaisa;
  }
  if (!Number.isSafeInteger(sum)) throw new MoneyError('ledger_invalid_entries', 'Entry sum overflow');
  if (sum !== 0) throw new MoneyError('ledger_unbalanced', `Ledger entries must sum to 0 (sum = ${sum})`);
}

function sameEntries(a: readonly LedgerEntryInput[], b: readonly LedgerEntryInput[]): boolean {
  const key = (e: LedgerEntryInput) => `${e.accountId}:${e.amountBaisa}`;
  const x = a.map(key).sort();
  const y = b.map(key).sort();
  return x.length === y.length && x.every((v, i) => v === y[i]);
}

type LockedAccount = { id: string; type: LedgerAccountType; balanceBaisa: number };

/**
 * Lock the given accounts (`FOR UPDATE`, ordered by id) and return their rows.
 * Must run inside an interactive transaction.
 */
export async function lockAccounts(tx: Prisma.TransactionClient, accountIds: readonly string[]): Promise<Map<string, LockedAccount>> {
  const ids = [...new Set(accountIds)].sort();
  if (ids.length === 0) return new Map();
  const rows = await tx.$queryRaw<{ id: string; type: string; balanceBaisa: number }[]>`
    SELECT "id", "type"::text AS "type", "balanceBaisa"
    FROM "LedgerAccount"
    WHERE "id" IN (${Prisma.join(ids)})
    ORDER BY "id"
    FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, { id: r.id, type: r.type as LedgerAccountType, balanceBaisa: Number(r.balanceBaisa) }]));
}

/** SUM(entries) of one account (authoritative balance). */
export async function sumAccountEntries(db: Db, accountId: string): Promise<number> {
  const rows = await db.$queryRaw<{ total: bigint | number | null }[]>`
    SELECT COALESCE(SUM("amountBaisa"), 0)::bigint AS "total" FROM "LedgerEntry" WHERE "accountId" = ${accountId}`;
  return Number(rows[0]?.total ?? 0);
}

/**
 * Post a balanced transaction. MUST be called with an interactive transaction client
 * (`withLedgerTx`, `serializable` or `prisma.$transaction(async (tx) => …)`) so the
 * posting commits atomically with the business change it records (order paid, refund…).
 *
 * Same `idempotencyKey` again → returns the existing transaction (`replayed: true`);
 * if the entries differ from the original, throws `idempotency_conflict`.
 */
export async function postTransaction(tx: Prisma.TransactionClient, input: PostTransactionInput): Promise<PostTransactionResult> {
  const { reference, idempotencyKey, entries } = input;
  if (!reference || reference.length > 64) throw new MoneyError('invalid_input', 'reference is required (<= 64 chars)');
  if (!idempotencyKey || idempotencyKey.length > 200) throw new MoneyError('invalid_input', 'idempotencyKey is required (<= 200 chars)');
  validateEntries(entries);

  const existing = await tx.ledgerTransaction.findUnique({ where: { idempotencyKey }, include: { entries: true } });
  if (existing) {
    if (!sameEntries(existing.entries, entries)) {
      throw new MoneyError('idempotency_conflict', 'Idempotency key already used for different ledger entries');
    }
    return { transaction: existing, replayed: true };
  }

  const accounts = await lockAccounts(
    tx,
    entries.map((e) => e.accountId),
  );
  const deltas = new Map<string, number>();
  for (const e of entries) {
    if (!accounts.has(e.accountId)) throw new MoneyError('ledger_invalid_entries', `Unknown ledger account ${e.accountId}`);
    deltas.set(e.accountId, (deltas.get(e.accountId) ?? 0) + e.amountBaisa);
  }

  // Customer wallets: authoritative balance from entries, under the row lock.
  for (const [accountId, delta] of deltas) {
    const acc = accounts.get(accountId)!;
    if (acc.type !== 'CUSTOMER_WALLET') continue;
    const computed = await sumAccountEntries(tx, accountId);
    if (computed !== acc.balanceBaisa) {
      throw new MoneyError('ledger_integrity', `Wallet account ${accountId} cache (${acc.balanceBaisa}) != entries (${computed})`);
    }
    if (computed + delta < 0) {
      throw new MoneyError('insufficient_balance', 'Insufficient wallet balance', {
        accountId,
        balanceBaisa: computed,
        requiredBaisa: -delta,
      });
    }
  }

  const transaction = await tx.ledgerTransaction.create({
    data: {
      reference,
      type: input.type,
      idempotencyKey,
      description: input.description ?? null,
      paymentIntentId: input.paymentIntentId ?? null,
      orderId: input.orderId ?? null,
      refundId: input.refundId ?? null,
      giftCardSubmissionId: input.giftCardSubmissionId ?? null,
      flexInstallmentId: input.flexInstallmentId ?? null,
      reversesId: input.reversesId ?? null,
      createdById: input.createdById ?? null,
      ...(input.metadata ? { metadata: input.metadata as Prisma.InputJsonValue } : {}),
      entries: { create: entries.map((e) => ({ accountId: e.accountId, amountBaisa: e.amountBaisa })) },
    },
    include: { entries: true },
  });

  for (const [accountId, delta] of [...deltas].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (delta === 0) continue;
    await tx.$executeRaw`
      UPDATE "LedgerAccount" SET "balanceBaisa" = "balanceBaisa" + ${delta}, "updatedAt" = now() WHERE "id" = ${accountId}`;
  }

  return { transaction, replayed: false };
}

/**
 * Run `fn` in a READ COMMITTED interactive transaction (row locks via `lockAccounts`),
 * retrying on deadlock / serialization failures and on unique-key races (a concurrent
 * request with the same idempotency key committed first: the retry then replays it).
 */
export async function withLedgerTx<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
  opts: { maxRetries?: number; timeoutMs?: number } = {},
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 4;
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction(fn, {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: opts.timeoutMs ?? 20_000,
        maxWait: 15_000,
      });
    } catch (err) {
      const retryable = isSerializationFailure(err) || isUniqueViolation(err, 'idempotencyKey');
      if (attempt < maxRetries && retryable) {
        await new Promise((r) => setTimeout(r, 20 * 2 ** attempt + Math.random() * 30));
        continue;
      }
      throw err;
    }
  }
}

// ───────────── Accounts ─────────────

const systemAccountCache = new Map<string, string>();

/** Id of a seeded system account (cached per process). */
export async function systemAccountId(db: Db, code: SystemAccountCode): Promise<string> {
  const cached = systemAccountCache.get(code);
  if (cached) return cached;
  const acc = await db.ledgerAccount.findUnique({ where: { code }, select: { id: true, isSystem: true } });
  if (!acc || !acc.isSystem) {
    throw new MoneyError('ledger_integrity', `System ledger account ${code} is missing — run the seed (npm run db:seed)`);
  }
  systemAccountCache.set(code, acc.id);
  return acc.id;
}

export function walletAccountCode(userId: string): string {
  return `WALLET:${userId}`;
}

export type WalletInfo = { walletId: string; ledgerAccountId: string; status: WalletStatus; currency: string };

/**
 * The user's wallet, created lazily (Wallet row + CUSTOMER_WALLET ledger account
 * `WALLET:<userId>`). Safe under concurrency (unique code / userId).
 */
export async function ensureWallet(userId: string, db: Db = prisma): Promise<WalletInfo> {
  const found = await db.wallet.findUnique({ where: { userId } });
  if (found) return { walletId: found.id, ledgerAccountId: found.ledgerAccountId, status: found.status, currency: found.currency };

  const create = async (tx: Prisma.TransactionClient) => {
    const user = await tx.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new MoneyError('not_found', 'User not found');
    const account = await tx.ledgerAccount.upsert({
      where: { code: walletAccountCode(userId) },
      update: {},
      create: { code: walletAccountCode(userId), type: 'CUSTOMER_WALLET', name: `Wallet ${userId}`, userId, isSystem: false },
    });
    return tx.wallet.create({ data: { userId, ledgerAccountId: account.id } });
  };

  try {
    // Inside a caller's transaction we cannot open another one.
    const wallet = '$transaction' in db ? await (db as typeof prisma).$transaction(create) : await create(db as Prisma.TransactionClient);
    return { walletId: wallet.id, ledgerAccountId: wallet.ledgerAccountId, status: wallet.status, currency: wallet.currency };
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const again = await prisma.wallet.findUniqueOrThrow({ where: { userId } });
    return { walletId: again.id, ledgerAccountId: again.ledgerAccountId, status: again.status, currency: again.currency };
  }
}

// ───────────── Reads ─────────────

export type WalletBalance = {
  balanceBaisa: number;
  /** Top-ups started but not yet confirmed by the provider (informational, NOT spendable). */
  pendingTopUpBaisa: number;
  /** Gift cards awaiting verification (declared OMR values only; NOT spendable). */
  pendingGiftCardBaisa: number;
  pendingCount: number;
  status: WalletStatus;
  currency: string;
};

export async function getBalance(userId: string, db: Db = prisma): Promise<WalletBalance> {
  const wallet = await ensureWallet(userId, db);
  const [account, pendingIntents, pendingCards] = await Promise.all([
    db.ledgerAccount.findUniqueOrThrow({ where: { id: wallet.ledgerAccountId }, select: { balanceBaisa: true } }),
    db.paymentIntent.aggregate({
      where: { userId, purpose: 'TOPUP', status: { in: ['CREATED', 'PENDING', 'REQUIRES_ACTION'] }, provider: { not: 'GIFT_CARD' } },
      _sum: { amountBaisa: true },
      _count: true,
    }),
    db.giftCardSubmission.findMany({
      where: { userId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      select: { declaredValue: true, declaredCurrency: true },
    }),
  ]);
  const pendingGiftCardBaisa = pendingCards.filter((c) => c.declaredCurrency === 'OMR').reduce((s, c) => s + c.declaredValue, 0);
  return {
    balanceBaisa: account.balanceBaisa,
    pendingTopUpBaisa: pendingIntents._sum.amountBaisa ?? 0,
    pendingGiftCardBaisa,
    pendingCount: pendingIntents._count + pendingCards.length,
    status: wallet.status,
    currency: wallet.currency,
  };
}

export type HistoryDirection = 'all' | 'credit' | 'debit';

export type HistoryItem = {
  entryId: string;
  transactionId: string;
  reference: string;
  type: LedgerTransactionType;
  amountBaisa: number;
  createdAt: Date;
  description: string | null;
  provider: string | null;
  orderId: string | null;
  orderNumber: string | null;
};

export type HistoryPage = { items: HistoryItem[]; nextCursor: string | null };

/**
 * Confirmed wallet movements, newest first, cursor-paginated (cursor = entry id).
 * Pending / rejected top-ups and gift cards are listed separately (see lib/wallet/activity).
 */
export async function getHistory(
  userId: string,
  cursor?: string | null,
  opts: { limit?: number; direction?: HistoryDirection } = {},
  db: Db = prisma,
): Promise<HistoryPage> {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 100);
  const wallet = await db.wallet.findUnique({ where: { userId }, select: { ledgerAccountId: true } });
  if (!wallet) return { items: [], nextCursor: null };
  const direction = opts.direction ?? 'all';
  const where: Prisma.LedgerEntryWhereInput = {
    accountId: wallet.ledgerAccountId,
    ...(direction === 'credit' ? { amountBaisa: { gt: 0 } } : direction === 'debit' ? { amountBaisa: { lt: 0 } } : {}),
  };
  let validCursor: string | undefined;
  if (cursor) {
    const c = await db.ledgerEntry.findFirst({ where: { id: cursor, accountId: wallet.ledgerAccountId }, select: { id: true } });
    validCursor = c?.id;
  }
  const rows = await db.ledgerEntry.findMany({
    where,
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(validCursor ? { cursor: { id: validCursor }, skip: 1 } : {}),
    include: {
      transaction: {
        select: {
          id: true,
          reference: true,
          type: true,
          description: true,
          orderId: true,
          paymentIntent: { select: { provider: true } },
        },
      },
    },
  });
  const page = rows.slice(0, limit);
  const orderIds = [...new Set(page.map((r) => r.transaction.orderId).filter((v): v is string => !!v))];
  const orders = orderIds.length
    ? await db.order.findMany({ where: { id: { in: orderIds } }, select: { id: true, number: true } })
    : [];
  const numbers = new Map(orders.map((o) => [o.id, o.number]));
  return {
    items: page.map((r) => ({
      entryId: r.id,
      transactionId: r.transaction.id,
      reference: r.transaction.reference,
      type: r.transaction.type,
      amountBaisa: r.amountBaisa,
      createdAt: r.createdAt,
      description: r.transaction.description,
      provider: r.transaction.paymentIntent?.provider ?? null,
      orderId: r.transaction.orderId,
      orderNumber: r.transaction.orderId ? (numbers.get(r.transaction.orderId) ?? null) : null,
    })),
    nextCursor: rows.length > limit ? (page[page.length - 1]?.id ?? null) : null,
  };
}
