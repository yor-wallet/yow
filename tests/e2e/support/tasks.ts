/**
 * Database tasks for the e2e fixtures, run in a separate `tsx` process (it resolves the `@/` alias of
 * tsconfig.json; Playwright's own loader does not for files outside the tests folder). Reuses the
 * real library code — hashing, double-entry ledger, order placement — so fixtures obey the real rules.
 *
 *   DATABASE_URL=<test db> npx tsx tests/e2e/support/tasks.ts '{"task":"fundWallet","userId":"…","amountBaisa":1000}'
 * Prints one JSON line on stdout.
 */
import { prisma } from '@/lib/db';
import { createUser } from '@/lib/auth/service';
import { addItem } from '@/lib/cart/store';
import { placeOrder } from '@/lib/orders/place';
import { ensureWallet, getBalance, makeReference, postTransaction, systemAccountId, withLedgerTx } from '@/lib/wallet/ledger';

type Task =
  | { task: 'createUser'; fullName: string; email: string; phone: string; password: string }
  | { task: 'createStaff'; fullName: string; email: string; phone: string; password: string; role: 'SUPPORT' | 'LOGISTICS' | 'FINANCE' | 'CATALOG' | 'ADMIN' }
  | { task: 'fundWallet'; userId: string; amountBaisa: number }
  | { task: 'walletBalance'; userId: string }
  | { task: 'placeUnpaidOrder'; userId: string; variantSku: string; qty: number };

async function run(t: Task): Promise<unknown> {
  switch (t.task) {
    case 'createUser': {
      const res = await createUser({ fullName: t.fullName, email: t.email, phone: t.phone, password: t.password, confirmPassword: t.password, acceptTerms: true, locale: 'en' });
      if (!res.ok) throw new Error(`createUser failed: ${res.error}`);
      return { id: res.user.id };
    }
    case 'createStaff': {
      // A staff member is an ordinary account whose role was raised — in the TEST database only.
      const res = await createUser({ fullName: t.fullName, email: t.email, phone: t.phone, password: t.password, confirmPassword: t.password, acceptTerms: true, locale: 'en' });
      if (!res.ok) throw new Error(`createUser failed: ${res.error}`);
      await prisma.user.update({ where: { id: res.user.id }, data: { role: t.role } });
      return { id: res.user.id };
    }
    case 'fundWallet': {
      const wallet = await ensureWallet(t.userId);
      const adjustments = await systemAccountId(prisma, 'ADJUSTMENTS');
      await withLedgerTx((tx) =>
        postTransaction(tx, {
          reference: makeReference('ADJ'),
          type: 'ADJUSTMENT',
          idempotencyKey: `e2e-fund-${t.userId}-${t.amountBaisa}`,
          description: 'E2E test funding',
          entries: [
            { accountId: wallet.ledgerAccountId, amountBaisa: t.amountBaisa },
            { accountId: adjustments, amountBaisa: -t.amountBaisa },
          ],
        }),
      );
      return { ok: true };
    }
    case 'walletBalance':
      return { balanceBaisa: (await getBalance(t.userId)).balanceBaisa };
    case 'placeUnpaidOrder': {
      const variant = await prisma.productVariant.findUniqueOrThrow({ where: { sku: t.variantSku }, select: { id: true } });
      const address = await prisma.address.findFirstOrThrow({ where: { userId: t.userId, isDefault: true } });
      const added = await addItem({ userId: t.userId }, variant.id, t.qty);
      if (!added.ok) throw new Error(`addItem failed: ${added.error}`);
      const placed = await placeOrder({
        userId: t.userId,
        idempotencyKey: `e2e${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`,
        addressId: address.id,
        deliveryType: 'STANDARD',
        paymentMethod: 'WALLET',
        locale: 'en',
      });
      return { number: placed.number };
    }
  }
}

run(JSON.parse(process.argv[2] ?? '{}') as Task)
  .then(async (out) => {
    console.log(JSON.stringify(out));
    await prisma.$disconnect();
  })
  .catch(async (err) => {
    console.error(err instanceof Error ? err.stack : err);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(1);
  });
