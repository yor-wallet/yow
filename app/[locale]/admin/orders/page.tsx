import type { Metadata } from 'next';
import { Receipt } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { ORDER_STATUSES, listAdminOrders } from '@/lib/admin/orders';
import { formatBaisa } from '@/lib/money';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Field';
import { DataTable, Td, Th, Tr } from '@/components/admin/DataTable';
import { AdminPageHeader, OrderStatusBadge, Pagination } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('orders.title'), robots: { index: false } };
}

export default async function AdminOrdersPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('orders:read', '/admin/orders');
  const sp = await searchParams;
  const [t, tc, tStatus, format, list] = await Promise.all([
    getTranslations('admin'),
    getTranslations('common.actions'),
    getTranslations('orders.status'),
    getFormatter(),
    listAdminOrders(sp),
  ]);
  const filtered = !!list.query.q || !!list.status;

  return (
    <>
      <AdminPageHeader title={t('orders.title')} subtitle={t('orders.subtitle')} />

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3" data-testid="order-filters">
        <Input name="q" type="search" label={t('orders.search')} defaultValue={list.query.q} containerClassName="min-w-56 flex-1" data-testid="order-search" />
        <Select name="status" label={t('orders.filterStatus')} defaultValue={list.status ?? ''} containerClassName="w-56" data-testid="order-status-filter">
          <option value="">{t('orders.all')}</option>
          {ORDER_STATUSES.map((s) => (
            <option key={s} value={s}>
              {tStatus(s)}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="outline">
          {tc('search')}
        </Button>
      </form>

      <p className="mb-3 text-sm text-muted" aria-live="polite" data-testid="order-count">
        {t('orders.results', { count: list.total })}
      </p>

      {list.items.length === 0 ? (
        <EmptyState icon={<Receipt size={28} aria-hidden="true" />} title={filtered ? t('products.emptyFiltered') : t('orders.empty')} />
      ) : (
        <DataTable
          caption={t('orders.title')}
          testId="order-table"
          head={
            <>
              <Th>{t('orders.columns.number')}</Th>
              <Th>{t('orders.columns.customer')}</Th>
              <Th>{t('orders.columns.placed')}</Th>
              <Th>{t('orders.columns.items')}</Th>
              <Th>{t('orders.columns.status')}</Th>
              <Th className="text-end">{t('orders.columns.total')}</Th>
            </>
          }
        >
          {list.items.map((o) => (
            <Tr key={o.id} testId="order-row">
              <Td primary>
                <Link href={`/admin/orders/${o.number}`} className="font-semibold hover:underline [unicode-bidi:isolate]" dir="ltr" data-testid="order-link">
                  {o.number}
                </Link>
              </Td>
              <Td label={t('orders.columns.customer')}>
                <div className="min-w-0 text-end md:text-start">
                  <p className="truncate font-medium">{o.customerName}</p>
                  <p className="truncate text-xs text-muted [unicode-bidi:isolate]" dir="ltr">
                    {o.customerEmail}
                  </p>
                </div>
              </Td>
              <Td label={t('orders.columns.placed')} className="text-muted">
                {format.dateTime(o.placedAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' })}
              </Td>
              <Td label={t('orders.columns.items')} className="tabular-nums">
                {format.number(o.items)}
              </Td>
              <Td label={t('orders.columns.status')}>
                <OrderStatusBadge status={o.status} />
              </Td>
              <Td label={t('orders.columns.total')} className="font-semibold tabular-nums [unicode-bidi:isolate] md:text-end">
                {formatBaisa(o.totalBaisa, locale)}
              </Td>
            </Tr>
          ))}
        </DataTable>
      )}

      <Pagination page={list.query.page} pageSize={list.query.pageSize} total={list.total} basePath="/admin/orders" sp={sp} />
    </>
  );
}
