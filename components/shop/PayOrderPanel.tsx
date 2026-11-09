'use client';

import { useEffect, useState, useTransition } from 'react';
import { Check, CreditCard } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatBaisa } from '@/lib/money';
import { payOrderAction } from '@/app/[locale]/orders/actions';
import type { CheckoutMethod } from './CheckoutForm';

const ORDERABLE = ['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO'] as const;
type Orderable = (typeof ORDERABLE)[number];
const isOrderable = (id: string): id is Orderable => (ORDERABLE as readonly string[]).includes(id);
const REASONS = new Set(['not_configured', 'carrier_agreement_required', 'licensed_processor_required', 'login_required', 'insufficient_balance', 'wallet_frozen', 'gift_card_via_wallet', 'flex_apply_from_product', 'amount_below_minimum', 'amount_above_maximum']);
const ERRORS = new Set(['invalid_input', 'invalid_amount', 'amount_below_minimum', 'amount_above_maximum', 'method_unavailable', 'idempotency_key_reused', 'idempotency_conflict', 'insufficient_balance', 'wallet_frozen', 'not_found', 'forbidden', 'order_not_payable', 'order_already_paid', 'provider_unavailable', 'provider_error']);

/** Pay (or retry paying) an unpaid order. One idempotency key per (order, method): retries and double taps never pay twice. */
export function PayOrderPanel({ number, totalBaisa, methods, expiresAt }: { number: string; totalBaisa: number; methods: CheckoutMethod[]; expiresAt: string }) {
  const t = useTranslations('payments');
  const locale = useLocale();
  const first = methods.find((m) => m.available && isOrderable(m.id))?.id ?? null;
  const [method, setMethod] = useState<string | null>(first);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [time, setTime] = useState('');
  useEffect(() => {
    setTime(new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Muscat', numberingSystem: 'latn' }).format(new Date(expiresAt)));
  }, [expiresAt, locale]);

  const options = methods.filter((m) => isOrderable(m.id));
  const chosen = options.find((m) => m.id === method && m.available)?.id ?? first;

  const keyFor = (m: string) => {
    const storageKey = `doom:pay:${number}:${m}`;
    try {
      let k = sessionStorage.getItem(storageKey);
      if (!k) {
        k = crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(storageKey, k);
      }
      return k;
    } catch {
      return crypto.randomUUID().replace(/-/g, '');
    }
  };

  const pay = () => {
    if (!chosen || !isOrderable(chosen)) return;
    setError(null);
    startPay(chosen);
  };
  const startPay = (m: Orderable) =>
    start(async () => {
      const res = await payOrderAction({ number, method: m, idempotencyKey: keyFor(m) });
      if (res && !res.ok) setError(res.error); // success redirects
    });

  return (
    <section aria-labelledby="pay-title" className="flex flex-col gap-3 rounded-card border border-amber/50 bg-surface p-4 shadow-card sm:p-5" data-testid="pay-panel">
      <h2 id="pay-title" className="flex items-center gap-2 text-lg font-bold">
        <CreditCard size={20} aria-hidden="true" className="text-amber" />
        {t('pay.title')}
      </h2>
      <p className="text-sm text-muted">{t('pay.text', { time })}</p>
      <ul role="radiogroup" aria-labelledby="pay-title" className="grid grid-cols-1 gap-3 md:grid-cols-2">
        {options.map((m) => {
          const on = chosen === m.id;
          return (
            <li key={m.id}>
              <button
                type="button"
                role="radio"
                aria-checked={on}
                disabled={!m.available}
                onClick={() => setMethod(m.id)}
                data-testid={`pay-method-${m.id.toLowerCase()}`}
                className={cn(
                  'flex h-full w-full flex-col gap-1 rounded-card border p-4 text-start transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
                  on ? 'border-blue bg-blue/8 shadow-glow-blue' : 'border-border bg-surface enabled:hover:border-border-strong',
                )}
              >
                <span className="flex items-center justify-between gap-2 font-semibold">
                  {t(`methods.${m.id as Orderable}.label`)}
                  {on ? <Check size={18} aria-hidden="true" className="text-accent" /> : null}
                </span>
                <span className="text-sm text-muted">{m.available ? t(`methods.${m.id as Orderable}.description`) : m.reason && REASONS.has(m.reason) ? t(`reasons.${m.reason as 'not_configured'}`) : t('reasons.not_configured')}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {error ? (
        <p role="alert" className="text-sm font-medium text-error" data-testid="pay-error">
          {ERRORS.has(error) ? t(`errors.${error as 'not_found'}`) : t('errors.generic')}
        </p>
      ) : null}
      <Button type="button" size="lg" disabled={!chosen} loading={pending} loadingLabel={t('pay.paying')} onClick={pay} data-testid="pay-button">
        {t('pay.button', { amount: formatBaisa(totalBaisa, locale) })}
      </Button>
    </section>
  );
}
