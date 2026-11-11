import type { Metadata } from 'next';
import { Star } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { listAdminReviews, REVIEW_STATUSES } from '@/lib/admin/reviews';
import { productPath } from '@/lib/catalog/paths';
import { localize } from '@/lib/localized';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Input, Select } from '@/components/ui/Field';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { AdminPageHeader, Pagination, StatusBadge } from '@/components/admin/ui';
import { Stars } from '@/components/shop/Stars';
import { moderateReviewAction } from './actions';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('reviews.title'), robots: { index: false } };
}

export default async function AdminReviewsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('reviews:moderate', '/admin/reviews');
  const sp = await searchParams;
  const [t, tc, format, list] = await Promise.all([getTranslations('admin'), getTranslations('common.actions'), getFormatter(), listAdminReviews(sp)]);
  const when = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' });

  return (
    <>
      <AdminPageHeader title={t('reviews.title')} subtitle={t('reviews.subtitle')} />

      <form method="get" role="search" className="mb-4 flex flex-wrap items-end gap-3" data-testid="review-filters">
        <Input name="q" type="search" label={t('reviews.search')} defaultValue={list.query.q} containerClassName="min-w-56 flex-1" data-testid="review-search" />
        <Select name="status" label={t('reviews.filterStatus')} defaultValue={list.status ?? 'ALL'} containerClassName="w-56" data-testid="review-status-filter">
          {REVIEW_STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`reviews.status.${s}`)}
            </option>
          ))}
          <option value="ALL">{t('reviews.all')}</option>
        </Select>
        <Button type="submit" variant="outline">
          {tc('search')}
        </Button>
      </form>

      <p className="mb-3 text-sm text-muted" aria-live="polite" data-testid="review-count">
        {t('reviews.results', { count: list.total })} · {t('reviews.pendingCount', { count: list.pending })}
      </p>

      {list.items.length === 0 ? (
        <EmptyState icon={<Star size={28} aria-hidden="true" />} title={list.status === 'PENDING' && !list.query.q ? t('reviews.emptyPending') : t('reviews.empty')} />
      ) : (
        <ul className="flex flex-col gap-3" data-testid="review-list">
          {list.items.map((r) => (
            <li key={r.id} className="rounded-card border border-border bg-surface p-4" data-testid="review-row" data-status={r.status}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={productPath(r.productSlug)} className="font-semibold underline-offset-4 hover:underline">
                    {localize(r.productName, locale, r.productSku)}
                  </Link>
                  <p className="text-xs text-muted">
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {r.productSku}
                    </span>{' '}
                    · {r.authorName} ·{' '}
                    <span dir="ltr" className="[unicode-bidi:isolate]">
                      {r.authorEmail}
                    </span>{' '}
                    · {when(r.createdAt)} · {r.locale.toUpperCase()}
                  </p>
                </div>
                <StatusBadge status={r.status} label={t(`reviews.status.${r.status}`)} testId="review-status" />
              </div>
              <div className="mt-3 flex items-center gap-2">
                <Stars rating={r.rating} label={t('reviews.rating', { rating: r.rating })} />
                <span className="text-sm font-semibold tabular-nums">{t('reviews.rating', { rating: r.rating })}</span>
              </div>
              {r.title ? <p className="mt-2 font-semibold">{r.title}</p> : null}
              <p className="mt-1 whitespace-pre-line text-sm" dir="auto">
                {r.text}
              </p>
              <div className="mt-4 flex flex-wrap gap-2">
                {r.status !== 'PUBLISHED' ? (
                  <ConfirmAction
                    action={moderateReviewAction}
                    fields={{ id: r.id, decision: 'PUBLISHED' }}
                    label={t('reviews.publish')}
                    title={t('reviews.publishConfirm')}
                    text={t('reviews.publishText')}
                    confirmLabel={t('reviews.publish')}
                    testId="review-publish"
                    variant="primary"
                  />
                ) : null}
                {r.status !== 'REJECTED' ? (
                  <ConfirmAction
                    action={moderateReviewAction}
                    fields={{ id: r.id, decision: 'REJECTED' }}
                    label={r.status === 'PUBLISHED' ? t('reviews.unpublish') : t('reviews.reject')}
                    title={r.status === 'PUBLISHED' ? t('reviews.unpublishConfirm') : t('reviews.rejectConfirm')}
                    text={t('reviews.rejectText')}
                    confirmLabel={r.status === 'PUBLISHED' ? t('reviews.unpublish') : t('reviews.reject')}
                    testId="review-reject"
                  />
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination page={list.query.page} pageSize={list.query.pageSize} total={list.total} basePath="/admin/reviews" sp={sp} />
    </>
  );
}
