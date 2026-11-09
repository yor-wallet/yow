import { prisma, type Db } from '@/lib/db';

/**
 * Ledger reconciliation (read-only). Run from the admin finance centre or a cron job.
 * Every check returns its count of anomalies and up to `sampleSize` samples. `ok` is
 * true only when every check is clean. See docs/PAYMENTS.md → Reconciliation.
 */

export type ReconcileCheckKey =
  | 'transactions_balanced'
  | 'transactions_min_entries'
  | 'global_sum_zero'
  | 'account_balance_cache'
  | 'wallets_non_negative'
  | 'succeeded_intents_posted_once'
  | 'ledger_intents_succeeded'
  | 'intent_amount_matches_ledger'
  | 'verified_gift_cards_credited';

export type ReconcileCheck = {
  key: ReconcileCheckKey;
  ok: boolean;
  count: number;
  samples: Record<string, unknown>[];
};

export type ReconcileReport = {
  ok: boolean;
  generatedAt: string;
  checks: ReconcileCheck[];
  totals: {
    transactions: number;
    entries: number;
    walletCount: number;
    walletLiabilityBaisa: number;
    systemAccounts: { code: string; balanceBaisa: number }[];
    succeededIntents: number;
  };
};

const num = (v: unknown) => (typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : Number(v ?? 0));

function normalise(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
}

