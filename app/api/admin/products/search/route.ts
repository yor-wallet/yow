import { requireApiPermission } from '@/lib/auth';
import { apiHandler, json } from '@/lib/http';
import { localize } from '@/lib/localized';
import { searchProductsForPicker } from '@/lib/admin/campaigns';

export const dynamic = 'force-dynamic';

/** Product search for admin pickers (campaigns). `GET /api/admin/products/search?q=…&locale=en` — catalog:read. */
export const GET = apiHandler(async (req) => {
  await requireApiPermission('catalog:read');
  const url = new URL(req.url);
  const locale = url.searchParams.get('locale') ?? 'en';
  const rows = await searchProductsForPicker(url.searchParams.get('q') ?? '');
  return json({ ok: true, items: rows.map((r) => ({ id: r.id, sku: r.sku, status: r.status, name: localize(r.name, locale, r.sku) })) });
});
