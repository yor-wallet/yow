import { randomBytes } from 'node:crypto';
import type { OrderStatus, RefundMethod, Role } from '@prisma/client';
import { prisma, isUniqueViolation } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { isBaisa } from '@/lib/money';
import { can } from '@/lib/rbac';
import { MoneyError } from '@/lib/wallet/errors';
import { ensureWallet, postTransaction, systemAccountId, withLedgerTx } from '@/lib/wallet/ledger';
import { ledgerReference } from './core';
import { getAdapter } from './registry';
import { notifyMoney } from './notify';
import { isExternalProvider, type ExternalProviderId } from './types';

/**
 * Refunds (FINANCE / ADMIN — permission `refunds:approve`, audited).
 *  - Card payments: full refunds go back to the card through the provider refund API when
 *    the gateway is configured; otherwise (or on provider failure / partial amounts) the
 *    refund is credited to the customer's DOOM Wallet.
 *  - Every other method: DOOM Wallet credit (REFUNDS → CUSTOMER_WALLET).
 *  - DOOM FLEX orders: full refund only — paid instalments are credited to the wallet, unpaid
 *    instalments are cancelled and the outstanding receivable is written off.
 * The order becomes REFUNDED (fully refunded) or PARTIALLY_REFUNDED.
 */

const REFUNDABLE: readonly OrderStatus[] = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'PARTIALLY_REFUNDED'];

export type RefundOrderInput = {
  orderId: string;
  amountBaisa: number;
  reason: string;
  actorId: string;
  /** Optional client key: the same key returns the same refund (double-click safe). */
  idempotencyKey?: string;
};

export type RefundOrderResult = {
  refundId: string;
  method: RefundMethod;
  amountBaisa: number;
  orderStatus: OrderStatus;
  providerRef: string | null;
  replayed: boolean;
};

async function staff(actorId: string): Promise<{ id: string; role: Role }> {
  const u = await prisma.user.findUnique({ where: { id: actorId }, select: { id: true, role: true, status: true } });
  if (!u || u.status !== 'ACTIVE' || !can(u.role, 'refunds:approve')) throw new MoneyError('forbidden', 'Refunds require the FINANCE or ADMIN role');
  return { id: u.id, role: u.role };
}

