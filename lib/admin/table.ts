/**
 * Server-side table state from URL search params (filters live in the URL, SPEC).
 *   ?q=iphone&sort=createdAt&dir=desc&page=2&status=ACTIVE
 */
export type SearchParams = Record<string, string | string[] | undefined>;

export type TableQuery<S extends string = string> = {
  q: string;
  page: number;
  pageSize: number;
  sort: S;
  dir: 'asc' | 'desc';
  skip: number;
  take: number;
};

export function param(sp: SearchParams, key: string): string | undefined {
  const v = sp[key];
  const s = Array.isArray(v) ? v[0] : v;
  return s === undefined ? undefined : s.slice(0, 200);
}

/** A param restricted to `allowed` values (enums, statuses) or undefined. */
export function enumParam<T extends string>(sp: SearchParams, key: string, allowed: readonly T[]): T | undefined {
  const v = param(sp, key);
  return v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
}

export function parseTableQuery<S extends string>(
  sp: SearchParams,
  opts: { sortable: readonly S[]; defaultSort: S; defaultDir?: 'asc' | 'desc'; pageSize?: number },
): TableQuery<S> {
  const q = (param(sp, 'q') ?? '').trim().slice(0, 120);
  const pageRaw = Number.parseInt(param(sp, 'page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? Math.min(pageRaw, 10_000) : 1;
  const sizeRaw = Number.parseInt(param(sp, 'size') ?? '', 10);
  const pageSize = [10, 25, 50, 100].includes(sizeRaw) ? sizeRaw : (opts.pageSize ?? 25);
  const sort = enumParam(sp, 'sort', opts.sortable) ?? opts.defaultSort;
  const dirRaw = param(sp, 'dir');
  const dir = dirRaw === 'asc' || dirRaw === 'desc' ? dirRaw : (opts.defaultDir ?? 'desc');
  return { q, page, pageSize, sort, dir, skip: (page - 1) * pageSize, take: pageSize };
}

/** Rebuild a query string, overriding/removing keys (undefined/'' removes). */
export function withParams(sp: SearchParams, patch: Record<string, string | number | undefined | null>): string {
  const out = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) {
    const s = Array.isArray(v) ? v[0] : v;
    if (s !== undefined && s !== '') out.set(k, s);
  }
  for (const [k, v] of Object.entries(patch)) {
    if (v === undefined || v === null || v === '') out.delete(k);
    else out.set(k, String(v));
  }
  const s = out.toString();
  return s ? `?${s}` : '';
}

/** Date range filter (`from`/`to` as YYYY-MM-DD, Asia/Muscat days). Defaults to the last `days` days. */
export function parseDateRange(sp: SearchParams, days = 30): { from: Date; to: Date; fromStr: string; toStr: string; days: number } {
  const re = /^\d{4}-\d{2}-\d{2}$/;
  const today = muscatDate(new Date());
  const toStr = re.test(param(sp, 'to') ?? '') ? param(sp, 'to')! : today;
  let fromStr = re.test(param(sp, 'from') ?? '') ? param(sp, 'from')! : shiftDate(toStr, -(days - 1));
  if (fromStr > toStr) fromStr = toStr;
  // Muscat is UTC+4 all year (no DST).
  const from = new Date(`${fromStr}T00:00:00+04:00`);
  const to = new Date(new Date(`${toStr}T00:00:00+04:00`).getTime() + 86_400_000);
  const span = Math.round((to.getTime() - from.getTime()) / 86_400_000);
  if (span > 366) {
    fromStr = shiftDate(toStr, -365);
    return parseDateRange({ from: fromStr, to: toStr }, days);
  }
  return { from, to, fromStr, toStr, days: span };
}

/** YYYY-MM-DD of `d` in Asia/Muscat. */
export function muscatDate(d: Date): string {
  return new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 10);
}

export function shiftDate(ymd: string, deltaDays: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/** Every YYYY-MM-DD between from and to (exclusive end Date). */
export function eachDay(fromStr: string, days: number): string[] {
  return Array.from({ length: days }, (_, i) => shiftDate(fromStr, i));
}
