'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, CircleAlert, ExternalLink, Loader2 } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import type { PaymentIntentView } from '@/lib/payments/core';
import { buttonClasses } from '@/components/ui/Button';
import { HudCorners } from '@/components/ui/HudCorners';
import { CryptoPayPanel } from './CryptoPayPanel';
import { Price } from '@/components/ui/Price';

const PENDING = new Set(['CREATED', 'PENDING', 'REQUIRES_ACTION']);

/**
 * Payment status, always re-read from the SERVER (never from the redirect query string).
 * Polls GET /api/payments/:id while pending (3 s, then backing off); the server itself asks
 * the provider. Reloading or coming Back to this page never starts a new payment.
 */
export function PaymentStatus({ initial, cancelled }: { initial: PaymentIntentView; cancelled: boolean }) {
  const t = useTranslations('payments.status');
  const tp = useTranslations('payments');
  const format = useFormatter();
  const [view, setView] = useState(initial);
  const [checking, setChecking] = useState(false);
  const attempts = useRef(0);
  const [nonce, setNonce] = useState(0);
  const pending = PENDING.has(view.status);
  // After the customer submits a transaction id: look again right away instead of waiting for the next tick.
  const checkNow = useCallback(() => {
    attempts.current = 0;
    setNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!pending) return;
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      attempts.current += 1;
      setChecking(true);
      try {
        const res = await fetch(`/api/payments/${encodeURIComponent(view.id)}`, { cache: 'no-store', headers: { Accept: 'application/json' } });
        if (res.ok) {
          const body = (await res.json()) as { payment?: PaymentIntentView };
          if (!stop && body.payment) setView(body.payment);
        }
      } catch {
        /* offline: retry later */
      } finally {
        if (!stop) setChecking(false);
      }
      if (!stop) timer = setTimeout(tick, attempts.current < 40 ? 3000 : 15000);
    };
    timer = setTimeout(tick, 1500);
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [pending, view.id, nonce]);

  const provider = tp(`methods.${view.provider}.label`);
  const succeeded = view.status === 'SUCCEEDED';
  const failed = !pending && !succeeded;
  const failure = view.failureCode && tp.has(`status.failure.${view.failureCode}` as never) ? tp(`status.failure.${view.failureCode as 'generic'}`) : t('failure.generic');

  return (
    <div
      className={cn('relative rounded-card p-5 shadow-card sm:p-8', succeeded ? 'holo-border' : 'border border-border bg-surface')}
      data-testid="payment-status"
      data-status={view.status}
      aria-live="polite"
    >
      <HudCorners className={failed ? 'text-error/70' : undefined} />
      <span className="hud-label">{t('eyebrow')}</span>
      <div className="mt-5 flex items-start gap-4">
        <span
          aria-hidden="true"
          className={cn(
            'grid size-14 shrink-0 place-items-center rounded-2xl',
            succeeded && 'bg-success/15 text-success neon-box',
            pending && 'bg-blue/15 text-cyan',
            failed && 'bg-error/15 text-error',
          )}
        >
          {succeeded ? <CheckCircle2 size={30} /> : pending ? <Loader2 size={30} className="animate-spin motion-reduce:animate-none" /> : <CircleAlert size={30} />}
        </span>
        <div className="min-w-0">
          <h2 className="text-xl font-bold sm:text-2xl" data-testid="payment-status-title">
            {succeeded ? t('succeeded') : pending ? t('pending') : t('failed')}
          </h2>
          <p className="mt-1 text-sm text-muted">
            {succeeded ? t('succeededText', { provider }) : pending ? t('pendingText', { provider }) : failure}
          </p>
          {pending && checking ? <p className="mt-2 text-xs text-accent">{t('checking')}</p> : null}
        </div>
      </div>

      {cancelled && pending ? <p className="mt-4 rounded-xl border border-amber/40 bg-amber/10 p-3 text-sm">{t('cancelledNote')}</p> : null}
      {view.creditedToWallet ? <p className="mt-4 rounded-xl border border-cyan/40 bg-cyan/10 p-3 text-sm">{t('creditedToWallet')}</p> : null}
      {pending && view.crypto ? <CryptoPayPanel view={view} onSubmitted={checkNow} /> : null}
      {pending && view.instructions ? (
        <div className="mt-4 rounded-xl border border-border bg-surface/60 p-3 text-sm">
          <p className="font-semibold">{t('instructions')}</p>
          <p className="mt-1 whitespace-pre-line text-muted">{view.instructions}</p>
        </div>
      ) : null}

      <dl className="mt-6 grid grid-cols-1 divide-y divide-border text-sm">
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
          <dt className="text-muted">{t('amount')}</dt>
          <dd className="font-display" data-testid="payment-status-amount">
            <Price baisa={view.confirmedAmountBaisa ?? view.amountBaisa} size="lg" />
          </dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
          <dt className="text-muted">{t('purposeLabel')}</dt>
          <dd className="font-medium">{t(`purpose.${view.purpose}`)}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
          <dt className="text-muted">{t('method')}</dt>
          <dd className="font-medium">{provider}</dd>
        </div>
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
          <dt className="text-muted">{t('createdAt')}</dt>
          <dd className="font-medium">{format.dateTime(new Date(view.createdAt), 'long')}</dd>
        </div>
        {view.succeededAt ? (
          <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
            <dt className="text-muted">{t('confirmedAt')}</dt>
            <dd className="font-medium">{format.dateTime(new Date(view.succeededAt), 'long')}</dd>
          </div>
        ) : null}
        <div className="flex flex-wrap justify-between gap-x-4 gap-y-1 py-2.5">
          <dt className="text-muted">{t('reference')}</dt>
          <dd className="break-all font-mono text-xs" dir="ltr">
            {view.id}
          </dd>
        </div>
      </dl>

      <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        {pending && view.redirectUrl ? (
          <a href={view.redirectUrl} className={buttonClasses({ variant: 'accent', size: 'lg', className: 'sheen' })} data-testid="payment-continue">
            {t('continue')}
            <ExternalLink size={16} aria-hidden="true" />
          </a>
        ) : null}
        {succeeded && view.ledgerTransactionId && (view.purpose === 'TOPUP' || view.creditedToWallet) ? (
          <Link href={`/wallet/tx/${view.ledgerTransactionId}`} className={buttonClasses({ variant: 'outline' })}>
            {t('actions.receipt')}
          </Link>
        ) : null}
        {view.orderNumber && !view.creditedToWallet ? (
          <Link href={`/orders/${view.orderNumber}`} className={buttonClasses({ variant: succeeded ? 'primary' : 'outline' })} data-testid="payment-order-link">
            {t('actions.order', { number: view.orderNumber })}
          </Link>
        ) : null}
        {view.flexApplicationId ? (
          <Link href={`/flex/${view.flexApplicationId}`} className={buttonClasses({ variant: 'outline' })}>
            {t('actions.flex')}
          </Link>
        ) : null}
        {failed && view.purpose === 'TOPUP' ? (
          <Link href="/wallet/top-up" className={buttonClasses({ variant: 'accent' })}>
            {t('actions.retryTopUp')}
          </Link>
        ) : null}
        <Link href="/wallet" className={buttonClasses({ variant: 'ghost' })} data-testid="payment-wallet-link">
          {t('actions.wallet')}
        </Link>
      </div>
    </div>
  );
}
