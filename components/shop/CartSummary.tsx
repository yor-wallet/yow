'use client';

import { useState, useTransition } from 'react';
import { CreditCard, FileText, Lock } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Button, buttonClasses } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import type { CartTotals } from '@/lib/cart/math';
import { formatBaisa } from '@/lib/money';
import { removeUnavailableItemsAction } from '@/app/[locale]/(shop)/actions';

/** Order summary: totals as computed by the server, checkout link, and the "remove unavailable" shortcut. */
export function CartSummary({
  totals,
  hasUnavailable,
  checkoutHref = '/checkout',
  deliveryFeeBaisa = null,
}: {
  totals: CartTotals;
  hasUnavailable: boolean;
  checkoutHref?: string;
  /** Estimated delivery fee for the chosen method (shown on its own line; the total stays the products total). */
  deliveryFeeBaisa?: number | null;
}) {
  const t = useTranslations('cart');
  const locale = useLocale();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const [failed, setFailed] = useState(false);
  const blocked = !totals.checkoutReady;

  return (
    <aside className="flex flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5" aria-labelledby="cart-summary-title" data-testid="cart-summary">
      <h2 id="cart-summary-title" className="flex items-center gap-2 text-lg font-bold">
        <FileText size={22} aria-hidden="true" />
        {t('summary.title')}
      </h2>
      <dl className="flex flex-col gap-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted">{t('summary.subtotal')}</dt>
          <dd className="font-semibold tabular-nums [unicode-bidi:isolate]" data-testid="cart-subtotal">
            {formatBaisa(totals.subtotalBaisa, locale)}
          </dd>
        </div>
        {totals.discountBaisa > 0 ? (
          <div className="flex items-center justify-between gap-3 text-success">
            <dt>{t('summary.discount')}</dt>
            <dd className="font-semibold tabular-nums [unicode-bidi:isolate]" data-testid="cart-discount">
              −{formatBaisa(totals.discountBaisa, locale)}
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 border-t border-border pt-3 text-base">
          <dt className="font-bold">{t('summary.total')}</dt>
          <dd className="text-2xl font-extrabold tabular-nums text-price [unicode-bidi:isolate]" data-testid="cart-total">
            {formatBaisa(totals.totalBaisa, locale)}
          </dd>
        </div>
      </dl>
      {totals.discountBaisa > 0 ? <p className="text-sm font-medium text-success">{t('summary.savings', { amount: formatBaisa(totals.discountBaisa, locale) })}</p> : null}
      {deliveryFeeBaisa !== null ? (
        <p className="flex items-center justify-between gap-3 text-sm text-muted">
          <span>+ {t('summary.delivery')}</span>
          <span className="font-semibold tabular-nums text-fg [unicode-bidi:isolate]" data-testid="cart-delivery-fee">
            {deliveryFeeBaisa === 0 ? t('delivery.free') : formatBaisa(deliveryFeeBaisa, locale)}
          </span>
        </p>
      ) : (
        <p className="text-xs text-muted">{t('summary.deliveryNote')}</p>
      )}

      {blocked ? (
        <div className="flex flex-col gap-2">
          <p role="status" className="text-sm font-medium text-amber">
            {t('checkoutBlocked')}
          </p>
          {hasUnavailable ? (
            <Button
              type="button"
              variant="outline"
              loading={pending}
              onClick={() =>
                start(async () => {
                  const res = await removeUnavailableItemsAction();
                  setFailed(!res.ok);
                  if (res.ok) toast({ title: t('removedUnavailable', { count: res.removed }), variant: 'info', durationMs: 3000 });
                })
              }
              data-testid="remove-unavailable"
            >
              {t('removeUnavailable')}
            </Button>
          ) : null}
          {failed ? (
            <p role="alert" className="text-xs font-medium text-error">
              {t('errors.generic')}
            </p>
          ) : null}
        </div>
      ) : null}

      <Link
        href={checkoutHref}
        aria-disabled={blocked || undefined}
        tabIndex={blocked ? -1 : undefined}
        onClick={(e) => blocked && e.preventDefault()}
        className={cn(buttonClasses({ variant: 'accent', size: 'lg', fullWidth: true }))}
        data-testid="go-checkout"
      >
        <CreditCard size={20} aria-hidden="true" />
        {t('checkout')}
      </Link>
      <p className="flex items-center justify-center gap-1.5 text-xs text-muted">
        <Lock size={12} aria-hidden="true" />
        {t('secure')}
      </p>
      <p className="text-xs text-muted">{t('flexHint')}</p>
    </aside>
  );
}
