/**
 * Storefront data layer against PostgreSQL (TEST_DATABASE_URL → doom_test): listings, filters, search,
 * favourites and the cart. Creates its own products (all names/SKUs carry RUN) and removes them afterwards,
 * so the "seed contains no product" guarantee checked in db.test.ts still holds.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { createUser } from '@/lib/auth/service';
import { sha256Hex } from '@/lib/crypto';
import { addItem, cartCount, cartItems, mergeAnonymousCart, pruneUnavailable, removeItem, setItemQty } from '@/lib/cart/store';
import { priceCart, priceItems } from '@/lib/cart/pricing';
import { favoriteIdsFor, listFavoriteCards, toggleFavorite } from '@/lib/catalog/favorites';
import { DEFAULT_FILTERS } from '@/lib/catalog/filters';
import { loadListing } from '@/lib/catalog/page-data';
import { getCategoryBySlug } from '@/lib/catalog/queries';
import { parseSearchQuery } from '@/lib/catalog/search-query';

const RUN = `sf${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
const L = (en: string, ar = en, fr = en) => ({ en, ar, fr });

type Fixture = { userId: string; catSlug: string; products: Record<string, { id: string; variantId: string; slug: string }>; unpricedVariantId: string };
let fx: Fixture;
let anonHash: string;

async function product(key: string, o: { sub: string; brand: string; name: ReturnType<typeof L>; price: number | null; stock: number; capacity?: string; color?: string; status?: 'ACTIVE' | 'DRAFT' }) {
  const category = await prisma.category.findFirstOrThrow({ where: { slug: o.sub } });
  const brand = await prisma.brand.findFirstOrThrow({ where: { slug: o.brand } });
  const slug = `${RUN}-${key}`;
  const p = await prisma.product.create({
    data: {
      slug,
      sku: `${RUN}-${key}`.toUpperCase(),
      categoryId: category.id,
      brandId: brand.id,
      name: o.name,
      status: o.status ?? 'ACTIVE',
      publishedAt: new Date(),
      variants: { create: [{ sku: `${RUN}-${key}-V`.toUpperCase(), priceBaisa: o.price, stock: o.stock, capacity: o.capacity, color: o.color, isDefault: true }] },
    },
    include: { variants: true },
  });
  return { id: p.id, variantId: p.variants[0]!.id, slug };
}

beforeAll(async () => {
  const created = await createUser({ fullName: 'Storefront Test', email: `${RUN}@test.doom.local`, phone: `9${String(Date.now() % 10_000_000).padStart(7, '0')}`, password: 'Password1234', confirmPassword: 'Password1234', acceptTerms: true, locale: 'en' });
  if (!created.ok) throw new Error(`fixture user: ${created.error}`);
  anonHash = sha256Hex(`${RUN}-anonymous-cart-token`);
  fx = {
    userId: created.user.id,
    catSlug: 'smartphones',
    products: {
      cheap: await product('cheap', { sub: 'smartphones-apple', brand: 'apple', name: L(`${RUN} Alpha Phone`, `${RUN} هاتف ألفا أبل`, `${RUN} Alpha Phone`), price: 100_000, stock: 5, capacity: '128GB', color: 'Black' }),
      pricey: await product('pricey', { sub: 'smartphones-apple', brand: 'apple', name: L(`${RUN} Beta Phone`), price: 300_000, stock: 2, capacity: '512GB', color: 'Silver' }),
      gone: await product('gone', { sub: 'smartphones-samsung', brand: 'samsung', name: L(`${RUN} Gamma Phone`), price: 200_000, stock: 0, capacity: '256GB', color: 'Black' }),
      draft: await product('draft', { sub: 'smartphones-apple', brand: 'apple', name: L(`${RUN} Draft Phone`), price: 150_000, stock: 9, status: 'DRAFT' }),
    },
    unpricedVariantId: '',
  };
  const unpriced = await product('noprice', { sub: 'smartphones-samsung', brand: 'samsung', name: L(`${RUN} Unpriced Phone`), price: null, stock: 4 });
  fx.products.noprice = unpriced;
  fx.unpricedVariantId = unpriced.variantId;
});

afterAll(async () => {
  const productIds = Object.values(fx?.products ?? {}).map((p) => p.id);
  await prisma.cart.deleteMany({ where: { OR: [{ userId: fx?.userId }, { anonTokenHash: anonHash }] } });
  await prisma.favorite.deleteMany({ where: { OR: [{ userId: fx?.userId }, { productId: { in: productIds } }] } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.auditLog.deleteMany({ where: { actorId: fx?.userId } });
  await prisma.user.deleteMany({ where: { email: { startsWith: RUN } } });
  await prisma.$disconnect();
});

const names = (r: { list: { items: { name: string }[] } }) => r.list.items.map((i) => i.name.replace(`${RUN} `, '')).sort();

describe('category / search listings', () => {
  const scoped = async (filters = {}, extra: Partial<Parameters<typeof loadListing>[0]> = {}) => {
    const category = await getCategoryBySlug(fx.catSlug, 'en');
    expect(category).not.toBeNull();
    // Everything of this run lives under "smartphones"; the RUN token isolates it from any other data.
    return loadListing({ locale: 'en', scope: { kind: 'search', query: parseSearchQuery(RUN) }, filters: { ...DEFAULT_FILTERS, ...filters }, limit: 24, ...extra });
  };

  it('lists only ACTIVE products and never leaks drafts', async () => {
    const r = await scoped();
    expect(names(r)).toEqual(['Alpha Phone', 'Beta Phone', 'Gamma Phone', 'Unpriced Phone']);
    expect(r.list.total).toBe(4);
  });

  it('reports real availability: priced + stocked, out of stock, and no price', async () => {
    const r = await scoped();
    const by = (n: string) => r.list.items.find((i) => i.name.endsWith(n))!;
    expect(by('Alpha Phone')).toMatchObject({ priceBaisa: 100_000, availability: 'in_stock', quickAddVariantId: fx.products.cheap!.variantId });
    expect(by('Beta Phone').availability).toBe('low_stock');
    expect(by('Gamma Phone')).toMatchObject({ availability: 'out_of_stock', quickAddVariantId: null });
    expect(by('Unpriced Phone')).toMatchObject({ priceBaisa: null, availability: 'unavailable' });
  });

  it('filters by brand, price range (whole OMR), capacity, colour and stock', async () => {
    expect(names(await scoped({ brands: ['apple'] }))).toEqual(['Alpha Phone', 'Beta Phone']);
    expect(names(await scoped({ minOmr: 150, maxOmr: 250 }))).toEqual(['Gamma Phone']);
    expect(names(await scoped({ maxOmr: 100 }))).toEqual(['Alpha Phone']);
    expect(names(await scoped({ capacities: ['512GB'] }))).toEqual(['Beta Phone']);
    expect(names(await scoped({ colors: ['Black'] }))).toEqual(['Alpha Phone', 'Gamma Phone']);
    expect(names(await scoped({ inStock: true }))).toEqual(['Alpha Phone', 'Beta Phone']);
  });

  it('sorts by price and paginates with a keyset cursor without gaps or repeats', async () => {
    const asc = await scoped({ sort: 'price_asc' }, { limit: 3 });
    expect(asc.list.items.map((i) => i.priceBaisa)).toEqual([100_000, 200_000, 300_000]);
    expect(asc.list.nextCursor).not.toBeNull();
    const next = await scoped({ sort: 'price_asc' }, { limit: 3, cursor: asc.list.nextCursor });
    expect(next.list.items.map((i) => i.priceBaisa)).toEqual([null]);
    expect(next.list.nextCursor).toBeNull();
    const desc = await scoped({ sort: 'price_desc' });
    expect(desc.list.items[0]!.priceBaisa).toBe(300_000);
  });

  it('exposes facets built from real data only', async () => {
    const { facets } = await scoped();
    expect(facets!.brands.map((b) => b.slug).sort()).toEqual(['apple', 'samsung']);
    expect(facets!.capacities.map((c) => c.value).sort()).toEqual(['128GB', '256GB', '512GB']);
    expect(facets!.priceMinOmr).toBe(100);
    expect(facets!.priceMaxOmr).toBe(300);
  });

  it('searches Arabic names ignoring hamza and diacritics, and SKUs', async () => {
    const ar = await loadListing({ locale: 'ar', scope: { kind: 'search', query: parseSearchQuery(`${RUN} ابل`) }, filters: DEFAULT_FILTERS, limit: 24 });
    // "ابل" (no hamza) matches Alpha through its Arabic NAME ("أبل") and Beta through the brand's Arabic name; Samsung does not match.
    expect(ar.list.items.map((i) => i.slug).sort()).toEqual([fx.products.cheap!.slug, fx.products.pricey!.slug].sort());
    const sku = await loadListing({ locale: 'en', scope: { kind: 'search', query: parseSearchQuery(`${RUN}-beta`.replace('beta', 'pricey-v')) }, filters: DEFAULT_FILTERS, limit: 24 });
    expect(sku.list.items.map((i) => i.slug)).toEqual([fx.products.pricey!.slug]);
    const none = await loadListing({ locale: 'en', scope: { kind: 'search', query: parseSearchQuery(`${RUN} nothing-matches-this`) }, filters: DEFAULT_FILTERS, limit: 24 });
    expect(none.list).toMatchObject({ items: [], total: 0, nextCursor: null });
  });

  it('scopes a category listing to the category tree', async () => {
    const category = await getCategoryBySlug('smartphones', 'en');
    const r = await loadListing({ locale: 'en', scope: { kind: 'category', category: category! }, filters: { ...DEFAULT_FILTERS, brands: ['apple'] }, limit: 240 });
    const mine = r.list.items.filter((i) => i.name.startsWith(RUN));
    expect(mine.map((i) => i.name.replace(`${RUN} `, '')).sort()).toEqual(['Alpha Phone', 'Beta Phone']);
    const sub = await loadListing({ locale: 'en', scope: { kind: 'category', category: category! }, filters: { ...DEFAULT_FILTERS, sub: 'smartphones-samsung' }, limit: 240 });
    expect(sub.list.items.filter((i) => i.name.startsWith(RUN)).map((i) => i.name.replace(`${RUN} `, '')).sort()).toEqual(['Gamma Phone', 'Unpriced Phone']);
  });
});

describe('favourites', () => {
  it('toggles on and off and reports the state per product', async () => {
    const { id } = fx.products.cheap!;
    expect(await toggleFavorite(fx.userId, id)).toEqual({ ok: true, favorited: true });
    expect([...(await favoriteIdsFor(fx.userId, [id, fx.products.pricey!.id]))]).toEqual([id]);
    expect(await toggleFavorite(fx.userId, id)).toEqual({ ok: true, favorited: false });
    expect((await favoriteIdsFor(fx.userId, [id])).size).toBe(0);
  });

  it('refuses unknown or inactive products and treats visitors as having none', async () => {
    expect(await toggleFavorite(fx.userId, fx.products.draft!.id)).toEqual({ ok: false, error: 'not_found' });
    expect(await toggleFavorite(fx.userId, 'does-not-exist')).toEqual({ ok: false, error: 'not_found' });
    expect((await favoriteIdsFor(null, [fx.products.cheap!.id])).size).toBe(0);
  });

  it('lists favourites newest first and hides products that are no longer ACTIVE', async () => {
    await toggleFavorite(fx.userId, fx.products.cheap!.id);
    await new Promise((r) => setTimeout(r, 15));
    await toggleFavorite(fx.userId, fx.products.pricey!.id);
    expect((await listFavoriteCards(fx.userId, 'en')).map((c) => c.slug)).toEqual([fx.products.pricey!.slug, fx.products.cheap!.slug]);
    await prisma.product.update({ where: { id: fx.products.pricey!.id }, data: { status: 'ARCHIVED' } });
    expect((await listFavoriteCards(fx.userId, 'en')).map((c) => c.slug)).toEqual([fx.products.cheap!.slug]);
    await prisma.product.update({ where: { id: fx.products.pricey!.id }, data: { status: 'ACTIVE' } });
  });
});

describe('cart', () => {
  const owner = () => ({ userId: fx.userId });

  it('adds, merges and caps quantities by real stock', async () => {
    const { variantId } = fx.products.pricey!; // stock 2
    expect(await addItem(owner(), variantId, 1)).toEqual({ ok: true, qty: 1, capped: false });
    expect(await addItem(owner(), variantId, 5)).toEqual({ ok: true, qty: 2, capped: true });
    expect(await cartCount(owner())).toBe(2);
  });

  it('rejects out-of-stock, unpriced and invalid additions', async () => {
    expect(await addItem(owner(), fx.products.gone!.variantId, 1)).toEqual({ ok: false, error: 'out_of_stock' });
    expect(await addItem(owner(), fx.unpricedVariantId, 1)).toEqual({ ok: false, error: 'unavailable' });
    expect(await addItem(owner(), fx.products.draft!.variantId, 1)).toEqual({ ok: false, error: 'unavailable' });
    expect(await addItem(owner(), 'nope', 1)).toEqual({ ok: false, error: 'not_found' });
    for (const qty of [0, -1, 11, 1.5]) expect(await addItem(owner(), fx.products.cheap!.variantId, qty)).toEqual({ ok: false, error: 'invalid_qty' });
  });

  it('updates and removes lines', async () => {
    await addItem(owner(), fx.products.cheap!.variantId, 2);
    const items = await cartItems(owner());
    const line = items.find((i) => i.variantId === fx.products.cheap!.variantId)!;
    expect(await setItemQty(owner(), line.id, 4)).toEqual({ ok: true, qty: 4, capped: false });
    expect(await setItemQty(owner(), line.id, 50)).toEqual({ ok: true, qty: 5, capped: true });
    expect(await setItemQty(owner(), 'missing', 1)).toEqual({ ok: false, error: 'not_found' });
    expect(await removeItem(owner(), line.id)).toBe(true);
    expect((await cartItems(owner())).some((i) => i.id === line.id)).toBe(false);
  });

  it('prices lines from CURRENT data and flags unsellable ones (checkout blocked)', async () => {
    // Put an out-of-stock and an unpriced line straight in the cart (the store would refuse them).
    const cart = await prisma.cart.findUniqueOrThrow({ where: { userId: fx.userId }, select: { id: true } });
    await prisma.cartItem.createMany({
      data: [
        { cartId: cart.id, variantId: fx.products.gone!.variantId, qty: 1 },
        { cartId: cart.id, variantId: fx.unpricedVariantId, qty: 1 },
      ],
    });
    const lines = await priceItems(await cartItems(owner()), 'en');
    const priced = priceCart(lines, []);
    const state = (v: string) => priced.lines.find((l) => l.variantId === v)!.state;
    expect(state(fx.products.pricey!.variantId)).toBe('ok');
    expect(state(fx.products.gone!.variantId)).toBe('out_of_stock');
    expect(state(fx.unpricedVariantId)).toBe('unavailable');
    expect(priced.totals.checkoutReady).toBe(false);
    // Only purchasable lines are charged: 2 × 300.000.
    expect(priced.totals.subtotalBaisa).toBe(600_000);
    expect(priced.totals.totalBaisa).toBe(600_000);

    expect(await pruneUnavailable(owner())).toBe(2);
    const after = priceCart(await priceItems(await cartItems(owner()), 'en'), []);
    expect(after.totals.checkoutReady).toBe(true);
  });

  it('merges the visitor cart into the account cart when signing in (quantities capped)', async () => {
    const token = `${RUN}-anonymous-cart-token`;
    const anon = { anonTokenHash: sha256Hex(token) };
    await addItem(anon, fx.products.pricey!.variantId, 1);
    await addItem(anon, fx.products.cheap!.variantId, 2);
    const res = await mergeAnonymousCart(fx.userId, token);
    expect(res.merged).toBeGreaterThanOrEqual(1);
    const mine = await cartItems(owner());
    // pricey: 2 (account) + 1 (visitor) is capped at the real stock of 2.
    expect(mine.find((i) => i.variantId === fx.products.pricey!.variantId)!.qty).toBe(2);
    expect(mine.find((i) => i.variantId === fx.products.cheap!.variantId)!.qty).toBe(2);
    expect(await cartCount(anon)).toBe(0);
  });
});
