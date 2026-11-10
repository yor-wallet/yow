import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { CampaignForm } from '@/components/admin/CampaignForm';
import { AdminPageHeader, Section } from '@/components/admin/ui';
import { saveCampaignAction } from '../actions';
import { campaignOptions, campaignValues } from '../options';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('campaigns.new'), robots: { index: false } };
}

export default async function NewCampaignPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('campaigns:write', '/admin/campaigns/new');
  const t = await getTranslations('admin');
  return (
    <>
      <AdminPageHeader
        title={t('campaigns.new')}
        subtitle={t('campaigns.newHint')}
        backHref="/admin/campaigns"
        crumbs={[{ label: t('campaigns.title'), href: '/admin/campaigns' }, { label: t('campaigns.new') }]}
      />
      <Section title={t('campaigns.sections.content')}>
        <CampaignForm action={saveCampaignAction} values={campaignValues(null, [])} options={campaignOptions(t as unknown as (k: string) => string)} />
      </Section>
    </>
  );
}
