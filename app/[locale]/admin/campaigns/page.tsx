import type { Metadata } from 'next';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { CAMPAIGN_PLACEMENTS, listCampaigns } from '@/lib/admin/campaigns';
import type { SearchParams } from '@/lib/admin/table';
import { localize } from '@/lib/localized';
import { buttonClasses } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AdminForm } from '@/components/admin/AdminForm';
import { Sparkline } from '@/components/admin/charts';
import { DataTable, Td, Th, Tr } from '@/components/admin/DataTable';
import { FilterBar } from '@/components/admin/FilterBar';
import { AdminPageHeader, EmptyRow, Pagination, StatusBadge } from '@/components/admin/ui';
import { toggleCampaignAction } from './actions';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('campaigns.title'), robots: { index: false } };
}

export default async function CampaignsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('campaigns:write', '/admin/campaigns');
  const sp = await searchParams;
  const t = await getTranslations('admin');
  const format = await getFormatter();
  const data = await listCampaigns(sp);
  const date = (d: Date | null) => (d ? format.dateTime(d, { dateStyle: 'medium', timeZone: 'Asia/Muscat' }) : '—');
  const pct = (bps: number | null) => (bps === null ? '—' : `${(bps / 100).toFixed(2)}%`);

  return (
    <>
      <AdminPageHeader
        eyebrow={t('nav.groups.commerce')}
        title={t('campaigns.title')}
        subtitle={t('campaigns.subtitle')}
        actions={
          <Link href="/admin/campaigns/new" className={buttonClasses({ variant: 'primary' })} data-testid="new-campaign">
            {t('campaigns.new')}
          </Link>
        }
      />
      <FilterBar
        q={data.q}
        searchLabel={t('campaigns.search')}
        selects={[
          { name: 'placement', label: t('campaigns.fields.placements'), value: data.placement, options: CAMPAIGN_PLACEMENTS.map((p) => ({ value: p, label: t(`campaigns.placements.${p}`) })) },
          { name: 'state', label: t('campaigns.state'), value: data.state, options: [{ value: 'active', label: t('campaigns.active') }, { value: 'inactive', label: t('campaigns.inactive') }] },
        ]}
      />
      {data.items.length === 0 ? (
        <EmptyRow text={t('campaigns.empty')} testId="campaigns-empty" />
      ) : (
        <DataTable
          caption={t('campaigns.title')}
          testId="campaigns-table"
          head={
            <>
              <Th>{t('campaigns.columns.campaign')}</Th>
              <Th>{t('campaigns.columns.placements')}</Th>
              <Th>{t('campaigns.columns.dates')}</Th>
              <Th>{t('campaigns.columns.priority')}</Th>
              <Th>{t('campaigns.columns.stats')}</Th>
              <Th>{t('campaigns.columns.status')}</Th>
            </>
          }
        >
          {data.items.map((c) => (
            <Tr key={c.id} testId="campaign-row">
              <Td primary>
                <Link href={`/admin/campaigns/${c.id}`} className="font-semibold hover:text-accent">
                  {c.internalName}
                </Link>
                <span className="block text-xs text-muted">{localize(c.title, locale)}</span>
                <span className="block text-xs text-muted">{t(`campaigns.mediaTypes.${c.mediaType}`)}</span>
              </Td>
              <Td label={t('campaigns.columns.placements')}>
                <span className="flex flex-wrap justify-end gap-1 md:justify-start">
                  {c.placements.map((p) => (
                    <Badge key={p} variant="info">
                      {(CAMPAIGN_PLACEMENTS as readonly string[]).includes(p) ? t(`campaigns.placements.${p as 'home_hero'}`) : p}
                    </Badge>
                  ))}
                </span>
              </Td>
              <Td label={t('campaigns.columns.dates')}>
                <span className="text-xs">
                  {date(c.startsAt)} → {date(c.endsAt)}
                </span>
              </Td>
              <Td label={t('campaigns.columns.priority')}>
                <span className="font-display tabular-nums">{c.priority}</span>
              </Td>
              <Td label={t('campaigns.columns.stats')}>
                <span className="flex items-center gap-2">
                  <span className="text-xs tabular-nums" dir="ltr">
                    {format.number(c.impressions)} / {format.number(c.clicks)} · {pct(c.ctrBps)}
                  </span>
                  <Sparkline values={c.ctrSeries} label={t('campaigns.ctrTrend')} />
                </span>
              </Td>
              <Td label={t('campaigns.columns.status')}>
                <span className="flex items-center gap-2">
                  <StatusBadge status={c.isActive ? 'ACTIVE' : 'CLOSED'} label={c.isActive ? t('campaigns.active') : t('campaigns.inactive')} />
                  <AdminForm
                    action={toggleCampaignAction}
                    hidden={{ id: c.id, isActive: c.isActive ? 'false' : 'true' }}
                    submitLabel={c.isActive ? t('campaigns.deactivate') : t('campaigns.activate')}
                    submitVariant="ghost"
                    className="contents"
                    testId={`toggle-${c.slug}`}
                  />
                </span>
              </Td>
            </Tr>
          ))}
        </DataTable>
      )}
      <p className="mt-3 text-xs text-muted">{t('campaigns.statsNote')}</p>
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/admin/campaigns" sp={sp} />
    </>
  );
}
