import type { Metadata } from 'next';
import { Percent } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { listPromotions, type PromotionState } from '@/lib/admin/promotions';
import { percentFromBps } from '@/lib/catalog/promotions';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { AdminForm } from '@/components/admin/AdminForm';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';
import { togglePromotionAction } from './actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('promotions.title'), robots: { index: false } };
}

const BADGE: Record<PromotionState, string> = { live: 'ACTIVE', scheduled: 'DRAFT', ended: 'ARCHIVED', used_up: 'ARCHIVED', off: 'CLOSED' };

export default async function AdminPromotionsPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('promotions:write', '/admin/promotions');
  const [tt, format, promotions] = await Promise.all([getTranslations('admin.promotions'), getFormatter(), listPromotions()]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' }) : null);

  return (
    <>
      <AdminPageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <Link href="/admin/promotions/new" className={buttonClasses({ variant: 'primary' })} data-testid="new-promotion">
            {t('new')}
          </Link>
        }
      />
      {promotions.length === 0 ? (
        <EmptyState icon={<Percent size={28} aria-hidden="true" />} title={t('empty')} description={t('emptyText')} />
      ) : (
        <ul className="flex flex-col gap-2" data-testid="promotions-list">
          {promotions.map((p) => {
            const scoped = p.productIds.length + p.categoryIds.length + p.brandIds.length > 0;
            const starts = date(p.startsAt);
            const ends = date(p.endsAt);
            return (
              <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 rounded-card border border-border bg-surface p-4" data-testid="promotion-row">
                <Link href={`/admin/promotions/${p.id}`} className="min-w-0 flex-1 hover:text-accent">
                  <span className="block font-semibold">{localize(p.name, locale)}</span>
                  <span className="block text-sm">
                    <span dir="ltr">{p.type === 'PERCENT' ? `−${percentFromBps(p.value)}%` : `−${formatBaisa(p.value, locale)}`}</span>
                    {' · '}
                    {p.code ? (
                      <span className="font-mono" dir="ltr">
                        {p.code}
                      </span>
                    ) : (
                      t('automatic')
                    )}
                    {' · '}
                    {scoped ? t('scoped') : t('wholeCart')}
                  </span>
                  <span className="block text-xs text-muted">
                    {starts || ends ? `${starts ?? '…'} → ${ends ?? '…'}` : t('noDates')}
                    {' · '}
                    {t('used', { count: p.usageCount })}
                    {p.usageLimit !== null ? ` / ${p.usageLimit}` : ''}
                  </span>
                </Link>
                <span className="flex items-center gap-2">
                  <StatusBadge status={BADGE[p.state]} label={t(`state.${p.state}`)} testId="promotion-state" />
                  <AdminForm
                    action={togglePromotionAction}
                    hidden={{ id: p.id, isActive: p.isActive ? 'false' : 'true' }}
                    submitLabel={p.isActive ? t('deactivate') : t('activate')}
                    submitVariant="ghost"
                    className="contents"
                    testId={`promotion-toggle-${p.id}`}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <p className="mt-3 text-xs text-muted">{t('rules')}</p>
    </>
  );
}
