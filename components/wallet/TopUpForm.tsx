'use client';

import { useId, useState, useTransition, type FormEvent } from 'react';
import { CircleAlert, CreditCard, Gift, Lock, Smartphone, Bitcoin, ChevronRight } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { formatBaisa, parseOmrToBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import type { PaymentMethodOption } from '@/lib/payments/types';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { topUpAction } from '@/app/[locale]/wallet/actions';

const ICONS: Record<string, LucideIcon> = { CARD: CreditCard, OOREDOO: Smartphone, OMANTEL: Smartphone, CRYPTO: Bitcoin, GIFT_CARD: Gift };
const QUICK_OMR = [5, 10, 20, 50];

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
}

export function TopUpForm({ methods, minBaisa, maxBaisa }: { methods: PaymentMethodOption[]; minBaisa: number; maxBaisa: number }) {
  const t = useTranslations('wallet.topUp');
  const tp = useTranslations('payments');
  const locale = useLocale();
  const router = useRouter();
  const amountId = useId();
  const external = methods.filter((m) => m.id !== 'GIFT_CARD');
  const available = external.filter((m) => m.available);
  const [method, setMethod] = useState<string | null>(available[0]?.id ?? null);
  const [amount, setAmount] = useState('');
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [redirecting, setRedirecting] = useState(false);
  const [pending, start] = useTransition();

  const amountBaisa = amount ? parseOmrToBaisa(amount, locale) : null;
  const amountError =
    amount && (amountBaisa === null || amountBaisa < minBaisa || amountBaisa > maxBaisa) ? t('amountInvalid') : null;

  const errorText = (code: string) =>
    code === 'invalid_amount' ? t('amountInvalid') : tp.has(`errors.${code}` as never) ? tp(`errors.${code as 'generic'}`) : tp('errors.generic');

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!method || amountBaisa === null || amountError) {
      setError(amountError ? 'invalid_amount' : 'invalid_input');
      return;
    }
    setError(null);
    start(async () => {
      const res = await topUpAction({ methodId: method, amount, idempotencyKey: key });
      if (!res.ok) {
        setError(res.error);
        setKey(newKey()); // a failed attempt must not block a retry
        return;
      }
      if (res.redirectUrl) {
        setRedirecting(true);
        window.location.assign(res.redirectUrl);
        return;
      }
      router.push(`/pay/${res.intentId}`);
    });
  };

  const giftCard = methods.find((m) => m.id === 'GIFT_CARD');

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" data-testid="topup-form" noValidate>
      <div className="grid grid-cols-1 gap-3">
        <Input
          id={amountId}
          name="amount"
          label={t('amountLabel')}
          hint={t('amountHint', { min: formatBaisa(minBaisa, locale), max: formatBaisa(maxBaisa, locale) })}
          error={amountError ?? undefined}
          inputMode="decimal"
          autoComplete="off"
          placeholder="10.000"
          value={amount}
          onChange={(e) => {
            setAmount(e.target.value);
            setKey(newKey());
          }}
          className="font-display text-lg tabular-nums"
          dir="ltr"
          required
          disabled={available.length === 0}
        />
        <div className="flex flex-wrap gap-2" role="group" aria-label={t('quick')}>
          {QUICK_OMR.filter((v) => v * 1000 >= minBaisa && v * 1000 <= maxBaisa).map((v) => (
            <button
              key={v}
              type="button"
              disabled={available.length === 0}
              onClick={() => {
                setAmount(`${v}.000`);
                setKey(newKey());
              }}
              className={cn(
                'min-h-11 rounded-pill border px-4 font-display text-sm font-semibold tabular-nums transition-colors duration-(--dur-btn) disabled:opacity-50',
                amountBaisa === v * 1000 ? 'border-cyan bg-cyan/10 text-fg shadow-glow-cyan' : 'border-border bg-surface/60 text-muted hover:text-fg',
              )}
            >
              {formatBaisa(v * 1000, locale, { trimWhole: true })}
            </button>
          ))}
        </div>
      </div>

      <fieldset className="min-w-0">
        <legend className="mb-3 text-sm font-medium text-fg">{t('methodLabel')}</legend>
        <div className="grid grid-cols-1 gap-2.5">
          {external.map((m) => {
            const Icon = ICONS[m.id] ?? CreditCard;
            const checked = method === m.id;
            return (
              <label
                key={m.id}
                data-testid={`topup-method-${m.id}`}
                data-available={m.available}
                className={cn(
                  'relative flex min-h-16 items-start gap-3 rounded-2xl border p-3.5 transition-[border-color,box-shadow] duration-(--dur-btn) sm:p-4',
                  m.available ? 'cursor-pointer bg-surface/70' : 'cursor-not-allowed bg-surface/40 opacity-70',
                  checked ? 'border-cyan shadow-glow-cyan' : 'border-border',
                )}
              >
                <input
                  type="radio"
                  name="method"
                  value={m.id}
                  checked={checked}
                  disabled={!m.available}
                  onChange={() => {
                    setMethod(m.id);
                    setKey(newKey());
                  }}
                  className="mt-3 size-4 shrink-0 accent-[#00d9ff]"
                />
                <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-premium text-cyan">
                  <Icon size={19} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{tp(`methods.${m.id}.label`)}</span>
                  <span className="mt-0.5 block text-sm text-muted">
                    {m.available ? tp(`methods.${m.id}.description`) : tp(`reasons.${m.reason ?? 'not_configured'}`)}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </fieldset>

      {giftCard ? (
        <Link
          href="/wallet/gift-card"
          data-testid="topup-giftcard-link"
          className="group flex min-h-16 items-center gap-3 rounded-2xl border border-orange/40 bg-orange/5 p-3.5 transition-[box-shadow] duration-(--dur-btn) hover:shadow-glow-orange sm:p-4"
        >
          <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-xl bg-gradient-secondary text-on-accent">
            <Gift size={19} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{t('giftCardLink')}</span>
            <span className="mt-0.5 block text-sm text-muted">{t('giftCardHint')}</span>
          </span>
          <ChevronRight size={18} aria-hidden="true" className="flip-rtl shrink-0 text-muted" />
        </Link>
      ) : null}

      {error ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium text-fg" data-testid="topup-error">
          <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
          {errorText(error)}
        </p>
      ) : null}

      {available.length > 0 ? (
        <div className="flex flex-col gap-3">
          <Button type="submit" size="lg" fullWidth loading={pending || redirecting} loadingLabel={redirecting ? tp('pay.redirecting') : t('submitting')} data-testid="topup-submit">
            {t('submit')}
          </Button>
          <p className="flex items-start gap-2 text-xs text-muted">
            <Lock size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t('secure')}
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-border-strong bg-surface/40 p-4" data-testid="topup-unavailable">
          <p className="font-semibold">{t('noMethods')}</p>
          <p className="mt-1 text-sm text-muted">{t('noMethodsText')}</p>
        </div>
      )}
    </form>
  );
}
