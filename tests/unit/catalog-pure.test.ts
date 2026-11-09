import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  DEFAULT_FILTERS,
  decodeCursor,
  encodeCursor,
  MAX_RESTORE,
  PAGE_SIZE,
  parseCatalogParams,
  serializeCatalogParams,
  toggleValue,
} from '@/lib/catalog/filters';
import { escapeLike, isEmptyQuery, normalizeSearchText, parseSearchQuery } from '@/lib/catalog/search-query';
import { availableQty, maxPurchasable, productAvailability, variantAvailability } from '@/lib/catalog/stock';
import { computeSchedule, flexMonthlyFrom } from '@/lib/catalog/flex-preview';
import { bestPromotion, discountFor, isPromotionLive, type PromotionRule } from '@/lib/catalog/promotions';
import { resolveCampaignHref } from '@/lib/catalog/campaigns';
import { categoryPath, productPath } from '@/lib/catalog/paths';

describe('catalog filters ⇄ URL', () => {
  it('parses an empty query to the defaults', () => {
    expect(parseCatalogParams(new URLSearchParams())).toEqual(DEFAULT_FILTERS);
  });

  it('parses every filter, de-duplicating and sorting list values', () => {
    const f = parseCatalogParams(new URLSearchParams('brand=samsung,apple,apple&min=100&max=500&cap=512GB&cap=256GB&color=Black&stock=1&sort=price_asc&sub=smartphones-apple'));
    expect(f.brands).toEqual(['apple', 'samsung']);
    expect(f.capacities).toEqual(['256GB', '512GB']);
    expect(f).toMatchObject({ minOmr: 100, maxOmr: 500, colors: ['Black'], inStock: true, sort: 'price_asc', sub: 'smartphones-apple' });
  });

  it('swaps an inverted price range and drops unsafe or malformed values', () => {
    const f = parseCatalogParams(new URLSearchParams('min=900&max=100&brand=<script>,ok-brand&sort=hack&sub=Not A Slug&cap=%27%3B--'));
    expect(f.minOmr).toBe(100);
    expect(f.maxOmr).toBe(900);
    expect(f.brands).toEqual(['ok-brand']);
    expect(f.sort).toBe('relevance');
    expect(f.sub).toBeNull();
    expect(f.capacities).toEqual([]);
    expect(parseCatalogParams(new URLSearchParams('min=-5&max=1e3')).minOmr).toBeNull();
  });

  it('restores "load more" in whole pages, capped', () => {
    expect(parseCatalogParams(new URLSearchParams('n=1')).n).toBe(PAGE_SIZE);
    expect(parseCatalogParams(new URLSearchParams('n=49')).n).toBe(72);
    expect(parseCatalogParams(new URLSearchParams('n=99999')).n).toBe(MAX_RESTORE);
    expect(parseCatalogParams(new URLSearchParams('n=abc')).n).toBe(PAGE_SIZE);
  });

  it('serialises without defaults and round-trips', () => {
    expect(serializeCatalogParams(DEFAULT_FILTERS).toString()).toBe('');
    const f = parseCatalogParams(new URLSearchParams('brand=apple&min=10&stock=1&sort=newest&n=48'));
    const sp = serializeCatalogParams(f, { q: 'iphone', keepN: true });
    expect(sp.get('q')).toBe('iphone');
    expect(parseCatalogParams(sp)).toEqual(f);
    // `n` is only kept when asked (filter changes always start again from the first page).
    expect(serializeCatalogParams(f).has('n')).toBe(false);
  });

  it('counts user-chosen filters and toggles values', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, brands: ['a', 'b'], minOmr: 1, inStock: true, sort: 'newest' })).toBe(4);
    expect(toggleValue(['b'], 'a')).toEqual(['a', 'b']);
    expect(toggleValue(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('keyset cursor', () => {
  it('round-trips and rejects anything that is not a cursor', () => {
    const c = { a: '12345678901234', id: 'ckabc123' };
    expect(decodeCursor(encodeCursor(c))).toEqual(c);
    for (const bad of [null, undefined, '', 'not base64!', 'e30', 'x'.repeat(300)]) expect(decodeCursor(bad as string)).toBeNull();
    const sql = encodeCursor({ a: "1; DROP TABLE x", id: 'ok' });
    expect(decodeCursor(sql)).toBeNull();
  });
});

describe('search query', () => {
  it('folds Arabic letters, diacritics and digits', () => {
    expect(normalizeSearchText('أَبْل إيفون ٢٥٦')).toBe('ابل ايفون 256');
    expect(normalizeSearchText('  Galaxy   S24  ')).toBe('galaxy s24');
  });

  it('keeps SKU-like tokens and drops punctuation', () => {
    expect(parseSearchQuery('SM-S928B, 1TB/16GB!').tokens).toEqual(['sm-s928b', '1tb/16gb']); // longest first, stable
    expect(parseSearchQuery('iphone iphone 15').tokens).toEqual(['iphone', '15']);
  });

  it('treats empty and non-string input as empty', () => {
    for (const v of ['', '   ', '%%%', undefined, null, 42]) expect(isEmptyQuery(parseSearchQuery(v))).toBe(true);
  });

  it('limits the number of tokens and escapes LIKE wildcards', () => {
    expect(parseSearchQuery('a1 b2 c3 d4 e5 f6 g7 h8').tokens).toHaveLength(6);
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});

describe('stock & availability', () => {
  const v = (over: Partial<Parameters<typeof variantAvailability>[0]> = {}) => ({ stock: 10, reserved: 0, lowStockThreshold: 2, priceBaisa: 1000, ...over });

  it('computes availability states', () => {
    expect(variantAvailability(v())).toBe('in_stock');
    expect(variantAvailability(v({ stock: 2 }))).toBe('low_stock');
    expect(variantAvailability(v({ stock: 3, reserved: 3 }))).toBe('out_of_stock');
    expect(availableQty(3, 5)).toBe(0);
  });

  it('is never sellable without a price, when inactive or when the product cannot be sold', () => {
    expect(variantAvailability(v({ priceBaisa: null }))).toBe('unavailable');
    expect(variantAvailability(v({ isActive: false }))).toBe('unavailable');
    expect(variantAvailability(v(), false)).toBe('unavailable');
  });

  it('aggregates variants and caps the purchasable quantity', () => {
    expect(productAvailability([v({ stock: 0 }), v({ stock: 2 })])).toBe('low_stock');
    expect(productAvailability([v({ priceBaisa: null })])).toBe('unavailable');
    expect(maxPurchasable(50, 0)).toBe(10);
    expect(maxPurchasable(4, 3)).toBe(1);
  });
});

describe('DOOM FLEX preview', () => {
  it('splits exactly (0% interest) with the last instalment absorbing the remainder', () => {
    expect(computeSchedule(360_000, 3).installments).toEqual([120_000, 120_000, 120_000]);
    expect(computeSchedule(360_000, 12).monthlyBaisa).toBe(30_000);
    const s = computeSchedule(100_001, 3);
    expect(s.installments).toEqual([33_333, 33_333, 33_335]);
    expect(s.installments.reduce((a, b) => a + b, 0)).toBe(100_001);
  });

  it('shows nothing for a missing or non-positive price and rejects other durations', () => {
    expect(flexMonthlyFrom(null)).toBeNull();
    expect(flexMonthlyFrom(0)).toBeNull();
    expect(flexMonthlyFrom(120_000)).toBe(10_000);
    // @ts-expect-error only 3, 6 and 12 months exist
    expect(() => computeSchedule(1000, 4)).toThrow(RangeError);
  });
});

describe('promotion engine', () => {
  const base: PromotionRule = { id: 'p', code: null, type: 'PERCENT', value: 1000, minSubtotalBaisa: null, maxDiscountBaisa: null, productIds: [], categoryIds: [], brandIds: [], startsAt: null, endsAt: null, isActive: true, usageLimit: null, usageCount: 0 };
  const line = (total: number, over = {}) => ({ productId: 'a', categoryId: 'c', brandId: 'b', lineTotalBaisa: total, ...over });

  it('applies a percentage in basis points and a capped fixed amount', () => {
    expect(discountFor(base, [line(200_000)])?.discountBaisa).toBe(20_000);
    expect(discountFor({ ...base, type: 'FIXED', value: 50_000 }, [line(30_000)])?.discountBaisa).toBe(30_000);
    expect(discountFor({ ...base, maxDiscountBaisa: 5_000 }, [line(200_000)])?.discountBaisa).toBe(5_000);
  });

  it('respects scope and minimum subtotal', () => {
    expect(discountFor({ ...base, brandIds: ['other'] }, [line(100_000)])).toBeNull();
    expect(discountFor({ ...base, categoryIds: ['parent'] }, [line(100_000, { parentCategoryId: 'parent' })])?.discountBaisa).toBe(10_000);
    expect(discountFor({ ...base, minSubtotalBaisa: 150_000 }, [line(100_000)])).toBeNull();
  });

  it('needs the code for a coded promotion, never stacks, and skips non-live ones', () => {
    const coded = { ...base, id: 'coded', code: 'SAVE', value: 2000 };
    const auto = { ...base, id: 'auto', value: 500 };
    expect(bestPromotion([coded, auto], [line(100_000)])?.promotionId).toBe('auto');
    expect(bestPromotion([coded, auto], [line(100_000)], { code: 'save' })?.promotionId).toBe('coded');
    expect(bestPromotion([coded], [line(100_000)], { code: 'save', excluded: new Set(['coded']) })).toBeNull();
    const now = new Date('2026-06-01T00:00:00Z');
    expect(isPromotionLive({ ...base, isActive: false })).toBe(false);
    expect(isPromotionLive({ ...base, endsAt: '2026-05-01T00:00:00Z' }, now)).toBe(false);
    expect(isPromotionLive({ ...base, startsAt: '2026-07-01T00:00:00Z' }, now)).toBe(false);
    expect(isPromotionLive({ ...base, usageLimit: 1, usageCount: 1 })).toBe(false);
  });
});

describe('campaign links', () => {
  it('keeps internal paths (without a locale prefix) and https URLs only', () => {
    expect(resolveCampaignHref('/category/audio', '/')).toEqual({ href: '/category/audio', external: false });
    expect(resolveCampaignHref('/ar/category/audio', '/')).toEqual({ href: '/category/audio', external: false });
    expect(resolveCampaignHref('https://example.com/x', '/')).toEqual({ href: 'https://example.com/x', external: true });
  });

  it('falls back for dangerous or malformed links', () => {
    for (const bad of ['javascript:alert(1)', '//evil.example', '/\\evil', 'http://insecure.example', 'data:text/html,x', '', null]) {
      expect(resolveCampaignHref(bad as string | null, '/home')).toEqual({ href: '/home', external: false });
    }
  });
});

describe('storefront paths', () => {
  it('builds locale-less paths', () => {
    expect(productPath('iphone-15')).toBe('/product/iphone-15');
    expect(categoryPath('audio')).toBe('/category/audio');
  });
});
