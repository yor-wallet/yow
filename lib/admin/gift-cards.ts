import 'server-only';
import type { GiftCardStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { GIFT_CARD_CURRENCIES, type GiftCardCurrency } from '@/lib/payments/giftcards';

/**
 * Admin view of gift cards sent by customers (metadata only). The card code and the photo are opened
 * through audited accessors (`revealGiftCardCode`, `getGiftCardImage`); the decision goes through
 * `reviewGiftCard`, which credits the wallet (value actually encashed, minus the exchange commission).
 */
export const GIFT_CARD_ADMIN_TABS: readonly GiftCardStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED', 'REJECTED'];

export async function giftCardCounts(): Promise<Record<string, number>> {
  const rows = await prisma.giftCardSubmission.groupBy({ by: ['status'], _count: { _all: true } });
  return Object.fromEntries(rows.map((r) => [r.status, r._count._all]));
}

export async function listGiftCardsForAdmin(status: GiftCardStatus, take = 100) {
  return prisma.giftCardSubmission.findMany({
    where: { status },
    // Open cards: oldest first (first in, first served). Decided cards: latest decision first.
    orderBy: status === 'SUBMITTED' || status === 'UNDER_REVIEW' ? { createdAt: 'asc' } : { updatedAt: 'desc' },
    take: Math.min(take, 200),
    select: {
      id: true,
      brand: true,
      codeLast4: true,
      declaredValue: true,
      declaredCurrency: true,
      status: true,
      encashedValueBaisa: true,
      createdAt: true,
      user: { select: { fullName: true, email: true } },
    },
  });
}

export async function getGiftCardForAdmin(id: string) {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
  const card = await prisma.giftCardSubmission.findUnique({
    where: { id },
    select: {
      id: true,
      brand: true,
      codeLast4: true,
      declaredValue: true,
      declaredCurrency: true,
      imageKey: true,
      status: true,
      encashedValueBaisa: true,
      notes: true,
      createdAt: true,
      reviewedAt: true,
      reviewedBy: { select: { fullName: true } },
      paymentIntent: { select: { id: true, metadata: true } },
      user: { select: { id: true, fullName: true, email: true, phone: true, kycStatus: true, createdAt: true } },
    },
  });
  if (!card) return null;
  const { imageKey, paymentIntent, ...rest } = card;
  const meta = (paymentIntent?.metadata ?? null) as { commissionBaisa?: unknown; feeBps?: unknown } | null;
  const commissionBaisa = Number(meta?.commissionBaisa);
  const feeBps = Number(meta?.feeBps);
  return {
    ...rest,
    hasImage: !!imageKey,
    /** Commission kept when the card was verified (null before a decision). */
    commissionBaisa: paymentIntent && Number.isSafeInteger(commissionBaisa) ? commissionBaisa : null,
    feeBpsApplied: paymentIntent && Number.isSafeInteger(feeBps) ? feeBps : null,
  };
}

/** `2550` USD minor units → `25.50 USD`; OMR has 3 decimals. Plain Latin digits (an amount printed on a card). */
export function formatDeclaredValue(minor: number, currency: string): string {
  const decimals = GIFT_CARD_CURRENCIES[currency as GiftCardCurrency] ?? 2;
  const s = String(Math.abs(Math.trunc(minor))).padStart(decimals + 1, '0');
  return `${s.slice(0, s.length - decimals)}.${s.slice(s.length - decimals)} ${currency}`;
}
