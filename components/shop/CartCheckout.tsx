'use client';

import { useState } from 'react';
import { Coins, CreditCard, Smartphone, Truck, Wallet, Zap, type LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { DeliverTo, type AreaChoice } from '@/components/layout/DeliverTo';
import { cn } from '@/lib/cn';
import type { CartTotals } from '@/lib/cart/math';
import type { CartPreview } from '@/lib/cart/preview';
import { formatBaisa } from '@/lib/money';
import { CartSummary } from './CartSummary';

type DeliveryType = 'STANDARD' | 'EXPRESS';

/** Neutral icons only: third-party marks are never redrawn. */
const METHOD_ICON: Record<string, LucideIcon> = { WALLET: Wallet, CARD: CreditCard, OOREDOO: Smartphone, OMANTEL: Smartphone, CRYPTO: Coins };

/**
 * Right-hand side of the cart: delivery method (quoted for the shopper's area), the payment methods that are
 * really usable, then the order summary. The delivery choice is carried to checkout in the URL; checkout
 * re-quotes it against the chosen address, so nothing here is trusted or final.
 */
export function CartCheckout({
  totals,
  hasUnavailable,
  preview,
  areaOptions,
  area,
}: {
  totals: CartTotals;
  hasUnavailable: boolean;
  preview: CartPreview;
  areaOptions: AreaChoice[];
  area: AreaChoice | null;
}) {
  const t = useTranslations('cart');
  const tq = useTranslations('delivery.quote.reasons');
  const tp = useTranslations('payments');
  const locale = useLocale();
  const options = preview.delivery;
  const firstAvailable = options?.find((o) => o.available)?.type ?? null;
  const [choice, setChoice] = useState<DeliveryType | null>(firstAvailable);
  const selected = options?.find((o) => o.type === choice && o.available) ?? null;
  const standardFee = options?.find((o) => o.type === 'STANDARD' && o.available)?.feeBaisa ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-5 lg:sticky lg:top-24 lg:h-fit">
      <section aria-labelledby="cart-delivery-title" data-testid="cart-delivery">
        <h2 id="cart-delivery-title" className="flex items-center gap-2 text-lg font-bold">
          <Truck size={22} aria-hidden="true" className="flip-rtl" />
          {t('delivery.title')}
        </h2>
        <DeliverTo options={areaOptions} current={area} className="-ms-2 mt-1" />
        {options === null ? (
          <p className="mt-1 rounded-2xl border border-dashed border-border-strong p-3 text-sm text-muted" data-testid="cart-delivery-choose">
            {t('delivery.chooseArea')}
          </p>
        ) : (
          <>
            <ul className="mt-2 flex flex-col gap-2" role="radiogroup" aria-labelledby="cart-delivery-title">
              {options.map((o) => {
                const on = choice === o.type && o.available;
                const Icon = o.type === 'EXPRESS' ? Zap : Truck;
                const extra = o.type === 'EXPRESS' && o.feeBaisa !== null && standardFee !== null && o.feeBaisa > standardFee;
                return (
                  <li key={o.type}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!o.available}
                      onClick={() => setChoice(o.type)}
                      data-testid={`cart-delivery-${o.type.toLowerCase()}`}
                      className={cn(
                        'flex min-h-14 w-full items-center gap-3 rounded-2xl border px-4 py-2.5 text-start transition-[background-color,border-color,box-shadow] duration-(--dur-btn) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        on ? 'border-blue bg-blue/8 shadow-glow-blue' : 'border-border bg-surface',
                        o.available ? 'hover:border-border-strong' : 'opacity-70',
                      )}
                    >
                      <Icon size={24} aria-hidden="true" className={cn('shrink-0', o.type === 'EXPRESS' ? 'text-orange' : 'flip-rtl text-accent')} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-bold">
                          {t(`delivery.${o.type}`)}
                          {o.etaHours !== null ? <span> · {t('delivery.eta', { hours: o.etaHours })}</span> : null}
                        </span>
                        <span className="block text-sm text-muted">
                          {!o.available
                            ? o.reason
                              ? tq(o.reason)
                              : t('delivery.unavailable')
                            : o.feeBaisa === 0
                              ? t('delivery.free')
                              : o.feeBaisa !== null
                                ? `${extra ? `${t('delivery.extraFee')} · ` : ''}${formatBaisa(o.feeBaisa, locale)}`
                                : null}
                        </span>
                      </span>
                      <span aria-hidden="true" className={cn('grid size-6 shrink-0 place-items-center rounded-full border-2', on ? 'border-blue' : 'border-border-strong')}>
                        {on ? <span className="size-3 rounded-full bg-blue" /> : null}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-2 text-xs text-muted">{t('delivery.note')}</p>
          </>
        )}
      </section>

      <section aria-labelledby="cart-payment-title" data-testid="cart-payment">
        <h2 id="cart-payment-title" className="flex items-center gap-2 text-lg font-bold">
          <CreditCard size={22} aria-hidden="true" />
          {t('payment.title')}
        </h2>
        <ul className="mt-2 grid grid-cols-3 gap-2 xs:grid-cols-5 xs:gap-1.5 lg:grid-cols-3 lg:gap-2">
          {preview.payments.map((m) => {
            const Icon = METHOD_ICON[m.id] ?? CreditCard;
            return (
              <li
                key={m.id}
                title={m.available || !m.reason ? undefined : tp(`reasons.${m.reason}`)}
                data-testid={`cart-method-${m.id.toLowerCase()}`}
                data-available={m.available}
                className={cn('flex min-h-20 min-w-0 flex-col items-center justify-center gap-1 rounded-2xl border border-border bg-surface px-1 py-2 text-center', !m.available && 'opacity-60')}
              >
                <Icon size={24} aria-hidden="true" className={m.available ? 'text-accent' : 'text-muted'} />
                <span className="line-clamp-2 text-[11px] font-semibold leading-tight">{tp(`methods.${m.id}.label`)}</span>
                {m.available ? null : <span className="text-[10px] font-medium text-muted">{t('payment.unavailable')}</span>}
              </li>
            );
          })}
        </ul>
        <p className="mt-2 text-xs text-muted">{t('payment.hint')}</p>
      </section>

      <CartSummary
        totals={totals}
        hasUnavailable={hasUnavailable}
        checkoutHref={selected ? `/checkout?delivery=${selected.type}` : '/checkout'}
        deliveryFeeBaisa={selected ? selected.feeBaisa : null}
      />
    </div>
  );
}
