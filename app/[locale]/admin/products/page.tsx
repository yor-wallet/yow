import type { Metadata } from 'next';
import { PackagePlus } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { listAdminProducts } from '@/lib/admin/products';
import { formatBaisa } from '@/lib/money';
import { localize } from '@/lib/localized';
import { Button, buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Field';
import { DataTable, Td, Th, Tr } from '@/components/admin/DataTable';
import { AdminPageHeader, Pagination, ProductStatusBadge } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('products.title'), robots: { index: false } };
}

const STATUS_FILTERS = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const;

export default async function AdminProductsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('catalog:read', '/admin/products');
  const sp = await searchParams;
  const [t, tc, format, list] = await Promise.all([getTranslations('admin'), getTranslations('common.actions'), getFormatter(), listAdminProducts(sp)]);
  const canWrite = ctx.can('catalog:write');
  const filtered = !!list.query.q || !!list.status;

  return (
    <>
      <AdminPageHeader
        title={t('products.title')}
        subtitle={t('products.subtitle')}
        actions={
          canWrite ? (
            <>
              <Link href="/admin/products/import" className={buttonClasses({ variant: 'outline' })} data-testid="import-catalogue">
                {t('import.link')}
              </Link>
              <Link href="/admin/products/new" className={buttonClasses({ variant: 'primary' })} data-testid="new-product">
                {t('products.new')}
              </Link>
            </>
          ) : null
        }
      />

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3" data-testid="product-filters">
        <Input name="q" type="search" label={t('products.search')} placeholder={t('products.searchPlaceholder')} defaultValue={list.query.q} containerClassName="min-w-56 flex-1" data-testid="product-search" />
        <Select name="status" label={t('products.filterStatus')} defaultValue={list.status ?? ''} containerClassName="w-44" data-testid="product-status-filter">
          <option value="">{t('products.all')}</option>
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {t(`products.status.${s}`)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {tc('search')}
        </Button>
      </form>

      <p className="mb-3 text-sm text-muted" aria-live="polite" data-testid="product-count">
        {t('products.results', { count: list.total })}
      </p>

      {list.items.length === 0 ? (
        <EmptyState
          icon={<PackagePlus size={28} aria-hidden="true" />}
          title={filtered ? t('products.emptyFiltered') : t('products.emptyTitle')}
          description={filtered ? undefined : t('products.emptyText')}
          action={
            !filtered && canWrite ? (
              <Link href="/admin/products/new" className={buttonClasses({ variant: 'primary' })}>
                {t('products.new')}
              </Link>
            ) : undefined
          }
        />
      ) : (
        <DataTable
          caption={t('products.title')}
          testId="product-table"
          head={
            <>
              <Th>{t('products.columns.product')}</Th>
              <Th>{t('products.columns.sku')}</Th>
              <Th>{t('products.columns.category')}</Th>
              <Th>{t('products.columns.variants')}</Th>
              <Th>{t('products.columns.price')}</Th>
              <Th>{t('products.columns.stock')}</Th>
              <Th>{t('products.columns.status')}</Th>
              <Th>{t('products.columns.updated')}</Th>
            </>
          }
        >
          {list.items.map((p) => {
            const name = localize(p.name, locale, p.sku);
            return (
              <Tr key={p.id} testId="product-row">
                <Td primary>
                  <div className="flex items-center gap-3">
                    <span className="grid size-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-surface-2">
                      {p.image ? <img src={p.image} alt="" width={48} height={48} loading="lazy" className="size-full object-cover" /> : null}
                    </span>
                    <div className="min-w-0">
                      {canWrite ? (
                        <Link href={`/admin/products/${p.id}`} className="block truncate font-semibold hover:underline" data-testid="product-link">
                          {name}
                        </Link>
                      ) : (
                        <span className="block truncate font-semibold">{name}</span>
                      )}
                      {p.brand ? <p className="truncate text-xs text-muted">{p.brand}</p> : null}
                    </div>
                  </div>
                </Td>
                <Td label={t('products.columns.sku')} className="[unicode-bidi:isolate]">
                  <span dir="ltr">{p.sku}</span>
                </Td>
                <Td label={t('products.columns.category')}>{localize(p.category, locale)}</Td>
                <Td label={t('products.columns.variants')}>{t('products.variantsCount', { count: p.variants })}</Td>
                <Td label={t('products.columns.price')} className="tabular-nums [unicode-bidi:isolate]">
                  {p.priceMinBaisa === null ? (
                    <span className="text-muted">{t('products.noPrice')}</span>
                  ) : p.priceMinBaisa === p.priceMaxBaisa ? (
                    formatBaisa(p.priceMinBaisa, locale)
                  ) : (
                    t('products.priceRange', { min: formatBaisa(p.priceMinBaisa, locale), max: formatBaisa(p.priceMaxBaisa ?? p.priceMinBaisa, locale) })
                  )}
                </Td>
                <Td label={t('products.columns.stock')} className="tabular-nums">
                  {format.number(p.stock)}
                </Td>
                <Td label={t('products.columns.status')}>
                  <ProductStatusBadge status={p.status} />
                </Td>
                <Td label={t('products.columns.updated')} className="text-muted">
                  {format.dateTime(p.updatedAt, { dateStyle: 'medium', timeZone: 'Asia/Muscat' })}
                </Td>
              </Tr>
            );
          })}
        </DataTable>
      )}

      <Pagination page={list.query.page} pageSize={list.query.pageSize} total={list.total} basePath="/admin/products" sp={sp} />
    </>
  );
}
