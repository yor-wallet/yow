import type { Prisma } from '@prisma/client';
import { AdminError } from '@/lib/admin/actor';

/**
 * Bridges to functions owned by other modules (called, never reimplemented).
 * PENDING: wired to lib/orders `releaseExpiredReservations` once the storefront exports it.
 */
export const RESERVATION_RELEASE_AVAILABLE = false;

export async function releaseExpiredReservationsForAgents(_tx: Prisma.TransactionClient): Promise<number> {
  throw new AdminError('action_unavailable');
}
