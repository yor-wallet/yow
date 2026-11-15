import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { promotionTargets } from '@/lib/admin/promotions';
import { PromotionForm } from '@/components/admin/PromotionForm';
import { AdminPageHeader, Section } from '@/components/admin/ui';
import { savePromotionAction } from '../actions';
import { promotionValues } from '../values';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('promotions.new'), robots: { index: false } };
}

export default async function NewPromotionPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('promotions:write', '/admin/promotions/new');
  const [t, targets] = await Promise.all([getTranslations('admin'), promotionTargets(locale)]);
  return (
    <>
      <AdminPageHeader title={t('promotions.new')} subtitle={t('promotions.newHint')} backHref="/admin/promotions" />
      <Section title={t('promotions.details')}>
        <PromotionForm action={savePromotionAction} values={promotionValues(null, [], locale)} targets={targets} />
      </Section>
    </>
  );
}
