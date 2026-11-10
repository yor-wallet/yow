import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { Locale } from '@/i18n/routing';

/**
 * Review submission. A review exists only for a delivered order item of its author (verified
 * purchase, one review per item — enforced by the unique index on `orderItemId`). It is stored
 * PENDING and is shown only after a staff member publishes it; nothing is ever auto-published.
 */

export const reviewInputSchema = z.object({
  rating: z.number().int().min(1).max(5),
  title: z
    .string()
    .trim()
    .max(80)
    .optional()
    .transform((v) => (v ? v : undefined)),
  text: z.string().trim().min(10).max(2000),
});

export type ReviewInput = z.input<typeof reviewInputSchema>;
export type SubmitReviewResult = { ok: true; id: string } | { ok: false; error: 'invalid' | 'not_eligible' };

export async function submitReview(userId: string, productId: string, input: ReviewInput, locale: Locale): Promise<SubmitReviewResult> {
  const parsed = reviewInputSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'invalid' };
  const item = await prisma.orderItem.findFirst({
    where: { productId, review: null, order: { userId, status: 'DELIVERED' } },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  if (!item) return { ok: false, error: 'not_eligible' };
  try {
    const review = await prisma.review.create({
      data: { productId, userId, orderItemId: item.id, rating: parsed.data.rating, title: parsed.data.title ?? null, text: parsed.data.text, locale, status: 'PENDING' },
      select: { id: true },
    });
    return { ok: true, id: review.id };
  } catch (err) {
    // Two submissions raced for the same order item: the unique index kept exactly one.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') return { ok: false, error: 'not_eligible' };
    throw err;
  }
}
