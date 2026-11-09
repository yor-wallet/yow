import type { Prisma } from '@prisma/client';
import { markOrderPaid as storefrontMarkOrderPaid, type MarkPaidResult } from '@/lib/orders';

/**
 * Bridge to the storefront's order lifecycle (lib/orders). The money module calls it
 * INSIDE its payment-confirmation transaction so "payment succeeded" and "order paid"
 * commit together.
 */
export type { MarkPaidResult };

export async function markOrderPaid(orderId: string, paymentIntentId: string, tx: Prisma.TransactionClient): Promise<MarkPaidResult> {
  return storefrontMarkOrderPaid(orderId, paymentIntentId, tx);
}
