import { apiHandler, json, jsonError } from '@/lib/http';
import { asLocale } from '@/i18n/routing';
import { listProducts } from '@/lib/catalog/listing';
import { isEmptyQuery, parseSearchQuery } from '@/lib/catalog/search-query';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestMeta } from '@/lib/request';

/**
 * Search suggestions (specification §3/§4): at most 6 products, only the fields a suggestion row shows
 * (name, brand, price, small image, availability). Read-only GET; the client waits ~250 ms after the last
 * keystroke and ignores answers that are no longer current.
 */
export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const { ip } = await getRequestMeta();
  if (ip && !(await rateLimit(`suggest:ip:${ip}`, 240, 60_000)).ok) return jsonError(429, 'rate_limited');
  const query = parseSearchQuery(url.searchParams.get('q'));
  if (isEmptyQuery(query)) return json({ items: [] });
  const locale = asLocale(url.searchParams.get('locale'));
  const res = await listProducts({ locale, search: query, filters: { sort: 'relevance' }, limit: 6, withTotal: false, promotions: [] });
  return json(
    {
      items: res.items.map((p) => ({
        slug: p.slug,
        name: p.name,
        brand: p.brand,
        priceBaisa: p.priceBaisa,
        priceFrom: p.priceFrom,
        availability: p.availability,
        image: p.image ? { src: p.image.src, width: p.image.width, height: p.image.height } : null,
      })),
    },
    { headers: { 'Cache-Control': 'private, max-age=30' } },
  );
});
