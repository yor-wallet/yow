import { useLocale, useTranslations } from 'next-intl';
import type { PromotionView } from '@/lib/catalog/cache';
import { formatBaisa } from '@/lib/money';
import { CopyCodeButton } from './CopyCodeButton';
import { Countdown } from './Countdown';

/**
 * A live promotion drawn as a coupon: the discount on the stub, the conditions on the body, a
 * perforation between the two. Every value comes from the promotion record that the order engine applies
 * (nothing is decorative: no invented "was" price, no fake urgency — the clock is the real end date).
 */
export function PromotionTicket({ promotion: p, compact = false }: { promotion: PromotionView; compact?: boolean }) {
  const t = useTranslations('home.promoCard');
  const tc = useTranslations('catalog.promotions');
  const locale = useLocale();
  const scope = [...p.scope.categories, ...p.scope.brands];
  const value = p.type === 'PERCENT' ? t('percent', { value: Number((p.value / 100).toFixed(2)) }) : t('fixed', { amount: formatBaisa(p.value, locale, { trimWhole: true }) });
  return (
    <article className="promo-ticket group flex h-full overflow-hidden rounded-card border border-border bg-surface shadow-card" data-testid="promotion-ticket">
      <div className="relative flex w-[36%] min-w-28 max-w-44 shrink-0 flex-col items-center justify-center gap-1.5 overflow-hidden bg-yellow p-3 text-center text-night">
        <span className="font-display text-3xl font-extrabold leading-none [unicode-bidi:isolate] sm:text-4xl" data-testid="promotion-value">
          {value}
        </span>
        <span className="text-[0.7rem] font-semibold leading-tight">{p.code ? t('withCode') : t('auto')}</span>
        <span aria-hidden="true" className="promo-shine" />
      </div>
      <div aria-hidden="true" className="promo-perf" />
      <div className="flex min-w-0 flex-1 flex-col gap-2 p-4">
        <h3 className="font-bold leading-snug">{p.name}</h3>
        {p.description && !compact ? <p className="text-sm text-muted">{p.description}</p> : null}
        <p className="text-sm">
          <span className="text-muted">{tc('appliesTo')} </span>
          {p.scope.products > 0 ? tc('productsCount', { count: p.scope.products }) : scope.length > 0 ? scope.join(' · ') : tc('everything')}
        </p>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          {p.minSubtotalBaisa ? <span>{t('minSpend', { amount: formatBaisa(p.minSubtotalBaisa, locale, { trimWhole: true }) })}</span> : null}
          {p.maxDiscountBaisa ? <span>{tc('maxDiscount', { amount: formatBaisa(p.maxDiscountBaisa, locale, { trimWhole: true }) })}</span> : null}
        </p>
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 pt-1">
          {p.endsAt ? <Countdown endsAt={p.endsAt} /> : <span />}
          {p.code ? (
            <span className="flex items-center gap-2">
              <span className="rounded-lg border border-dashed border-border-strong bg-surface-2 px-2.5 py-1 font-mono text-sm font-bold tracking-wider" dir="ltr" data-testid="promotion-code">
                {p.code}
              </span>
              <CopyCodeButton code={p.code} />
            </span>
          ) : null}
        </div>
      </div>
    </article>
  );
}