export async function reconcile(opts: { sampleSize?: number } = {}, db: Db = prisma): Promise<ReconcileReport> {
  const limit = Math.min(Math.max(opts.sampleSize ?? 20, 1), 200);

  const check = async (key: ReconcileCheckKey, countSql: Promise<{ n: bigint | number }[]>, samplesSql: Promise<Record<string, unknown>[]>) => {
    const [c, s] = await Promise.all([countSql, samplesSql]);
    const count = num(c[0]?.n);
    return { key, ok: count === 0, count, samples: normalise(s) } satisfies ReconcileCheck;
  };

  const checks: ReconcileCheck[] = [];

  checks.push(
    await check(
      'transactions_balanced',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM (SELECT "transactionId" FROM "LedgerEntry" GROUP BY "transactionId" HAVING SUM("amountBaisa") <> 0) x`,
      db.$queryRaw`SELECT "transactionId", SUM("amountBaisa")::bigint AS "sum" FROM "LedgerEntry" GROUP BY "transactionId" HAVING SUM("amountBaisa") <> 0 LIMIT ${limit}`,
    ),
  );

  checks.push(
    await check(
      'transactions_min_entries',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "LedgerTransaction" t WHERE (SELECT COUNT(*) FROM "LedgerEntry" e WHERE e."transactionId" = t.id) < 2`,
      db.$queryRaw`SELECT t.id, t.reference, (SELECT COUNT(*) FROM "LedgerEntry" e WHERE e."transactionId" = t.id)::bigint AS "entries"
                   FROM "LedgerTransaction" t WHERE (SELECT COUNT(*) FROM "LedgerEntry" e WHERE e."transactionId" = t.id) < 2 LIMIT ${limit}`,
    ),
  );

  const global = await db.$queryRaw<{ s: bigint | number | null }[]>`SELECT COALESCE(SUM("amountBaisa"), 0)::bigint AS s FROM "LedgerEntry"`;
  const globalSum = num(global[0]?.s);
  checks.push({ key: 'global_sum_zero', ok: globalSum === 0, count: globalSum === 0 ? 0 : 1, samples: globalSum === 0 ? [] : [{ sum: globalSum }] });

  checks.push(
    await check(
      'account_balance_cache',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "LedgerAccount" a
                   WHERE a."balanceBaisa" <> COALESCE((SELECT SUM(e."amountBaisa") FROM "LedgerEntry" e WHERE e."accountId" = a.id), 0)`,
      db.$queryRaw`SELECT a.id, a.code, a."balanceBaisa" AS "cachedBaisa",
                     COALESCE((SELECT SUM(e."amountBaisa") FROM "LedgerEntry" e WHERE e."accountId" = a.id), 0)::bigint AS "entriesBaisa"
                   FROM "LedgerAccount" a
                   WHERE a."balanceBaisa" <> COALESCE((SELECT SUM(e."amountBaisa") FROM "LedgerEntry" e WHERE e."accountId" = a.id), 0)
                   LIMIT ${limit}`,
    ),
  );

  checks.push(
    await check(
      'wallets_non_negative',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "LedgerAccount" WHERE "type" = 'CUSTOMER_WALLET' AND "balanceBaisa" < 0`,
      db.$queryRaw`SELECT id, code, "balanceBaisa" FROM "LedgerAccount" WHERE "type" = 'CUSTOMER_WALLET' AND "balanceBaisa" < 0 LIMIT ${limit}`,
    ),
  );

  checks.push(
    await check(
      'succeeded_intents_posted_once',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "PaymentIntent" p
                   WHERE p.status = 'SUCCEEDED' AND (SELECT COUNT(*) FROM "LedgerTransaction" t WHERE t."paymentIntentId" = p.id) <> 1`,
      db.$queryRaw`SELECT p.id, p.provider::text AS provider, p.purpose::text AS purpose, p."confirmedAmountBaisa",
                     (SELECT COUNT(*) FROM "LedgerTransaction" t WHERE t."paymentIntentId" = p.id)::bigint AS "ledgerTransactions"
                   FROM "PaymentIntent" p
                   WHERE p.status = 'SUCCEEDED' AND (SELECT COUNT(*) FROM "LedgerTransaction" t WHERE t."paymentIntentId" = p.id) <> 1
                   LIMIT ${limit}`,
    ),
  );

  checks.push(
    await check(
      'ledger_intents_succeeded',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "LedgerTransaction" t JOIN "PaymentIntent" p ON p.id = t."paymentIntentId" WHERE p.status <> 'SUCCEEDED'`,
      db.$queryRaw`SELECT t.id, t.reference, p.id AS "paymentIntentId", p.status::text AS status
                   FROM "LedgerTransaction" t JOIN "PaymentIntent" p ON p.id = t."paymentIntentId" WHERE p.status <> 'SUCCEEDED' LIMIT ${limit}`,
    ),
  );

  // The positive side of the payment's ledger transaction equals the confirmed amount.
  checks.push(
    await check(
      'intent_amount_matches_ledger',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "PaymentIntent" p JOIN "LedgerTransaction" t ON t."paymentIntentId" = p.id
                   WHERE p.status = 'SUCCEEDED'
                     AND COALESCE(p."confirmedAmountBaisa", -1) <> (SELECT COALESCE(SUM(e."amountBaisa"), 0) FROM "LedgerEntry" e WHERE e."transactionId" = t.id AND e."amountBaisa" > 0)`,
      db.$queryRaw`SELECT p.id, p."confirmedAmountBaisa", t.reference,
                     (SELECT COALESCE(SUM(e."amountBaisa"), 0) FROM "LedgerEntry" e WHERE e."transactionId" = t.id AND e."amountBaisa" > 0)::bigint AS "ledgerBaisa"
                   FROM "PaymentIntent" p JOIN "LedgerTransaction" t ON t."paymentIntentId" = p.id
                   WHERE p.status = 'SUCCEEDED'
                     AND COALESCE(p."confirmedAmountBaisa", -1) <> (SELECT COALESCE(SUM(e."amountBaisa"), 0) FROM "LedgerEntry" e WHERE e."transactionId" = t.id AND e."amountBaisa" > 0)
                   LIMIT ${limit}`,
    ),
  );

  checks.push(
    await check(
      'verified_gift_cards_credited',
      db.$queryRaw`SELECT COUNT(*)::bigint AS n FROM "GiftCardSubmission" g
                   WHERE g.status = 'VERIFIED' AND (SELECT COUNT(*) FROM "LedgerTransaction" t WHERE t."giftCardSubmissionId" = g.id) <> 1`,
      db.$queryRaw`SELECT g.id, g."encashedValueBaisa", (SELECT COUNT(*) FROM "LedgerTransaction" t WHERE t."giftCardSubmissionId" = g.id)::bigint AS "ledgerTransactions"
                   FROM "GiftCardSubmission" g
                   WHERE g.status = 'VERIFIED' AND (SELECT COUNT(*) FROM "LedgerTransaction" t WHERE t."giftCardSubmissionId" = g.id) <> 1
                   LIMIT ${limit}`,
    ),
  );

  const [transactions, entries, walletAgg, systemAccounts, succeededIntents] = await Promise.all([
    db.ledgerTransaction.count(),
    db.ledgerEntry.count(),
    db.ledgerAccount.aggregate({ where: { type: 'CUSTOMER_WALLET' }, _sum: { balanceBaisa: true }, _count: true }),
    db.ledgerAccount.findMany({ where: { isSystem: true }, select: { code: true, balanceBaisa: true }, orderBy: { code: 'asc' } }),
    db.paymentIntent.count({ where: { status: 'SUCCEEDED' } }),
  ]);

  return {
    ok: checks.every((c) => c.ok),
    generatedAt: new Date().toISOString(),
    checks,
    totals: {
      transactions,
      entries,
      walletCount: walletAgg._count,
      walletLiabilityBaisa: walletAgg._sum.balanceBaisa ?? 0,
      systemAccounts,
      succeededIntents,
    },
  };
}
