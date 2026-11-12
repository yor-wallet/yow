/**
 * Catalogue filters <-> URL search params (pure). Filters ALWAYS live in the URL so
 * Back/Forward, reloads and shared links restore the exact same listing.
 *
 *   ?sub=smartphones-apple&brand=apple,samsung&ser=iPhone%2017&yr=2025,2026&min=100&max=500&cap=256GB&color=Black&stock=1&sort=price_asc&n=48
 */

export const SORT_KEYS = ['relevance', 'newest', 'price_asc', 'price_desc'] as const;
export type SortKey = (typeof SORT_KEYS)[number];

export const PAGE_SIZE = 24;
/** Upper bound of items rendered server-side when restoring "load more" state (`n`). */
export const MAX_RESTORE = 240;

export type CatalogFilters = {
  sub: string | null;
  brands: string[];
  /** Product family ("iPhone 17", "Galaxy S25"): `Product.series`. */
  series: string[];
  /** Release years: `Product.modelYear`. */
  years: number[];
  /** Whole OMR (user-facing). */
  minOmr: number | null;
  maxOmr: number | null;
  capacities: string[];
  colors: string[];
  inStock: boolean;
  sort: SortKey;
  /** How many items the user had loaded (restored on Back). */
  n: number;
};

export type SearchParamsInput = URLSearchParams | Record<string, string | string[] | undefined>;

export const DEFAULT_FILTERS: CatalogFilters = {
  sub: null,
  brands: [],
  series: [],
  years: [],
  minOmr: null,
  maxOmr: null,
  capacities: [],
  colors: [],
  inStock: false,
  sort: 'relevance',
  n: PAGE_SIZE,
};

function getAll(sp: SearchParamsInput, key: string): string[] {
  if (sp instanceof URLSearchParams) return sp.getAll(key);
  const v = sp[key];
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v];
}

function first(sp: SearchParamsInput, key: string): string | null {
  return getAll(sp, key)[0] ?? null;
}

const SAFE_VALUE = /^[\p{L}\p{N} ._+\-/()]{1,40}$/u;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Comma-separated and/or repeated values → distinct, safe, sorted list (max 20). */
function list(sp: SearchParamsInput, key: string, re: RegExp): string[] {
  const values = getAll(sp, key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => v && re.test(v));
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, 'en')).slice(0, 20);
}

/** Comma-separated release years (2000–2100), distinct, ascending, max 12. */
function yearList(sp: SearchParamsInput, key: string): number[] {
  const years = getAll(sp, key)
    .flatMap((v) => v.split(','))
    .map((v) => v.trim())
    .filter((v) => /^\d{4}$/.test(v))
    .map(Number)
    .filter((y) => y >= 2000 && y <= 2100);
  return [...new Set(years)].sort((a, b) => a - b).slice(0, 12);
}

function omr(value: string | null): number | null {
  if (value === null || value.trim() === '') return null;
  if (!/^\d{1,7}$/.test(value.trim())) return null;
  return Number(value.trim());
}

export function parseCatalogParams(sp: SearchParamsInput, opts: { defaultSort?: SortKey } = {}): CatalogFilters {
  const sortRaw = first(sp, 'sort');
  const sort = (SORT_KEYS as readonly string[]).includes(sortRaw ?? '') ? (sortRaw as SortKey) : (opts.defaultSort ?? 'relevance');
  let minOmr = omr(first(sp, 'min'));
  let maxOmr = omr(first(sp, 'max'));
  if (minOmr !== null && maxOmr !== null && minOmr > maxOmr) [minOmr, maxOmr] = [maxOmr, minOmr];
  const subRaw = first(sp, 'sub');
  const nRaw = Number(first(sp, 'n'));
  const n = Number.isInteger(nRaw) && nRaw > PAGE_SIZE ? Math.min(MAX_RESTORE, Math.ceil(nRaw / PAGE_SIZE) * PAGE_SIZE) : PAGE_SIZE;
  return {
    sub: subRaw && SLUG.test(subRaw) ? subRaw : null,
    brands: list(sp, 'brand', SLUG),
    series: list(sp, 'ser', SAFE_VALUE),
    years: yearList(sp, 'yr'),
    minOmr,
    maxOmr,
    capacities: list(sp, 'cap', SAFE_VALUE),
    colors: list(sp, 'color', SAFE_VALUE),
    inStock: first(sp, 'stock') === '1',
    sort,
    n,
  };
}

/** Serialise (defaults omitted, stable order) — used to build links and replace the URL. */
export function serializeCatalogParams(
  f: Partial<CatalogFilters>,
  opts: { q?: string | null; defaultSort?: SortKey; keepN?: boolean } = {},
): URLSearchParams {
  const sp = new URLSearchParams();
  if (opts.q) sp.set('q', opts.q);
  if (f.sub) sp.set('sub', f.sub);
  if (f.brands?.length) sp.set('brand', [...f.brands].sort().join(','));
  if (f.series?.length) sp.set('ser', [...f.series].sort().join(','));
  if (f.years?.length) sp.set('yr', [...f.years].sort((a, b) => a - b).join(','));
  if (f.minOmr !== null && f.minOmr !== undefined) sp.set('min', String(f.minOmr));
  if (f.maxOmr !== null && f.maxOmr !== undefined) sp.set('max', String(f.maxOmr));
  if (f.capacities?.length) sp.set('cap', [...f.capacities].sort().join(','));
  if (f.colors?.length) sp.set('color', [...f.colors].sort().join(','));
  if (f.inStock) sp.set('stock', '1');
  if (f.sort && f.sort !== (opts.defaultSort ?? 'relevance')) sp.set('sort', f.sort);
  if (opts.keepN && f.n && f.n > PAGE_SIZE) sp.set('n', String(f.n));
  return sp;
}

/** Number of active (user-chosen) filters, for the mobile "Filters (3)" button. */
export function activeFilterCount(f: CatalogFilters): number {
  return (
    (f.sub ? 1 : 0) +
    f.brands.length +
    f.series.length +
    f.years.length +
    (f.minOmr !== null || f.maxOmr !== null ? 1 : 0) +
    f.capacities.length +
    f.colors.length +
    (f.inStock ? 1 : 0)
  );
}

export function toggleValue(values: readonly string[], value: string): string[] {
  return values.includes(value) ? values.filter((v) => v !== value) : [...values, value].sort();
}

// ───────────── Cursor (opaque keyset cursor for "load more") ─────────────

export type ListCursor = { a: string; id: string };

export function encodeCursor(c: ListCursor): string {
  const json = JSON.stringify(c);
  const b64 = typeof Buffer !== 'undefined' ? Buffer.from(json, 'utf8').toString('base64') : btoa(json);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function decodeCursor(raw: string | null | undefined): ListCursor | null {
  if (!raw || raw.length > 200 || !/^[A-Za-z0-9_-]+$/.test(raw)) return null;
  try {
    const b64 = raw.replace(/-/g, '+').replace(/_/g, '/');
    const json = typeof Buffer !== 'undefined' ? Buffer.from(b64, 'base64').toString('utf8') : atob(b64);
    const v = JSON.parse(json) as unknown;
    if (!v || typeof v !== 'object') return null;
    const { a, id } = v as Record<string, unknown>;
    if (typeof a !== 'string' || !/^-?\d{1,19}$/.test(a) || typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return null;
    return { a, id };
  } catch {
    return null;
  }
}
