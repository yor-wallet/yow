/**
 * Photos follow the colour (owner's specification §4): pure selection rules, then the cart line
 * thumbnail and the product page data against PostgreSQL (doom_test).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { imagesForVariant, thumbnailForVariant } from '@/lib/catalog/images';
import { getProductDetail } from '@/lib/catalog/queries';
import { priceItems } from '@/lib/cart/pricing';
import { cleanup, createProduct } from './shop/fixtures';

const img = (id: string, variantId: string | null, color: string | null) => ({ id, variantId, color });

describe('imagesForVariant (pure)', () => {
  const blue256 = { id: 'v-blue-256', color: 'Blue' };
  const blue512 = { id: 'v-blue-512', color: 'Blue' };
  const black = { id: 'v-black', color: 'Black' };
  const images = [img('black-1', 'v-black', 'Black'), img('box', null, null), img('blue-1', 'v-blue-256', 'Blue'), img('blue-2', 'v-blue-256', 'blue ')];

  it('shows the photos of the selected colour first (shared by its capacities), then general photos, never another colour', () => {
    expect(imagesForVariant(images, blue256).images.map((i) => i.id)).toEqual(['blue-1', 'blue-2', 'box']);
    expect(imagesForVariant(images, blue512).images.map((i) => i.id)).toEqual(['blue-1', 'blue-2', 'box']);
    expect(imagesForVariant(images, black).images.map((i) => i.id)).toEqual(['black-1', 'box']);
  });

  it('reports a colour without any photo instead of borrowing one', () => {
    const onlyColour = images.filter((i) => i.variantId !== null);
    const green = { id: 'v-green', color: 'Green' };
    expect(imagesForVariant(onlyColour, green)).toEqual({ images: [], missingForColour: true });
    expect(thumbnailForVariant(onlyColour, green)).toBeNull();
    // With a general photo the selection still has something truthful to show.
    expect(imagesForVariant(images, green)).toMatchObject({ missingForColour: false });
    expect(thumbnailForVariant(images, green)?.id).toBe('box');
    // A product without any photo is not a "missing colour": the gallery simply has nothing.
    expect(imagesForVariant([], green)).toEqual({ images: [], missingForColour: false });
  });

  it('keeps every photo when nothing is selected or the variant has no colour', () => {
    expect(imagesForVariant(images, null).images).toHaveLength(4);
    expect(imagesForVariant(images, { id: 'v-x', color: null }).images).toHaveLength(4);
    // A photo attached to exactly this variant counts even without a colour name.
    expect(thumbnailForVariant([img('own', 'v-x', null)], { id: 'v-x', color: '' })?.id).toBe('own');
  });
});

describe('cart thumbnail and product page (PostgreSQL)', () => {
  let slug: string;
  let v: { id: string; color: string | null; capacity: string | null }[];

  beforeAll(async () => {
    const p = await createProduct({
      variants: [
        { priceBaisa: 300_000, stock: 5, color: 'Blue', colorHex: '#3355aa', capacity: '256 GB' },
        { priceBaisa: 350_000, stock: 5, color: 'Blue', colorHex: '#3355aa', capacity: '512 GB' },
        { priceBaisa: 300_000, stock: 5, color: 'Black', colorHex: '#111111', capacity: '256 GB' },
      ],
    });
    slug = p.slug;
    v = p.variants.map((x) => ({ id: x.id, color: x.color, capacity: x.capacity }));
    // One photo for Blue only, attached to its first capacity (what the pack import does).
    await prisma.productImage.create({ data: { productId: p.id, variantId: v[0]!.id, key: 'products/test/blue.webp', width: 600, height: 600, alt: { ar: 'صورة', en: 'Blue', fr: 'Bleu' }, sort: 0 } });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it('a cart line shows the photo of its colour for every capacity, and no photo for a colour without one', async () => {
    const lines = await priceItems(v.map((x) => ({ id: null, variantId: x.id, qty: 1 })), 'en');
    const byVariant = new Map(lines.map((l) => [l.variantId, l.imageKey]));
    expect(byVariant.get(v[0]!.id)).toBe('products/test/blue.webp');
    expect(byVariant.get(v[1]!.id)).toBe('products/test/blue.webp'); // Blue 512 GB: same finish, same photo
    expect(byVariant.get(v[2]!.id)).toBeNull(); // Black: no photo yet, never the blue one
  });

  it('the product page receives the colour of each photo', async () => {
    const detail = await getProductDetail(slug, 'ar');
    expect(detail?.images).toHaveLength(1);
    expect(detail!.images[0]).toMatchObject({ variantId: v[0]!.id, color: 'Blue', alt: 'صورة' });
    const black = detail!.variants.find((x) => x.color === 'Black')!;
    expect(imagesForVariant(detail!.images, black)).toEqual({ images: [], missingForColour: true });
    const blue512 = detail!.variants.find((x) => x.color === 'Blue' && x.capacity === '512 GB')!;
    expect(imagesForVariant(detail!.images, blue512).images).toHaveLength(1);
  });
});
