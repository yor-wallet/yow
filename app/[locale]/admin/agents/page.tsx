import type { Metadata } from 'next';
import { Bot, CircleAlert, CircleCheck, Clock } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireAdmin } from '@/lib/admin/guard';
import { agentsOverview } from '@/lib/admin/agents';
import { HudCorners } from '@/components/ui/HudCorners';
import { buttonClasses } from '@/components/ui/Button';
import { AdminForm } from '@/components/admin/AdminForm';
import { AdminPageHeader, Section, StatusBadge } from '@/components/admin/ui';
import { DataTable, Td, Th, Tr } from '@/components/admin/DataTable';
import { cn } from '@/lib/cn';
import { runAgentsAction } from './actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'agents' });
  return { title: t('title'), robots: { index: false } };
}

export default async function AgentsPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('agents:read', '/admin/agents');
  const t = await getTranslations('agents');
  const ta = await getTranslations('admin');
  const format = await getFormatter();
  const { agents, recent } = await agentsOverview();
  const canRun = ctx.can('agents:run');
  const when = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' });

  return (
    <>
      <AdminPageHeader
        eyebrow={ta('nav.groups.governance')}
        title={t('title')}
        subtitle={t('subtitle')}
        actions={
          <>
            <Link href="/admin/agents/proposals" className={buttonClasses({ variant: 'outline' })} data-testid="open-proposals">
              {t('openInbox')}
            </Link>
            {canRun ? <AdminForm action={runAgentsAction} submitLabel={t('runAll')} testId="run-all-agents" className="contents" /> : null}
          </>
        }
      />
      <p className="mb-6 max-w-3xl text-sm text-muted">{t('principle')}</p>

      <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3" data-testid="agents-grid">
        {agents.map((a) => {
          const status = a.lastRun?.status;
          return (
            <li key={a.key} className={cn('relative min-w-0 rounded-card p-4 shadow-card', a.orchestrates ? 'holo-border' : 'glass')} data-testid={`agent-${a.key}`}>
              <HudCorners className="text-cyan/40" size={10} />
              <div className="flex items-start gap-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-premium text-cyan shadow-glow-blue" aria-hidden="true">
                  <Bot size={20} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="hud-label text-[10px]">{t('number', { n: a.number })}</p>
                  <h2 className="font-display text-base font-bold">{t(`list.${a.nameKey as 'supervision'}.name`)}</h2>
                  <p className="mt-1 text-sm text-muted">{t(`list.${a.nameKey as 'supervision'}.mission`)}</p>
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-2 text-center text-xs">
                <div className="rounded-xl bg-surface-2/60 p-2">
                  <dt className="text-muted">{t('open')}</dt>
                  <dd className={cn('font-display neon mt-0.5 text-lg font-bold', a.openCritical ? 'text-orange' : 'text-cyan')}>{a.openProposals}</dd>
                </div>
                <div className="rounded-xl bg-surface-2/60 p-2">
                  <dt className="text-muted">{t('runs24h')}</dt>
                  <dd className="font-display mt-0.5 text-lg font-bold">{a.runs24h}</dd>
                </div>
                <div className="rounded-xl bg-surface-2/60 p-2">
                  <dt className="text-muted">{t('failed24h')}</dt>
                  <dd className={cn('font-display mt-0.5 text-lg font-bold', a.failed24h ? 'text-error' : undefined)}>{a.failed24h}</dd>
                </div>
              </dl>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                {status === 'SUCCEEDED' ? <CircleCheck size={14} className="text-success" aria-hidden="true" /> : status === 'FAILED' ? <CircleAlert size={14} className="text-error" aria-hidden="true" /> : <Clock size={14} aria-hidden="true" />}
                <span data-testid={`agent-${a.key}-last`}>{a.lastRun ? t('lastRun', { when: when(a.lastRun.startedAt), status: t(`runStatus.${a.lastRun.status as 'SUCCEEDED'}`) }) : t('neverRun')}</span>
                <span aria-hidden="true">·</span>
                <span>{t('every', { minutes: a.everyMinutes })}</span>
              </div>
              {a.lastRun?.error ? <p className="mt-2 line-clamp-2 break-all font-mono text-xs text-error" dir="ltr">{a.lastRun.error}</p> : null}
              <details className="mt-3 text-xs">
                <summary className="cursor-pointer text-muted">{t('scopes')}</summary>
                <p className="mt-1 break-words font-mono text-[11px] text-muted" dir="ltr">
                  {a.scopes.join(', ')}
                </p>
              </details>
              <div className="mt-3 flex flex-wrap gap-2">
                <Link href={`/admin/agents/proposals?agent=${a.key}`} className={buttonClasses({ variant: 'ghost', size: 'sm' })}>
                  {t('viewProposals')}
                </Link>
                {canRun && !a.orchestrates ? (
                  <AdminForm action={runAgentsAction} hidden={{ agent: a.key }} submitLabel={t('runOne')} submitVariant="outline" testId={`run-${a.key}`} className="contents" />
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>

      <Section id="recent-runs" title={t('recentRuns')} className="mt-8">
        {recent.length === 0 ? (
          <p className="text-sm text-muted">{t('noRuns')}</p>
        ) : (
          <DataTable caption={t('recentRuns')} head={<><Th>{t('columns.agent')}</Th><Th>{t('columns.trigger')}</Th><Th>{t('columns.started')}</Th><Th>{t('columns.duration')}</Th><Th>{t('columns.status')}</Th></>} testId="runs-table">
            {recent.map((r) => (
              <Tr key={r.id}>
                <Td primary>
                  <span className="font-semibold">{agents.find((a) => a.key === r.agentKey) ? t(`list.${agents.find((a) => a.key === r.agentKey)!.nameKey as 'supervision'}.name`) : r.agentKey}</span>
                </Td>
                <Td label={t('columns.trigger')}>{t(`triggers.${(['cron', 'manual', 'cli', 'test'].includes(r.trigger) ? r.trigger : 'manual') as 'cron'}`)}</Td>
                <Td label={t('columns.started')}>{when(r.startedAt)}</Td>
                <Td label={t('columns.duration')}>
                  <span className="font-display tabular-nums" dir="ltr">{r.finishedAt ? `${Math.max(0, r.finishedAt.getTime() - r.startedAt.getTime())} ms` : '—'}</span>
                </Td>
                <Td label={t('columns.status')}>
                  <StatusBadge status={r.status} label={t(`runStatus.${r.status}`)} />
                </Td>
              </Tr>
            ))}
          </DataTable>
        )}
      </Section>
    </>
  );
}
