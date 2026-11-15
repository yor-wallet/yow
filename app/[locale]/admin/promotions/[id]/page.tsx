import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { getPromotion, promotionState, promotionTargets } from '@/lib/admin/promotions';
import { localize } from '@/lib/localized';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { PromotionForm } from '@/components/admin/PromotionForm';
import { AdminPageHeader, Section, StatusBadge } from '@/components/admin/ui';
import { deletePromotionAction, savePromotionAction } from '../actions';
import { promotionValues } from '../values';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('promotions.edit'), robots: { index: false } };
}

const BADGE = { live: 'ACTIVE', scheduled: 'DRAFT', ended: 'ARCHIVED', used_up: 'ARCHIVED', off: 'CLOSED' } as const;

export default async function EditPromotionPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  await requireAdmin('promotions:write', `/admin/promotions/${id}`);
  const [tt, found, targets] = await Promise.all([getTranslations('admin.promotions'), getPromotion(id), promotionTargets(locale)]);
  if (!found) notFound();
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;
  const { promotion, products } = found;
  const state = promotionState(promotion);
  const unused = promotion.usageCount === 0;
  return (
    <>
      <AdminPageHeader
        title={localize(promotion.name, locale)}
        subtitle={t('edit')}
        backHref="/admin/promotions"
        actions={<StatusBadge status={BADGE[state]} label={t(`state.${state}`)} testId="promotion-state" />}
      />
      <Section title={t('details')}>
        <p className="mb-4 text-sm text-muted" data-testid="promotion-usage">
          {t('used', { count: promotion.usageCount })}
          {promotion.usageLimit !== null ? ` / ${promotion.usageLimit}` : ''}
        </p>
        <PromotionForm action={savePromotionAction} values={promotionValues(promotion, products, locale)} targets={targets} />
      </Section>
      {unused ? (
        <Section title={t('deleteTitle')}>
          <p className="mb-3 text-sm text-muted">{t('deleteText')}</p>
          <ConfirmAction
            action={deletePromotionAction}
            fields={{ id: promotion.id }}
            label={t('delete')}
            title={t('deleteTitle')}
            text={t('deleteConfirm')}
            confirmLabel={t('delete')}
            testId="promotion-delete"
          />
        </Section>
      ) : null}
    </>
  );
}
