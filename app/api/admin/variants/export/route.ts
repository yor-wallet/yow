import { requireApiPermission } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { prisma } from '@/lib/db';
import { apiHandler } from '@/lib/http';
import { localize } from '@/lib/localized';
import { can } from '@/lib/rbac';
import { toCsv } from '@/lib/admin/csv';
import { NEEDS_PRICE_WHERE } from '@/lib/admin/products';
import { EXPORT_HEADER, exportRow } from '@/lib/admin/variant-pricing';

export const dynamic = 'force-dynamic';

/**
 * Variant prices & stock as CSV (`catalog:read`): the file the import screen reads back
 * (sku, priceOmr, compareAtOmr, costOmr, stock + informative columns that the import ignores).
 * `?filter=needs-price` limits it to products that still need a price. Costs are only included
 * for staff allowed to set prices. Audited.
 */
export const GET = apiHandler(async (req) => {
  const session = await requireApiPermission('catalog:read');
  const url = new URL(req.url);
  const needsPrice = url.searchParams.get('filter') === 'needs-price';
  const locale = ['ar', 'en', 'fr'].includes(url.searchParams.get('locale') ?? '') ? url.searchParams.get('locale')! : 'en';
  const includeCost = can(session.user.role, 'prices:write');
  const variants = await prisma.productVariant.findMany({
    where: needsPrice ? { product: NEEDS_PRICE_WHERE } : { product: { status: { not: 'ARCHIVED' } } },
    orderBy: [{ product: { sku: 'asc' } }, { sort: 'asc' }, { sku: 'asc' }],
    select: {
      sku: true,
      priceBaisa: true,
      compareAtBaisa: true,
      costBaisa: true,
      stock: true,
      reserved: true,
      color: true,
      capacity: true,
      product: { select: { sku: true, name: true, status: true } },
    },
    take: 20_000,
  });
  const csv = toCsv(
    EXPORT_HEADER,
    variants.map((v) => exportRow(v, { name: localize(v.product.name, locale, v.product.sku), sku: v.product.sku, status: v.product.status }, includeCost)),
  );
  await logAudit({
    actorId: session.user.id,
    actorRole: session.user.role,
    action: 'variant.export',
    entity: 'ProductVariant',
    after: { rows: variants.length, filter: needsPrice ? 'needs-price' : 'all', includeCost },
  });
  const date = new Date(Date.now() + 4 * 3_600_000).toISOString().slice(0, 10);
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="doom-variant-prices-${date}${needsPrice ? '-needs-price' : ''}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
});
