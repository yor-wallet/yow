import 'server-only';
import type { FlexStatus } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * Admin view of DOOM FLEX (payment in 3, 6 or 12 monthly instalments, 0 % interest, no fees). The decision
 * goes through `decideFlexApplication` (lib/flex), which checks the role, the identity and writes the audit;
 * the schedule is created when the customer accepts the terms of an approved application.
 */
export const FLEX_ADMIN_TABS: readonly FlexStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'ACTIVE', 'COMPLETED', 'REJECTED', 'CANCELLED'];

export async function flexCounts(): Promise<Record<string, number>> {
  const rows = await prisma.flexApplication.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function listFlexForAdmin(status: FlexStatus, take = 100) {
  const open = status === 'SUBMITTED' || status === 'UNDER_REVIEW';
  return prisma.flexApplication.findMany({
    where: { status },
    // Waiting for a decision: oldest first. Everything else: latest change first.
    orderBy: open ? { createdAt: 'asc' } : { updatedAt: 'desc' },
    take: Math.min(take, 200),
    select: {
      id: true,
      status: true,
      months: true,
      principalBaisa: true,
      createdAt: true,
      user: { select: { fullName: true, email: true } },
      product: { select: { name: true } },
      installments: { select: { status: true } },
    },
  });
}

export async function getFlexForAdmin(id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  return prisma.flexApplication.findUnique({
    where: { id },
    select: {
      id: true,
      status: true,
      months: true,
      principalBaisa: true,
      createdAt: true,
      decidedAt: true,
      decisionNote: true,
      termsAcceptedAt: true,
      partnerRef: true,
      decidedBy: { select: { fullName: true } },
      user: { select: { id: true, fullName: true, email: true, phone: true, kycStatus: true, status: true, createdAt: true } },
      product: { select: { name: true, slug: true } },
      variant: { select: { name: true, sku: true, priceBaisa: true } },
      order: { select: { number: true, status: true } },
      installments: { orderBy: { sequence: 'asc' }, select: { id: true, sequence: true, dueDate: true, amountBaisa: true, status: true, paidAt: true } },
    },
  });
}

/** What this customer already owes or owed: other plans, and instalments that are late. */
export async function flexCustomerHistory(userId: string, exceptId: string) {
  const [plans, overdue] = await Promise.all([
    prisma.flexApplication.groupBy({ by: ['status'], where: { userId, id: { not: exceptId } }, _count: { _all: true } }),
    prisma.flexInstallment.count({ where: { application: { userId }, status: 'OVERDUE' } }),
  ]);
  return { plans: Object.fromEntries(plans.map((p) => [p.status, p._count._all])) as Record<string, number>, overdue };
}
