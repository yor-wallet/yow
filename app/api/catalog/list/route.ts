import { z } from 'zod';
import { apiHandler, json, jsonError } from '@/lib/http';
import { asLocale } from '@/i18n/routing';
import { getSession } from '@/lib/auth';
import { favoriteIdsFor } from '@/lib/catalog/favorites';
import { PAGE_SIZE, parseCatalogParams } from '@/lib/catalog/filters';
import { loadListing, type ListingScope } from '@/lib/catalog/page-data';
import { getCategoryBySlug } from '@/lib/catalog/queries';
import { parseSearchQuery } from '@/lib/catalog/search-query';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestMeta } from '@/lib/request';
import { slugSchema } from '@/lib/validation';

/**
 * "Load more" for category / search listings. Same filters as the page (`brand`, `min`, `sort`…),
 * plus `locale`, `scope` (`category:<slug>` | `search`), `q` and the opaque `cursor`. Read-only GET.
 */
const scopeSchema = z.union([z.literal('search'), z.string().regex(/^category:[a-z0-9-]{1,80}$/)]);

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const { ip } = await getRequestMeta();
  if (ip && !(await rateLimit(`catalog:ip:${ip}`, 240, 60_000)).ok) return jsonError(429, 'rate_limited');

  const scopeRaw = scopeSchema.safeParse(url.searchParams.get('scope') ?? 'search');
  if (!scopeRaw.success) return jsonError(400, 'invalid_scope');
  // API routes sit outside the locale middleware: the client passes its locale explicitly.
  const locale = asLocale(url.searchParams.get('locale'));
  const filters = parseCatalogParams(url.searchParams);

  let scope: ListingScope;
  if (scopeRaw.data === 'search') {
    scope = { kind: 'search', query: parseSearchQuery(url.searchParams.get('q')) };
  } else {
    const slug = slugSchema.safeParse(scopeRaw.data.slice('category:'.length));
    const category = slug.success ? await getCategoryBySlug(slug.data, locale) : null;
    if (!category) return jsonError(404, 'category_not_found');
    scope = { kind: 'category', category };
  }

  const { list } = await loadListing({ locale, scope, filters, cursor: url.searchParams.get('cursor'), limit: PAGE_SIZE, withFacets: false });
  const session = await getSession();
  const favorites = [...(await favoriteIdsFor(session?.user.id, list.items.map((p) => p.id)))];
  return json({ ok: true, items: list.items, nextCursor: list.nextCursor, total: list.total, favorites });
});
