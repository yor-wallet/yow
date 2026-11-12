'use client';

import { useMemo, useState } from 'react';
import { CopyCheck, Layers } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { controlClasses } from '@/components/ui/Input';
import type { ActionState } from '@/lib/admin/action';
import { cn } from '@/lib/cn';
import { AdminForm, FInput, useFormCtx } from './AdminForm';

export type GridRow = {
  id: string;
  sku: string;
  label: string;
  colorHex: string | null;
  capacity: string;
  price: string;
  compareAt: string;
  cost: string;
  stock: string;
  reserved: number;
  isActive: boolean;
};

type Field = 'price' | 'compareAt' | 'cost' | 'stock';

function Cell({ i, field, value, onChange, disabled, label, money }: { i: number; field: Field; value: string; onChange: (v: string) => void; disabled: boolean; label: string; money?: boolean }) {
  const { fieldError } = useFormCtx();
  const err = fieldError(`rows.${i}.${field}`);
  const id = `grid-${i}-${field}`;
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <label htmlFor={id} className="text-xs font-semibold text-muted md:sr-only">
        {label}
      </label>
      <div className="relative">
        <input
          id={id}
          name={disabled ? undefined : `rows.${i}.${field}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          inputMode={money ? 'decimal' : 'numeric'}
          dir="ltr"
          autoComplete="off"
          placeholder={money ? '—' : '0'}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          className={cn(controlClasses, 'min-h-11 px-2.5 py-2 tabular-nums', err ? 'border-error' : 'border-border', money ? 'pe-11' : '')}
          data-testid={`grid-${field}-${i}`}
        />
        {money ? <span className="pointer-events-none absolute inset-y-0 end-2 flex items-center text-[11px] font-semibold text-muted">OMR</span> : null}
      </div>
      {err ? (
        <span id={`${id}-err`} role="alert" className="text-xs font-medium text-error">
          {err}
        </span>
      ) : null}
    </div>
  );
}

/**
 * Quick price & stock entry for every variant of a product, with bulk fill:
 * "same capacity" copies the row's price / previous price / cost to the variants with the same
 * capacity, "all variants" to every variant. Nothing is saved until "Save changes"; the server
 * re-validates every row, audits each change and records a stock movement for each stock change.
 * An empty price means "not decided yet" (the variant cannot be bought).
 */
export function VariantPriceGrid({
  productId,
  rows,
  canPrice,
  canStock,
  action,
}: {
  productId: string;
  rows: GridRow[];
  canPrice: boolean;
  canStock: boolean;
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
}) {
  const t = useTranslations('admin.pricing');
  const [values, setValues] = useState(() => rows.map((r) => ({ price: r.price, compareAt: r.compareAt, cost: r.cost, stock: r.stock })));
  const dirty = useMemo(() => rows.map((r, i) => (['price', 'compareAt', 'cost', 'stock'] as const).some((f) => (values[i]?.[f] ?? '') !== r[f])), [rows, values]);
  const dirtyCount = dirty.filter(Boolean).length;
  const stockDirty = rows.some((r, i) => values[i]?.stock !== r.stock);

  const set = (i: number, f: Field, v: string) => setValues((list) => list.map((row, j) => (j === i ? { ...row, [f]: v } : row)));
  const fill = (from: number, scope: 'capacity' | 'all') => {
    const src = values[from]!;
    const cap = rows[from]!.capacity.trim().toLowerCase();
    setValues((list) =>
      list.map((row, j) => (scope === 'all' || rows[j]!.capacity.trim().toLowerCase() === cap ? { ...row, price: src.price, compareAt: src.compareAt, cost: src.cost } : row)),
    );
  };
  const sameCap = (i: number) => rows.filter((r) => r.capacity.trim().toLowerCase() === rows[i]!.capacity.trim().toLowerCase()).length;

  if (rows.length === 0) return <p className="text-sm text-muted">{t('noVariants')}</p>;

  return (
    <AdminForm
      key={JSON.stringify(rows)}
      action={action}
      hidden={{ productId }}
      submitLabel={dirtyCount ? t('saveCount', { count: dirtyCount }) : t('save')}
      submitVariant="accent"
      testId="variant-grid"
    >
      <div className="hidden grid-cols-[minmax(10rem,1.3fr)_repeat(4,minmax(7.5rem,1fr))_auto] gap-3 px-1 text-xs font-semibold uppercase tracking-wide text-muted md:grid">
        <span>{t('columns.variant')}</span>
        <span>{t('columns.price')}</span>
        <span>{t('columns.compareAt')}</span>
        <span>{t('columns.cost')}</span>
        <span>{t('columns.stock')}</span>
        <span className="sr-only">{t('columns.bulk')}</span>
      </div>
      <ul className="grid gap-3" data-testid="grid-rows">
        {rows.map((r, i) => (
          <li
            key={r.id}
            className={cn(
              'grid grid-cols-2 items-start gap-3 rounded-2xl border p-3 md:grid-cols-[minmax(10rem,1.3fr)_repeat(4,minmax(7.5rem,1fr))_auto] md:rounded-xl md:p-2',
              dirty[i] ? 'border-blue bg-blue/5' : 'border-border',
            )}
            data-testid="grid-row"
            data-sku={r.sku}
          >
            <input type="hidden" name={`rows.${i}.id`} value={r.id} />
            <div className="col-span-2 flex min-w-0 items-center gap-2 md:col-span-1 md:min-h-11">
              {r.colorHex ? <span aria-hidden="true" className="size-4 shrink-0 rounded-full border border-border-strong" style={{ background: r.colorHex }} /> : null}
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{r.label}</p>
                <p className="truncate font-mono text-xs text-muted" dir="ltr">
                  {r.sku}
                </p>
              </div>
              <div className="ms-auto flex shrink-0 gap-1 md:hidden">
                {!r.isActive ? <Badge>{t('inactive')}</Badge> : null}
                {r.price === '' ? <Badge variant="secondary">{t('noPrice')}</Badge> : null}
              </div>
            </div>
            <Cell i={i} field="price" label={t('columns.price')} money value={values[i]!.price} onChange={(v) => set(i, 'price', v)} disabled={!canPrice} />
            <Cell i={i} field="compareAt" label={t('columns.compareAt')} money value={values[i]!.compareAt} onChange={(v) => set(i, 'compareAt', v)} disabled={!canPrice} />
            <Cell i={i} field="cost" label={t('columns.cost')} money value={values[i]!.cost} onChange={(v) => set(i, 'cost', v)} disabled={!canPrice} />
            <div>
              <Cell i={i} field="stock" label={t('columns.stock')} value={values[i]!.stock} onChange={(v) => set(i, 'stock', v)} disabled={!canStock} />
              {r.reserved > 0 ? <p className="mt-1 text-xs text-muted">{t('reserved', { count: r.reserved })}</p> : null}
            </div>
            {canPrice ? (
              <div className="col-span-2 flex flex-wrap gap-1 md:col-span-1 md:flex-nowrap">
                <button
                  type="button"
                  onClick={() => fill(i, 'capacity')}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border-strong px-3 text-xs font-semibold hover:bg-surface-2"
                  title={t('fillCapacityHint', { count: sameCap(i), capacity: r.capacity || '—' })}
                  data-testid={`fill-capacity-${i}`}
                >
                  <Layers size={14} aria-hidden="true" />
                  <span>{t('fillCapacity')}</span>
                </button>
                <button
                  type="button"
                  onClick={() => fill(i, 'all')}
                  className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-border-strong px-3 text-xs font-semibold hover:bg-surface-2"
                  title={t('fillAllHint', { count: rows.length })}
                  data-testid={`fill-all-${i}`}
                >
                  <CopyCheck size={14} aria-hidden="true" />
                  <span>{t('fillAll')}</span>
                </button>
              </div>
            ) : null}
          </li>
        ))}
      </ul>
      {canStock && stockDirty ? <FInput name="reason" label={t('reason')} hint={t('reasonHint')} maxLength={200} /> : null}
      <p className="text-xs text-muted" aria-live="polite" data-testid="grid-pending">
        {dirtyCount ? t('pending', { count: dirtyCount }) : t('hint')}
      </p>
    </AdminForm>
  );
}

