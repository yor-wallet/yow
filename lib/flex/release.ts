import type { Prisma } from '@prisma/client';
import { logAudit } from '@/lib/audit';

/**
 * DOOM FLEX — the order placed when the customer confirmed a plan is cancelled before the first instalment was
 * paid (its stock reservation expired, or the customer cancelled the order): the plan goes back to "approved".
 * Its unpaid instalments are removed, so the customer can confirm again (a new order, a new schedule from that
 * day) while the approval is still valid.
 *
 * Runs INSIDE the order's cancellation transaction (lib/orders `cancelOrderTx`). Leaf module: it must not import
 * lib/orders or lib/flex/service. Nothing changes once an instalment is paid (the order is then paid too, so it
 * cannot be cancelled as unpaid). A payment of the first instalment still open at that moment (crypto) is not
 * lost: if it is confirmed later, it is credited to the customer's wallet (lib/payments/core).
 */
export async function releaseFlexPlanForOrder(tx: Prisma.TransactionClient, orderId: string, reason: string): Promise<boolean> {
  const found = await tx.flexApplication.findFirst({ where: { orderId }, select: { id: true } });
  if (!found) return false;
  await tx.$queryRaw`SELECT "id" FROM "FlexApplication" WHERE "id" = ${found.id} FOR UPDATE`;
  const app = await tx.flexApplication.findUniqueOrThrow({ where: { id: found.id }, select: { id: true, status: true, orderId: true } });
  if (app.status !== 'ACCEPTED' || app.orderId !== orderId) return false;
  if ((await tx.flexInstallment.count({ where: { applicationId: app.id, status: 'PAID' } })) > 0) return false;

  const removed = await tx.flexInstallment.deleteMany({ where: { applicationId: app.id } });
  await tx.flexApplication.update({ where: { id: app.id }, data: { status: 'APPROVED', orderId: null } });
  await logAudit(
    {
      actorId: null,
      action: 'flex.order_released',
      entity: 'FlexApplication',
      entityId: app.id,
      before: { status: 'ACCEPTED', orderId },
      after: { status: 'APPROVED', reason, installmentsRemoved: removed.count },
    },
    tx,
  );
  return true;
}
