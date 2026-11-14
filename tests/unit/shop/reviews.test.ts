/**
 * Review submission against PostgreSQL (doom_test): verified purchase only, one review per
 * delivered order item, stored pending (never visible before moderation).
 */
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { placeOrder } from '@/lib/orders';
import { getProductReviews, hasPendingReview, reviewableOrderItem } from '@/lib/catalog/queries';
import { submitReview } from '@/lib/catalog/reviews';
import { addToUserCart, cleanup, createAddress, createDeliveryArea, createProduct, createUser } from './fixtures';

let area: Awaited<ReturnType<typeof createDeliveryArea>>;

beforeAll(async () => {
  area = await createDeliveryArea();
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

/** A buyer with one order of the product; `delivered` moves it to DELIVERED (as the courier flow does). */
async function buyer(delivered: boolean) {
  const user = await createUser();
  const address = await createAddress(user.id, area);
  const product = await createProduct({ variants: [{ priceBaisa: 50_000, stock: 5 }] });
  await addToUserCart(user.id, product.variants[0]!.id, 1);
  const order = await placeOrder({ userId: user.id, idempotencyKey: randomUUID().replace(/-/g, ''), addressId: address.id, deliveryType: 'STANDARD', paymentMethod: 'WALLET', locale: 'en' });
  if (delivered) await prisma.order.update({ where: { id: order.orderId }, data: { status: 'DELIVERED' } });
  return { user, product };
}

const good = { rating: 5, title: 'Great phone', text: 'Fast delivery and exactly as described.' };

describe('submitReview', () => {
  it('stores a pending review for a delivered purchase and keeps it out of the public list', async () => {
    const { user, product } = await buyer(true);
    expect(await reviewableOrderItem(user.id, product.id)).not.toBeNull();

    const res = await submitReview(user.id, product.id, good, 'en');
    expect(res.ok).toBe(true);

    const row = await prisma.review.findFirstOrThrow({ where: { userId: user.id, productId: product.id } });
    expect(row).toMatchObject({ rating: 5, title: 'Great phone', status: 'PENDING', locale: 'en' });
    expect(await hasPendingReview(user.id, product.id)).toBe(true);
    const visible = await getProductReviews(product.id);
    expect(visible.count).toBe(0);
    expect(visible.reviews).toHaveLength(0);
  });

  it('allows one review per purchased item', async () => {
    const { user, product } = await buyer(true);
    expect((await submitReview(user.id, product.id, good, 'ar')).ok).toBe(true);
    expect(await submitReview(user.id, product.id, good, 'ar')).toEqual({ ok: false, error: 'not_eligible' });
    expect(await prisma.review.count({ where: { userId: user.id, productId: product.id } })).toBe(1);
  });

  it('refuses a buyer whose order is not delivered, and a user who never bought the product', async () => {
    const { user, product } = await buyer(false);
    expect(await submitReview(user.id, product.id, good, 'en')).toEqual({ ok: false, error: 'not_eligible' });
    const stranger = await createUser();
    expect(await submitReview(stranger.id, product.id, good, 'en')).toEqual({ ok: false, error: 'not_eligible' });
    expect(await prisma.review.count({ where: { productId: product.id } })).toBe(0);
  });

  it('validates the rating and the text before touching the database', async () => {
    const { user, product } = await buyer(true);
    for (const bad of [
      { rating: 0, text: 'Long enough text here.' },
      { rating: 6, text: 'Long enough text here.' },
      { rating: 4.5, text: 'Long enough text here.' },
      { rating: 4, text: 'short' },
      { rating: 4, text: 'x'.repeat(2001) },
      { rating: 4, title: 't'.repeat(81), text: 'Long enough text here.' },
    ]) {
      expect(await submitReview(user.id, product.id, bad, 'en')).toEqual({ ok: false, error: 'invalid' });
    }
    expect(await prisma.review.count({ where: { productId: product.id } })).toBe(0);
  });

  it('trims the text and drops an empty title', async () => {
    const { user, product } = await buyer(true);
    await submitReview(user.id, product.id, { rating: 3, title: '   ', text: '   Works as expected, thanks.   ' }, 'en');
    const row = await prisma.review.findFirstOrThrow({ where: { userId: user.id, productId: product.id } });
    expect(row.title).toBeNull();
    expect(row.text).toBe('Works as expected, thanks.');
  });
});
