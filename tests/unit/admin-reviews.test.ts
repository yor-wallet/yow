/**
 * Review moderation against PostgreSQL (doom_test): RBAC, publish / reject / take down, audit rows,
 * and visibility on the storefront only after publication.
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { ForbiddenError, type Actor } from '@/lib/admin/actor';
import { listAdminReviews, moderateReview } from '@/lib/admin/reviews';
import { getProductReviews } from '@/lib/catalog/queries';
import { submitReview } from '@/lib/catalog/reviews';
import { placeOrder } from '@/lib/orders';
import { addToUserCart, cleanup, createAddress, createDeliveryArea, createProduct, createUser } from './shop/fixtures';

let area: Awaited<ReturnType<typeof createDeliveryArea>>;
let moderator: Actor;
let logistics: Actor;

async function staff(role: Actor['role']): Promise<Actor> {
  const u = await createUser();
  await prisma.user.update({ where: { id: u.id }, data: { role } });
  return { id: u.id, role };
}

/** A pending review from a buyer whose order was delivered. */
async function pendingReview() {
  const user = await createUser();
  const address = await createAddress(user.id, area);
  const product = await createProduct({ variants: [{ priceBaisa: 40_000, stock: 5 }] });
  await addToUserCart(user.id, product.variants[0]!.id, 1);
  const order = await placeOrder({ userId: user.id, idempotencyKey: randomUUID().replace(/-/g, ''), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'WALLET', locale: 'en' });
  await prisma.order.update({ where: { id: order.orderId }, data: { status: 'DELIVERED' } });
  const res = await submitReview(user.id, product.id, { rating: 4, text: 'Solid phone, arrived on time.' }, 'en');
  if (!res.ok) throw new Error('review fixture failed');
  return { reviewId: res.id, product, user };
}

beforeAll(async () => {
  area = await createDeliveryArea();
  moderator = await staff('SUPPORT');
  logistics = await staff('LOGISTICS');
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe('moderateReview', () => {
  it('is refused without the reviews:moderate permission', async () => {
    const { reviewId } = await pendingReview();
    for (const actor of [logistics, { id: 'x', role: 'CUSTOMER' as const }, null, undefined]) {
      await expect(moderateReview(actor as Actor, { id: reviewId, decision: 'PUBLISHED' })).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect((await prisma.review.findUniqueOrThrow({ where: { id: reviewId } })).status).toBe('PENDING');
  });

  it('publishes a review: it becomes visible, counts in the rating and is audited', async () => {
    const { reviewId, product } = await pendingReview();
    expect((await getProductReviews(product.id)).count).toBe(0);

    await moderateReview(moderator, { id: reviewId, decision: 'PUBLISHED' });

    const row = await prisma.review.findUniqueOrThrow({ where: { id: reviewId } });
    expect(row.status).toBe('PUBLISHED');
    expect(row.moderatedById).toBe(moderator.id);
    expect(row.moderatedAt).toBeInstanceOf(Date);
    const visible = await getProductReviews(product.id);
    expect(visible.count).toBe(1);
    expect(visible.average).toBe(4);
    expect(await prisma.auditLog.count({ where: { actorId: moderator.id, action: 'review.publish', entityId: reviewId } })).toBe(1);
  });

  it('rejects a review and can take a published one down again', async () => {
    const a = await pendingReview();
    await moderateReview(moderator, { id: a.reviewId, decision: 'REJECTED' });
    expect((await getProductReviews(a.product.id)).count).toBe(0);

    const b = await pendingReview();
    await moderateReview(moderator, { id: b.reviewId, decision: 'PUBLISHED' });
    await moderateReview(moderator, { id: b.reviewId, decision: 'REJECTED' });
    expect((await prisma.review.findUniqueOrThrow({ where: { id: b.reviewId } })).status).toBe('REJECTED');
    expect((await getProductReviews(b.product.id)).count).toBe(0);
    expect(await prisma.auditLog.count({ where: { actorId: moderator.id, entityId: b.reviewId } })).toBe(2);
  });

  it('is a no-op (no second audit row) when the decision is already applied, and rejects bad input', async () => {
    const { reviewId } = await pendingReview();
    await moderateReview(moderator, { id: reviewId, decision: 'PUBLISHED' });
    await moderateReview(moderator, { id: reviewId, decision: 'PUBLISHED' });
    expect(await prisma.auditLog.count({ where: { actorId: moderator.id, entityId: reviewId } })).toBe(1);
    await expect(moderateReview(moderator, { id: reviewId, decision: 'PENDING' as never })).rejects.toThrow();
    await expect(moderateReview(moderator, { id: 'missing-review-id', decision: 'PUBLISHED' })).rejects.toThrow();
  });
});

describe('listAdminReviews', () => {
  it('defaults to the pending queue and filters by status', async () => {
    const { reviewId, product } = await pendingReview();
    const pending = await listAdminReviews({ q: product.sku });
    expect(pending.status).toBe('PENDING');
    expect(pending.items.map((r) => r.id)).toEqual([reviewId]);

    await moderateReview(moderator, { id: reviewId, decision: 'PUBLISHED' });
    expect((await listAdminReviews({ q: product.sku })).items).toHaveLength(0);
    expect((await listAdminReviews({ q: product.sku, status: 'PUBLISHED' })).items.map((r) => r.id)).toEqual([reviewId]);
    expect((await listAdminReviews({ q: product.sku, status: 'ALL' })).items).toHaveLength(1);
  });
});
