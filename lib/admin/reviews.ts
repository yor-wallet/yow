import type { Prisma, ReviewStatus } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { idSchema } from '@/lib/validation';
import { NotFoundError } from './actor';
import { defineMutation } from './mutation';
import { enumParam, parseTableQuery, type SearchParams } from './table';

/**
 * Review moderation. A customer review is stored PENDING (verified purchase only) and becomes
 * visible only when a staff member publishes it here; every decision is audited.
 */

export const REVIEW_STATUSES = ['PENDING', 'PUBLISHED', 'REJECTED'] as const satisfies readonly ReviewStatus[];

export type AdminReviewRow = {
  id: string;
  status: ReviewStatus;
  rating: number;
  title: string | null;
  text: string;
  locale: string;
  createdAt: Date;
  moderatedAt: Date | null;
  authorName: string;
  authorEmail: string;
  productId: string;
  productName: unknown;
  productSku: string;
  productSlug: string;
};

/** Reviews for the moderation queue. Defaults to the PENDING ones, oldest first (work queue). */
export async function listAdminReviews(sp: SearchParams) {
  const t = parseTableQuery(sp, { sortable: ['createdAt'] as const, defaultSort: 'createdAt', defaultDir: 'asc' });
  const statusParam = enumParam(sp, 'status', [...REVIEW_STATUSES, 'ALL'] as const);
  const status: ReviewStatus | null = statusParam === 'ALL' ? null : (statusParam ?? 'PENDING');
  const where: Prisma.ReviewWhereInput = {
    ...(status ? { status } : {}),
    ...(t.q
      ? {
          OR: [
            { text: { contains: t.q, mode: 'insensitive' } },
            { title: { contains: t.q, mode: 'insensitive' } },
            { product: { sku: { contains: t.q, mode: 'insensitive' } } },
            { user: { email: { contains: t.q, mode: 'insensitive' } } },
          ],
        }
      : {}),
  };
  const [total, pending, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.count({ where: { status: 'PENDING' } }),
    prisma.review.findMany({
      where,
      orderBy: [{ createdAt: t.dir }, { id: 'asc' }],
      skip: t.skip,
      take: t.take,
      select: {
        id: true,
        status: true,
        rating: true,
        title: true,
        text: true,
        locale: true,
        createdAt: true,
        moderatedAt: true,
        user: { select: { fullName: true, email: true } },
        product: { select: { id: true, name: true, sku: true, slug: true } },
      },
    }),
  ]);
  const items: AdminReviewRow[] = rows.map((r) => ({
    id: r.id,
    status: r.status,
    rating: r.rating,
    title: r.title,
    text: r.text,
    locale: r.locale,
    createdAt: r.createdAt,
    moderatedAt: r.moderatedAt,
    authorName: r.user.fullName,
    authorEmail: r.user.email,
    productId: r.product.id,
    productName: r.product.name,
    productSku: r.product.sku,
    productSlug: r.product.slug,
  }));
  return { items, total, pending, query: t, status };
}

/** Publish or reject a review (also used to take a published review down again). */
export const moderateReview = defineMutation({
  name: 'review.moderate',
  permission: 'reviews:moderate',
  schema: z.object({ id: idSchema, decision: z.enum(['PUBLISHED', 'REJECTED']) }),
  async run({ tx, input, actor, audit }) {
    const before = await tx.review.findUnique({ where: { id: input.id }, select: { status: true, productId: true } });
    if (!before) throw new NotFoundError('Review');
    if (before.status === input.decision) return { id: input.id, productId: before.productId };
    await tx.review.update({ where: { id: input.id }, data: { status: input.decision, moderatedById: actor.id, moderatedAt: new Date() } });
    await audit({ action: input.decision === 'PUBLISHED' ? 'review.publish' : 'review.reject', entity: 'Review', entityId: input.id, before: { status: before.status }, after: { status: input.decision } });
    return { id: input.id, productId: before.productId };
  },
});