export async function refundOrder(input: RefundOrderInput): Promise<RefundOrderResult> {
  const actor = await staff(input.actorId);
  const reason = input.reason?.trim().slice(0, 500);
  if (!reason) throw new MoneyError('invalid_input', 'A refund reason is required');
  if (!isBaisa(input.amountBaisa) || input.amountBaisa <= 0) throw new MoneyError('invalid_amount');
  const key = `refund:${input.orderId}:${input.idempotencyKey ?? randomBytes(12).toString('hex')}`;

  const existing = await prisma.refund.findUnique({ where: { idempotencyKey: key }, include: { order: { select: { status: true } } } });
  if (existing) {
    if (existing.amountBaisa !== input.amountBaisa) throw new MoneyError('idempotency_key_reused');
    return {
      refundId: existing.id,
      method: existing.method,
      amountBaisa: existing.amountBaisa,
      orderStatus: existing.order?.status ?? 'REFUNDED',
      providerRef: existing.providerRef,
      replayed: true,
    };
  }

  const order = await prisma.order.findUnique({
    where: { id: input.orderId },
    select: { id: true, userId: true, number: true, status: true, totalBaisa: true, paymentMethod: true, flexApplication: { select: { id: true } } },
  });
  if (!order) throw new MoneyError('not_found', 'Order not found');
  await ensureWallet(order.userId);

  // The ledger payment of the order (wallet credits of late payments are not order payments).
  const payment = await prisma.ledgerTransaction.findFirst({
    where: { orderId: order.id, type: { in: ['ORDER_PAYMENT', 'FLEX_DISBURSEMENT'] } },
    select: { id: true, type: true, paymentIntent: { select: { id: true, provider: true, providerRef: true, confirmedAmountBaisa: true } } },
  });
  if (!payment?.paymentIntent) throw new MoneyError('order_not_refundable', 'Order has no confirmed payment');
  const intent = payment.paymentIntent;
  const isFlex = payment.type === 'FLEX_DISBURSEMENT';

  // Phase 1 — reserve the refund (order row lock ⇒ concurrent refunds cannot exceed the paid amount).
  const phase1 = await withLedgerTx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "Order" WHERE "id" = ${order.id} FOR UPDATE`;
    const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true, totalBaisa: true } });
    if (!REFUNDABLE.includes(fresh.status)) throw new MoneyError('order_not_refundable', `Order status ${fresh.status}`);
    const agg = await tx.refund.aggregate({ where: { orderId: order.id, status: { in: ['PROCESSING', 'COMPLETED', 'APPROVED'] } }, _sum: { amountBaisa: true } });
    const refunded = agg._sum.amountBaisa ?? 0;

    let flexPaid = 0;
    let flexOutstanding = 0;
    if (isFlex) {
      const inst = await tx.flexInstallment.findMany({ where: { application: { orderId: order.id } }, select: { status: true, amountBaisa: true } });
      flexPaid = inst.filter((i) => i.status === 'PAID').reduce((s, i) => s + i.amountBaisa, 0);
      flexOutstanding = inst.filter((i) => i.status === 'PENDING' || i.status === 'OVERDUE').reduce((s, i) => s + i.amountBaisa, 0);
      if (refunded > 0 || input.amountBaisa !== flexPaid) {
        throw new MoneyError('flex_partial_refund_unsupported', 'FLEX orders are refunded in full (the instalments paid so far)', { paidBaisa: flexPaid });
      }
    } else if (refunded + input.amountBaisa > fresh.totalBaisa) {
      throw new MoneyError('refund_exceeds_paid', undefined, { refundableBaisa: fresh.totalBaisa - refunded });
    }

    const refund = await tx.refund.create({
      data: {
        orderId: order.id,
        paymentIntentId: intent.id,
        userId: order.userId,
        amountBaisa: input.amountBaisa,
        reason,
        status: 'PROCESSING',
        method: 'WALLET',
        idempotencyKey: key,
        requestedById: actor.id,
        approvedById: actor.id,
      },
    });
    return { refund, refunded, flexOutstanding, orderTotal: fresh.totalBaisa };
  }).catch(async (err) => {
    if (isUniqueViolation(err, 'idempotencyKey')) return null;
    throw err;
  });
  if (!phase1) return refundOrder(input); // concurrent duplicate committed first → replay

  const { refund } = phase1;

  // Phase 2 — provider refund (network, outside any DB transaction) for full card refunds.
  let method: RefundMethod = 'WALLET';
  let providerRef: string | null = null;
  let providerNote: string | null = null;
  if (!isFlex && isExternalProvider(intent.provider) && intent.providerRef && phase1.refunded === 0 && input.amountBaisa === intent.confirmedAmountBaisa) {
    const adapter = getAdapter(intent.provider as ExternalProviderId);
    if (adapter.refund && adapter.supportsRefund?.()) {
      try {
        const res = await adapter.refund({ providerRef: intent.providerRef, amountBaisa: input.amountBaisa, reason });
        method = 'ORIGINAL_METHOD';
        providerRef = res.providerRef;
        await prisma.refund.update({ where: { id: refund.id }, data: { method, providerRef } });
      } catch (err) {
        providerNote = `provider refund failed, credited to wallet: ${err instanceof Error ? err.message : String(err)}`.slice(0, 500);
      }
    }
  }

  // Phase 3 — ledger + statuses, atomically.
  return withLedgerTx(async (tx) => {
    const refundsAcc = await systemAccountId(tx, 'REFUNDS');
    const wallet = await tx.wallet.findUniqueOrThrow({ where: { userId: order.userId }, select: { ledgerAccountId: true } });
    const destination = method === 'ORIGINAL_METHOD' ? await systemAccountId(tx, 'PAYMENT_CLEARING') : wallet.ledgerAccountId;
    await postTransaction(tx, {
      reference: ledgerReference('REFUND'),
      type: 'REFUND',
      idempotencyKey: `refund:${refund.id}`,
      refundId: refund.id,
      orderId: order.id,
      createdById: actor.id,
      description: method === 'ORIGINAL_METHOD' ? 'refund_to_card' : 'refund_to_wallet',
      metadata: { reason, method, providerRef },
      entries: [
        { accountId: refundsAcc, amountBaisa: -input.amountBaisa },
        { accountId: destination, amountBaisa: input.amountBaisa },
      ],
    });

    let orderStatus: OrderStatus;
    if (isFlex) {
      if (phase1.flexOutstanding > 0) {
        await postTransaction(tx, {
          reference: ledgerReference('REFUND'),
          type: 'REFUND',
          idempotencyKey: `refund:${refund.id}:flex-writeoff`,
          refundId: refund.id,
          orderId: order.id,
          createdById: actor.id,
          description: 'flex_receivable_writeoff',
          entries: [
            { accountId: refundsAcc, amountBaisa: -phase1.flexOutstanding },
            { accountId: await systemAccountId(tx, 'FLEX_RECEIVABLE'), amountBaisa: phase1.flexOutstanding },
          ],
        });
      }
      if (order.flexApplication) {
        await tx.flexInstallment.updateMany({ where: { applicationId: order.flexApplication.id, status: { in: ['PENDING', 'OVERDUE'] } }, data: { status: 'CANCELLED' } });
        await tx.flexApplication.update({ where: { id: order.flexApplication.id }, data: { status: 'CANCELLED' } });
      }
      orderStatus = 'REFUNDED';
    } else {
      orderStatus = phase1.refunded + input.amountBaisa >= phase1.orderTotal ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
    }

    const current = await tx.order.findUniqueOrThrow({ where: { id: order.id }, select: { status: true } });
    await tx.order.update({ where: { id: order.id }, data: { status: orderStatus } });
    await tx.orderStatusEvent.create({
      data: { orderId: order.id, fromStatus: current.status, toStatus: orderStatus, actorId: actor.id, note: `refund ${refund.id}` },
    });
    await tx.refund.update({
      where: { id: refund.id },
      data: { status: 'COMPLETED', processedAt: new Date(), method, providerRef, notes: providerNote },
    });
    await logAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'refund.complete',
        entity: 'Refund',
        entityId: refund.id,
        after: { orderId: order.id, amountBaisa: input.amountBaisa, method, providerRef, orderStatus, reason, flex: isFlex },
      },
      tx,
    );
    await notifyMoney(order.userId, 'refundIssued', { amountBaisa: input.amountBaisa, number: order.number }, method === 'WALLET' ? '/wallet' : `/orders/${order.number}`, tx);
    return { refundId: refund.id, method, amountBaisa: input.amountBaisa, orderStatus, providerRef, replayed: false };
  });
}
