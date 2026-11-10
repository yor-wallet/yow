'use client';

import { useState, useTransition } from 'react';
import { AlertTriangle, Minus, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Price } from '@/components/ui/Price';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { CartLineView } from '@/lib/cart';
import { MAX_QTY_PER_LINE } from '@/lib/catalog/stock';
import { productPath } from '@/lib/catalog/paths';
import { formatBaisa } from '@/lib/money';
import { removeCartItemAction, updateCartItemAction } from '@/app/[locale]/(shop)/actions';
import { cartErrorKey } from './ProductCardActions';
import { ShopImage } from './ShopImage';

/** Cart lines with quantity steppers and remove buttons (server actions; prices re-read from the server). */
export function CartLines({ lines }: { lines: CartLineView[] }) {
  return (
    <ul className="flex flex-col gap-3" data-testid="cart-lines">
      {lines.map((l) => (
        <li key={l.itemId ?? l.variantId} className="min-w-0">
          <CartLine line={l} />
        </li>
      ))}
    </ul>
  );
}

function CartLine({ line }: { line: CartLineView }) {
  const t = useTranslations('cart.line');
  const tc = useTranslations('catalog');
  const locale = useLocale();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ok = line.state === 'ok' || line.state === 'qty_reduced';
  const max = Math.max(1, Math.min(line.available, MAX_QTY_PER_LINE));
  const itemId = line.itemId;

  const change = (qty: number) => {
    if (!itemId) return;
    setError(null);
    start(async () => {
      const res = await updateCartItemAction(itemId, qty);
      if (!res.ok) setError(tc(`errors.${cartErrorKey(res.error)}`));
    });
  };
  const remove = () => {
    if (!itemId) return;
    setError(null);
    start(async () => {
      const res = await removeCartItemAction(itemId);
      if (res.ok) toast({ title: t('removed'), description: line.name, variant: 'info', durationMs: 2500 });
      else setError(tc(`errors.${cartErrorKey(res.error)}`));
    });
  };

  return (
    <article
      data-testid="cart-line"
      data-state={line.state}
      aria-busy={pending || undefined}
      className={cn('flex gap-3 rounded-card border border-border bg-surface p-3 shadow-card transition-opacity sm:gap-4 sm:p-4', pending && 'opacity-70', !ok && 'border-dashed')}
    >
      <Link href={productPath(line.slug)} className="block size-24 shrink-0 overflow-hidden rounded-xl bg-surface-2 sm:size-28" aria-hidden="true" tabIndex={-1}>
        {line.image ? <ShopImage src={line.image} width={320} height={320} alt="" sizes="112px" className={cn('size-full object-contain p-1', !ok && 'grayscale')} /> : null}
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            {line.brand ? <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">{line.brand}</p> : null}
            <h3 className="line-clamp-2 text-sm font-semibold leading-snug sm:text-base">
              <Link href={productPath(line.slug)} className="underline-offset-4 hover:underline">
                {line.name}
              </Link>
            </h3>
            {line.variantLabel ? <p className="text-xs text-muted">{line.variantLabel}</p> : null}
          </div>
          <button
            type="button"
            onClick={remove}
            disabled={pending}
            aria-label={t('remove', { name: line.name })}
            data-testid="cart-remove"
            className="-me-1 -mt-1 grid size-11 shrink-0 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-error focus-visible:outline-2 focus-visible:outline-ring disabled:opacity-50"
          >
            <Trash2 size={18} aria-hidden="true" />
          </button>
        </div>

        {line.state === 'qty_reduced' ? (
          <p role="status" className="flex items-start gap-1.5 text-xs font-medium text-amber">
            <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t('state.qty_reduced', { count: line.allowedQty })}
          </p>
        ) : null}
        {line.state === 'out_of_stock' || line.state === 'unavailable' ? (
          <p role="status" className="flex items-center gap-1.5 text-xs font-semibold text-error" data-testid="cart-line-unavailable">
            <AlertTriangle size={14} aria-hidden="true" className="shrink-0" />
            {t(`state.${line.state}`)}
          </p>
        ) : null}

        <div className="mt-auto flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          {ok ? (
            <div role="group" aria-label={t('qty')} className="inline-flex items-center rounded-xl border border-border-strong">
              <button type="button" onClick={() => change(line.allowedQty - 1)} disabled={pending || line.allowedQty <= 1} aria-label={t('decrease', { name: line.name })} className="grid size-11 place-items-center rounded-s-xl transition-colors hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring">
                <Minus size={16} aria-hidden="true" />
              </button>
              <output aria-live="polite" data-testid="cart-qty" className="grid min-w-9 place-items-center text-sm font-bold tabular-nums">
                {line.allowedQty}
              </output>
              <button type="button" onClick={() => change(line.allowedQty + 1)} disabled={pending || line.allowedQty >= max} aria-label={t('increase', { name: line.name })} className="grid size-11 place-items-center rounded-e-xl transition-colors hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring">
                <Plus size={16} aria-hidden="true" />
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="text-end">
            {ok && line.unitPriceBaisa !== null ? (
              <>
                {line.allowedQty > 1 ? <p className="text-xs text-muted [unicode-bidi:isolate]">{t('unit', { price: formatBaisa(line.unitPriceBaisa, locale) })}</p> : null}
                <Price baisa={line.lineTotalBaisa} size="lg" className="justify-end" />
              </>
            ) : null}
          </div>
        </div>
        {error ? (
          <p role="alert" className="text-xs font-medium text-error">
            {error}
          </p>
        ) : null}
      </div>
    </article>
  );
}
