import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { getCampaign, previewSlide } from '@/lib/admin/campaigns';
import { localize } from '@/lib/localized';
import { HeroCarousel } from '@/components/ads/HeroCarousel';
import { CampaignForm } from '@/components/admin/CampaignForm';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { BarChart, ChartFrame, Sparkline } from '@/components/admin/charts';
import { DataTable, Td, Th, Tr } from '@/components/admin/DataTable';
import { AdminPageHeader, EmptyRow, Section } from '@/components/admin/ui';
import { deleteCampaignAction, saveCampaignAction } from '../actions';
import { campaignOptions, campaignValues } from '../options';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('campaigns.editTitle'), robots: { index: false } };
}

export default async function EditCampaignPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  await requireAdmin('campaigns:write', `/admin/campaigns/${id}`);
  const data = await getCampaign(id);
  if (!data) notFound();
  const t = await getTranslations('admin');
  const format = await getFormatter();
  const { campaign: c, stats, products } = data;
  const picked = c.productIds
    .map((pid) => products.find((p) => p.id === pid))
    .filter((p): p is (typeof products)[number] => !!p)
    .map((p) => ({ id: p.id, sku: p.sku, name: localize(p.name, locale, p.sku) }));
  const chronological = [...stats].reverse();
  const totals = stats.reduce((a, s) => ({ i: a.i + s.impressions, c: a.c + s.clicks }), { i: 0, c: 0 });
  const ctr = (i: number, cl: number) => (i ? `${((cl / i) * 100).toFixed(2)}%` : '—');

  return (
    <>
      <AdminPageHeader
        eyebrow={t('nav.campaigns')}
        title={c.internalName}
        subtitle={t('campaigns.editHint')}
        backHref="/admin/campaigns"
        crumbs={[{ label: t('campaigns.title'), href: '/admin/campaigns' }, { label: c.internalName }]}
        actions={
          <ConfirmAction
            action={deleteCampaignAction}
            fields={{ id: c.id }}
            label={t('campaigns.delete')}
            title={t('campaigns.deleteTitle')}
            text={t('campaigns.deleteText')}
            confirmLabel={t('campaigns.delete')}
            testId="delete-campaign"
          />
        }
      />
      <div className="grid gap-6 2xl:grid-cols-[minmax(0,1fr)_minmax(0,40rem)]">
        <Section title={t('campaigns.sections.content')}>
          <CampaignForm action={saveCampaignAction} values={campaignValues(c, picked)} options={campaignOptions(t as unknown as (k: string) => string)} />
        </Section>
        <div className="grid min-w-0 content-start gap-6">
          <Section title={t('campaigns.sections.preview')} description={t('campaigns.previewHint')}>
            <div className="overflow-hidden rounded-card" data-testid="campaign-preview">
              <HeroCarousel slides={[previewSlide(c, locale)]} />
            </div>
          </Section>
          <ChartFrame title={t('campaigns.sections.stats')} summary={`${format.number(totals.i)} · ${format.number(totals.c)} · ${ctr(totals.i, totals.c)}`}>
            {stats.length === 0 ? (
              <EmptyRow text={t('campaigns.noStats')} />
            ) : (
              <>
                <BarChart label={t('campaigns.impressionsPerDay')} points={chronological.map((s) => ({ label: s.date.slice(5), value: s.impressions }))} />
                <div className="mt-4 flex items-center gap-3 text-xs text-muted">
                  <span>{t('campaigns.ctrTrend')}</span>
                  <Sparkline values={chronological.map((s) => (s.impressions ? s.clicks / s.impressions : 0))} label={t('campaigns.ctrTrend')} />
                </div>
                <div className="mt-4">
                  <DataTable caption={t('campaigns.sections.stats')} head={<><Th>{t('campaigns.columns.date')}</Th><Th>{t('campaigns.columns.impressions')}</Th><Th>{t('campaigns.columns.clicks')}</Th><Th>{t('campaigns.columns.ctr')}</Th></>} testId="campaign-stats">
                    {stats.slice(0, 30).map((s) => (
                      <Tr key={s.date}>
                        <Td primary>
                          <span dir="ltr">{s.date}</span>
                        </Td>
                        <Td label={t('campaigns.columns.impressions')}>{format.number(s.impressions)}</Td>
                        <Td label={t('campaigns.columns.clicks')}>{format.number(s.clicks)}</Td>
                        <Td label={t('campaigns.columns.ctr')}>{ctr(s.impressions, s.clicks)}</Td>
                      </Tr>
                    ))}
                  </DataTable>
                </div>
              </>
            )}
          </ChartFrame>
        </div>
      </div>
    </>
  );
}
