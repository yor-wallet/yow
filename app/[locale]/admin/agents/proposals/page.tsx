import type { Metadata } from 'next';
import { randomUUID } from 'node:crypto';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { listProposals, PROPOSAL_STATUSES, SEVERITIES } from '@/lib/admin/agents';
import { AGENTS } from '@/lib/agents/registry';
import type { SearchParams } from '@/lib/admin/table';
import { formatBaisa } from '@/lib/money';
import { can } from '@/lib/rbac';
import { HudCorners } from '@/components/ui/HudCorners';
import { Button } from '@/components/ui/Button';
import { AdminForm, FTextarea } from '@/components/admin/AdminForm';
import { ConfirmAction } from '@/components/admin/ConfirmAction';
import { FilterBar } from '@/components/admin/FilterBar';
import { AdminPageHeader, EmptyRow, Pagination, StatusBadge } from '@/components/admin/ui';
import { applyProposalAction, decideProposalAction } from '../actions';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<SearchParams> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'agents' });
  return { title: t('inbox.title'), robots: { index: false } };
}

type LooseT = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

export default async function ProposalsPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('agents:read', '/admin/agents/proposals');
  const sp = await searchParams;
  const t = await getTranslations('agents');
  const tl = t as unknown as LooseT;
  const ta = await getTranslations('admin');
  const format = await getFormatter();
  const data = await listProposals(sp);
  const canDecide = ctx.can('agents:decide');
  const agentName = (key: string) => {
    const a = AGENTS.find((x) => x.key === key);
    return a ? t(`list.${a.nameKey as 'supervision'}.name`) : key;
  };
  const titleOf = (p: (typeof data.items)[number]) => (p.titleKey && tl.has(`proposals.${p.titleKey}`) ? tl(`proposals.${p.titleKey}`, p.params) : p.title);
  const actionText = (p: (typeof data.items)[number]) => {
    if (!p.action) return null;
    const params = p.action.params;
    const price = typeof params.priceBaisa === 'number' ? formatBaisa(params.priceBaisa, locale) : '';
    return tl(`actionTypes.${p.action.type.replace('.', '_')}`, { price });
  };

  return (
    <>
      <AdminPageHeader
        eyebrow={ta('nav.groups.governance')}
        title={t('inbox.title')}
        subtitle={t('inbox.subtitle')}
        crumbs={[{ label: t('title'), href: '/admin/agents' }, { label: t('inbox.title') }]}
        backHref="/admin/agents"
      />
      <ul className="mb-4 flex flex-wrap gap-2 text-xs" aria-label={t('inbox.openBySeverity')}>
        {SEVERITIES.map((s) => (
          <li key={s}>
            <StatusBadge status={s} label={`${t(`severity.${s}`)} · ${data.openBySeverity[s] ?? 0}`} />
          </li>
        ))}
      </ul>
      <FilterBar
        q={data.q}
        searchLabel={t('inbox.search')}
        selects={[
          { name: 'status', label: t('inbox.status'), value: sp.status === 'ALL' ? 'ALL' : data.status, options: [...PROPOSAL_STATUSES.map((s) => ({ value: s, label: t(`status.${s}`) })), { value: 'ALL', label: t('inbox.allStatuses') }] },
          { name: 'severity', label: t('inbox.severity'), value: data.severity, options: SEVERITIES.map((s) => ({ value: s, label: t(`severity.${s}`) })) },
          { name: 'agent', label: t('inbox.agent'), value: data.agentKey, options: AGENTS.map((a) => ({ value: a.key, label: agentName(a.key) })) },
        ]}
      />
      <p className="mb-3 text-sm text-muted" data-testid="proposals-count">
        {t('inbox.results', { count: data.total })}
      </p>
      {data.items.length === 0 ? (
        <EmptyRow text={t('inbox.empty')} testId="proposals-empty" />
      ) : (
        <ul className="grid gap-4" data-testid="proposals-list">
          {data.items.map((p) => {
            const mayApply = canDecide && !!p.action && !!p.actionPermission && can(ctx.session.user.role, p.actionPermission) && (p.status === 'OPEN' || p.status === 'APPROVED');
            const items = Array.isArray(p.details.items) ? (p.details.items as Record<string, unknown>[]) : null;
            const evidence = Object.fromEntries(Object.entries(p.details).filter(([k]) => !['fp', 'titleKey', 'params', 'action', 'items'].includes(k)));
            return (
              <li key={p.id} className="glass relative min-w-0 rounded-card p-4 sm:p-5" data-testid="proposal" data-agent={p.agentKey} data-severity={p.severity}>
                <HudCorners className={p.severity === 'CRITICAL' || p.severity === 'HIGH' ? 'text-orange/70' : 'text-cyan/40'} size={10} />
                <div className="flex flex-wrap items-center gap-2">
                  <StatusBadge status={p.severity} label={t(`severity.${p.severity}`)} />
                  <StatusBadge status={p.status} label={t(`status.${p.status}`)} />
                  <span className="hud-label text-[10px]">{agentName(p.agentKey)}</span>
                  <span className="ms-auto text-xs text-muted">{format.dateTime(p.createdAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' })}</span>
                </div>
                <h2 className="mt-2 font-display text-base font-bold" data-testid="proposal-title">
                  {titleOf(p)}
                </h2>
                {p.action ? (
                  <p className="mt-1 text-sm">
                    <span className="font-semibold text-accent">{t('inbox.proposedAction')}</span> {actionText(p)}
                    <span className="ms-2 text-xs text-muted">({t('inbox.requires', { permission: p.actionPermission ?? '' })})</span>
                  </p>
                ) : (
                  <p className="mt-1 text-sm text-muted">{t('inbox.alertOnly')}</p>
                )}
                {typeof p.details.llmSummary === 'string' ? (
                  <p className="mt-2 whitespace-pre-line rounded-xl bg-surface-2/60 p-3 text-sm">{p.details.llmSummary}</p>
                ) : null}
                {items && items.length ? (
                  <div className="mt-3 overflow-x-auto rounded-xl border border-border" data-scroll-x>
                    <table className="w-full min-w-max text-xs" dir="ltr">
                      <thead className="bg-surface-2 text-muted">
                        <tr>
                          {Object.keys(items[0]!).map((k) => (
                            <th key={k} scope="col" className="px-3 py-2 text-start font-semibold">
                              {k}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {items.slice(0, 10).map((row, i) => (
                          <tr key={i} className="border-t border-border">
                            {Object.keys(items[0]!).map((k) => (
                              <td key={k} className="px-3 py-1.5 font-mono">
                                {formatCell(row[k])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
                {Object.keys(evidence).length ? (
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer font-semibold text-muted">{t('inbox.evidence')}</summary>
                    <pre className="mt-2 max-h-64 overflow-auto rounded-xl bg-surface-2/60 p-3 font-mono text-[11px] whitespace-pre-wrap break-all" dir="ltr">
                      {JSON.stringify(evidence, null, 2)}
                    </pre>
                  </details>
                ) : null}
                {p.status !== 'OPEN' ? (
                  <p className="mt-3 text-xs text-muted">
                    {t('inbox.decided', { who: p.decidedBy ?? '—', when: p.decidedAt ? format.dateTime(p.decidedAt, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Muscat' }) : '—' })}
                    {p.decisionNote ? ` — ${p.decisionNote}` : ''}
                  </p>
                ) : null}
                {canDecide && (p.status === 'OPEN' || mayApply) ? (
                  <div className="mt-4 grid gap-3 border-t border-border pt-4">
                    {p.status === 'OPEN' ? (
                      <AdminForm
                        action={decideProposalAction}
                        hidden={{ id: p.id }}
                        submitLabel={null}
                        testId="decide-form"
                        footer={
                          <>
                            <Button type="submit" name="decision" value="approve" variant="primary" size="sm" data-testid="proposal-approve">
                              {p.action ? t('inbox.approve') : t('inbox.acknowledge')}
                            </Button>
                            <Button type="submit" name="decision" value="reject" variant="outline" size="sm" data-testid="proposal-reject">
                              {t('inbox.reject')}
                            </Button>
                          </>
                        }
                      >
                        <FTextarea name="note" label={t('inbox.note')} rows={2} maxLength={1000} />
                      </AdminForm>
                    ) : null}
                    {mayApply ? (
                      <ConfirmAction
                        action={applyProposalAction}
                        fields={{ id: p.id, idempotencyKey: randomUUID() }}
                        label={t('inbox.apply')}
                        title={t('inbox.applyTitle')}
                        text={actionText(p) ?? undefined}
                        confirmLabel={t('inbox.applyConfirm')}
                        testId="proposal-apply"
                        variant="accent"
                      />
                    ) : null}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <Pagination page={data.page} pageSize={data.pageSize} total={data.total} basePath="/admin/agents/proposals" sp={sp} />
    </>
  );
}

function formatCell(v: unknown): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}
