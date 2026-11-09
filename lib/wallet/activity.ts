import type { GiftCardStatus, PaymentProvider, PaymentStatus } from '@prisma/client';
import { prisma, type Db } from '@/lib/db';

/**
 * Non-ledger wallet activity: top-ups that are still pending or were rejected/failed, and
 * gift-card submissions awaiting verification or rejected. Confirmed movements come from
 * the ledger (`getHistory`). Together they give the customer clear statuses:
 * pending / confirmed / rejected.
 */

export type ActivityStatus = 'pending' | 'rejected';

export type ActivityItem =
  | {
      kind: 'topup';
      id: string;
      status: ActivityStatus;
      rawStatus: PaymentStatus;
      provider: PaymentProvider;
      amountBaisa: number;
      createdAt: Date;
      failureCode: string | null;
    }
  | {
      kind: 'giftcard';
      id: string;
      status: ActivityStatus;
      rawStatus: GiftCardStatus;
      brand: string;
      codeLast4: string | null;
      declaredValue: number;
      declaredCurrency: string;
      createdAt: Date;
    };

const PENDING_INTENT: PaymentStatus[] = ['CREATED', 'PENDING', 'REQUIRES_ACTION'];
const REJECTED_INTENT: PaymentStatus[] = ['FAILED', 'CANCELLED', 'EXPIRED'];

export async function getWalletActivity(
  userId: string,
  status: ActivityStatus,
  opts: { limit?: number } = {},
  db: Db = prisma,
): Promise<ActivityItem[]> {
  const limit = Math.min(Math.max(opts.limit ?? 30, 1), 100);
  const [intents, cards] = await Promise.all([
    db.paymentIntent.findMany({
      where: {
        userId,
        purpose: 'TOPUP',
        provider: { not: 'GIFT_CARD' },
        status: { in: status === 'pending' ? PENDING_INTENT : REJECTED_INTENT },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, status: true, provider: true, amountBaisa: true, createdAt: true, failureCode: true },
    }),
    db.giftCardSubmission.findMany({
      where: { userId, status: { in: status === 'pending' ? ['SUBMITTED', 'UNDER_REVIEW'] : ['REJECTED'] } },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        status: true,
        brand: true,
        codeLast4: true,
        declaredValue: true,
        declaredCurrency: true,
        createdAt: true,
      },
    }),
  ]);
  const items: ActivityItem[] = [
    ...intents.map((i) => ({
      kind: 'topup' as const,
      id: i.id,
      status,
      rawStatus: i.status,
      provider: i.provider,
      amountBaisa: i.amountBaisa,
      createdAt: i.createdAt,
      failureCode: i.failureCode,
    })),
    ...cards.map((c) => ({
      kind: 'giftcard' as const,
      id: c.id,
      status,
      rawStatus: c.status,
      brand: c.brand,
      codeLast4: c.codeLast4,
      declaredValue: c.declaredValue,
      declaredCurrency: c.declaredCurrency,
      createdAt: c.createdAt,
    })),
  ];
  return items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, limit);
}
