'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import { FileUp } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import type { ActionState } from '@/lib/admin/action';
import type { ImportPreview } from '@/lib/admin/variant-pricing';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import { useAdminAction } from './useAdminAction';

type LooseT = ((key: string, values?: Record<string, string | number>) => string) & { has: (key: string) => boolean };

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}-import`;
}

/**
 * CSV import of variant prices & stock: load or paste a file, run a DRY RUN (nothing is written),
 * review every change and every refused row, then apply the whole file atomically.
 */
export function VariantImport({
  previewAction,
  applyAction,
}: {
  previewAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  applyAction: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const t = useTranslations('admin.pricing') as unknown as LooseT;
  const locale = useLocale();
  const [csv, setCsv] = useState('');
  const [checked, setChecked] = useState<string | null>(null);
  const [key, setKey] = useState(newKey);
  const preview = useAdminAction(previewAction, { refresh: false });
  const apply = useAdminAction(applyAction, {
    onSuccess: () => {
      setChecked(null);
      setKey(newKey());
    },
  });
  const data = checked !== null && checked === csv && preview.state.status === 'success' ? (preview.state.data as unknown as ImportPreview) : null;

  useEffect(() => {
    if (preview.state.status === 'success') setChecked(csv);
    // only when a new preview arrives
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [preview.state.at]);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      setCsv('');
      return;
    }
    setCsv(await file.text());
  };

  const money = (v: number | null | undefined) => (v === null || v === undefined ? '—' : formatBaisa(v, locale));
  const err = (code: string) => (t.has(`errors.${code}`) ? t(`errors.${code}`) : code);

  return (
    <div className="grid gap-5">
      <form action={preview.formAction} onSubmit={preview.onSubmit} className="grid gap-4" data-testid="import-form">
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          <span className="inline-flex items-center gap-2">
            <FileUp size={16} aria-hidden="true" />
            {t('importFile')}
          </span>
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={onFile}
            className="block w-full min-w-0 rounded-xl border border-dashed border-border-strong bg-surface p-3 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:font-semibold file:text-fg"
            data-testid="import-file"
          />
        </label>
        <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
          <span>{t('importPaste')}</span>
          <textarea
            name="csv"
            value={csv}
            onChange={(e) => setCsv(e.target.value)}
            rows={8}
            dir="ltr"
            spellCheck={false}
            placeholder={'sku,priceOmr,compareAtOmr,costOmr,stock\nIPHONE-16-128-BLK,329.000,,290.500,12'}
            className="block w-full min-w-0 rounded-xl border border-border bg-surface p-3 font-mono text-sm"
            data-testid="import-csv"
          />
          <span className="text-xs font-normal text-muted">{t('importRules')}</span>
        </label>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" variant="primary" loading={preview.pending} disabled={!csv.trim()} data-testid="import-check">
            {t('importCheck')}
          </Button>
        </div>
      </form>

      {data ? (
        <section className="grid gap-4" aria-live="polite" data-testid="import-preview">
          {data.fileError ? (
            <p className="rounded-xl border border-error/50 bg-error/10 p-3 text-sm font-semibold text-error" role="alert" data-testid="import-file-error">
              {err(data.fileError)}
            </p>
          ) : (
            <>
              <ul className="flex flex-wrap gap-2 text-sm">
                <li>
                  <Badge variant="neutral">{t('summary.total', { count: data.total })}</Badge>
                </li>
                <li>
                  <Badge variant="info" data-testid="import-changes">{t('summary.changes', { count: data.changes })}</Badge>
                </li>
                <li>
                  <Badge variant="neutral">{t('summary.unchanged', { count: data.unchanged })}</Badge>
                </li>
                <li>
                  <Badge variant={data.errors ? 'error' : 'success'} data-testid="import-errors">{t('summary.errors', { count: data.errors })}</Badge>
                </li>
              </ul>
              {data.rows.length ? (
                <div className="overflow-x-auto rounded-xl border border-border" data-scroll-x>
                  <table className="w-full min-w-max text-sm">
                    <thead className="bg-surface-2 text-xs uppercase tracking-wide text-muted">
                      <tr>
                        <th scope="col" className="px-3 py-2 text-start">{t('columns.line')}</th>
                        <th scope="col" className="px-3 py-2 text-start">SKU</th>
                        <th scope="col" className="px-3 py-2 text-start">{t('columns.price')}</th>
                        <th scope="col" className="px-3 py-2 text-start">{t('columns.compareAt')}</th>
                        <th scope="col" className="px-3 py-2 text-start">{t('columns.cost')}</th>
                        <th scope="col" className="px-3 py-2 text-start">{t('columns.stock')}</th>
                        <th scope="col" className="px-3 py-2 text-start">{t('columns.result')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.rows.map((r) => {
                        const diff = (b: number | null | undefined, a: number | null | undefined, fmt: (v: number | null | undefined) => string) =>
                          b === a ? <span className="text-muted">{fmt(a)}</span> : (
                            <span>
                              <span className="text-muted line-through">{fmt(b)}</span> → <strong>{fmt(a)}</strong>
                            </span>
                          );
                        return (
                          <tr key={`${r.line}-${r.sku}`} className={cn('border-t border-border', r.status === 'error' && 'bg-error/5')} data-testid="import-row" data-status={r.status}>
                            <td className="px-3 py-2 tabular-nums">{r.line}</td>
                            <td className="px-3 py-2 font-mono text-xs" dir="ltr">{r.sku || '—'}</td>
                            <td className="px-3 py-2 tabular-nums">{r.before && r.after ? diff(r.before.price, r.after.price, money) : '—'}</td>
                            <td className="px-3 py-2 tabular-nums">{r.before && r.after ? diff(r.before.compareAt, r.after.compareAt, money) : '—'}</td>
                            <td className="px-3 py-2 tabular-nums">{r.before && r.after ? diff(r.before.cost, r.after.cost, money) : '—'}</td>
                            <td className="px-3 py-2 tabular-nums">{r.before && r.after ? diff(r.before.stock, r.after.stock, (v) => (v === null || v === undefined ? '—' : String(v))) : '—'}</td>
                            <td className="px-3 py-2">
                              {r.status === 'error' ? (
                                <span className="text-error">{r.errors.map(err).join(' · ')}</span>
                              ) : (
                                <Badge variant="info">{t('willChange')}</Badge>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : null}
              {data.ok && data.changes > 0 ? (
                <form action={apply.formAction} onSubmit={apply.onSubmit} className="flex flex-wrap items-center gap-3">
                  <input type="hidden" name="csv" value={csv} />
                  <input type="hidden" name="idempotencyKey" value={key} />
                  <Button type="submit" variant="accent" loading={apply.pending} data-testid="import-apply">
                    {t('importApply', { count: data.changes })}
                  </Button>
                  <span className="text-xs text-muted">{t('importApplyHint')}</span>
                </form>
              ) : (
                <p className="text-sm text-muted" data-testid="import-blocked">
                  {data.errors ? t('importFixErrors') : t('importNothing')}
                </p>
              )}
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}
