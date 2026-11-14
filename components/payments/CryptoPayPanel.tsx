'use client';

import { useActionState, useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, ShieldAlert } from 'lucide-react';
import { useFormatter, useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import type { PaymentIntentView } from '@/lib/payments/core';
import { Button } from '@/components/ui/Button';
import { submitCryptoTxAction, type CryptoSubmitState } from '@/app/[locale]/pay/[intentId]/actions';

type Loose = (key: string, values?: Record<string, string | number>) => string;

const EXPLORER: Record<string, (hash: string) => string> = {
  TRON: (h) => `https://tronscan.org/#/transaction/${h}`,
  BSC: (h) => `https://bscscan.com/tx/${h}`,
  ETH: (h) => `https://etherscan.io/tx/${h}`,
};

function CopyButton({ value, label, testId }: { value: string; label: string; testId?: string }) {
  const t = useTranslations('payments.crypto') as unknown as Loose;
  const [done, setDone] = useState(false);
  useEffect(() => {
    if (!done) return;
    const id = setTimeout(() => setDone(false), 1800);
    return () => clearTimeout(id);
  }, [done]);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setDone(true);
        } catch {
          /* clipboard unavailable: the value stays selectable */
        }
      }}
      className="inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl border border-border-strong bg-surface px-3 text-sm font-semibold transition-colors duration-(--dur-btn) hover:bg-surface-2"
      aria-label={label}
      data-testid={testId}
    >
      {done ? <Check size={16} aria-hidden="true" className="text-success" /> : <Copy size={16} aria-hidden="true" />}
      <span aria-live="polite">{done ? t('copied') : t('copy')}</span>
    </button>
  );
}

/**
 * USDT payment instructions: exact amount (it identifies this payment), the address of the chosen
 * network, then the transaction id to verify on the blockchain. The server decides; this only collects.
 */
export function CryptoPayPanel({ view, onSubmitted }: { view: PaymentIntentView; onSubmitted: () => void }) {
  const t = useTranslations('payments.crypto') as unknown as Loose;
  const format = useFormatter();
  const crypto = view.crypto!;
  const first = crypto.tx?.network ?? crypto.networks[0]?.id ?? 'TRON';
  const [network, setNetwork] = useState<string>(first);
  const [state, action, pending] = useActionState<CryptoSubmitState, FormData>(submitCryptoTxAction, { status: 'idle' });
  const selected = crypto.networks.find((n) => n.id === network) ?? crypto.networks[0];
  const deadline = new Date(crypto.paymentExpiresAt);
  const expired = !crypto.tx && deadline.getTime() < Date.now();

  useEffect(() => {
    if (state.status === 'success') onSubmitted();
  }, [state, onSubmitted]);

  if (!selected) return null;
  const networkName = t(`networks.${selected.id}`);
  const check = crypto.check;
  const errorText =
    state.status === 'error' ? t(`errors.${state.error}`, { sent: state.details?.sentUsdt ?? '—', expected: state.details?.expectedUsdt ?? crypto.amountUsdt }) : null;

  return (
    <section className="mt-4 rounded-xl border border-border bg-surface/60 p-4" data-testid="crypto-pay" aria-labelledby="crypto-pay-title">
      <h3 id="crypto-pay-title" className="text-base font-bold">
        {t('title')}
      </h3>
      <p className="mt-1 text-sm text-muted">{t('intro')}</p>

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('amountLabel')}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="rounded-lg bg-surface-2 px-3 py-2 font-display text-lg font-bold" dir="ltr" data-testid="crypto-amount">
            {crypto.amountUsdt} {crypto.token}
          </code>
          <CopyButton value={crypto.amountUsdt} label={t('copyAmount')} testId="crypto-copy-amount" />
        </div>
        <p className="mt-2 flex items-start gap-2 text-sm text-muted">
          <ShieldAlert size={16} aria-hidden="true" className="mt-0.5 shrink-0 text-warning" />
          <span>{t('exactAmount')}</span>
        </p>
      </div>

      {crypto.tx ? null : (
        <fieldset className="mt-4">
          <legend className="text-xs font-semibold uppercase tracking-wide text-muted">{t('networkLabel')}</legend>
          <div className="mt-2 grid gap-2 sm:grid-cols-3">
            {crypto.networks.map((n) => (
              <label
                key={n.id}
                className={cn(
                  'flex min-h-11 cursor-pointer flex-col justify-center rounded-xl border px-3 py-2 text-sm transition-colors duration-(--dur-btn) has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring',
                  network === n.id ? 'border-night bg-yellow/30 font-semibold' : 'border-border-strong bg-surface hover:bg-surface-2',
                )}
              >
                <input type="radio" name="network-choice" value={n.id} checked={network === n.id} onChange={() => setNetwork(n.id)} className="sr-only" data-testid={`crypto-network-${n.id}`} />
                <span>{t(`networks.${n.id}`)}</span>
                <span className="text-xs text-muted">{t(`networkHints.${n.id}`)}</span>
              </label>
            ))}
          </div>
        </fieldset>
      )}

      <div className="mt-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('addressLabel', { network: networkName })}</p>
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 break-all rounded-lg bg-surface-2 px-3 py-2 font-mono text-sm" dir="ltr" data-testid="crypto-address">
            {selected.address}
          </code>
          <CopyButton value={selected.address} label={t('copyAddress')} testId="crypto-copy-address" />
        </div>
        <p className="mt-2 text-sm font-medium text-error">{t('onlyUsdt', { network: networkName })}</p>
      </div>

      <div className="mt-5 border-t border-border pt-4">
        {crypto.tx ? (
          <div data-testid="crypto-found" aria-live="polite">
            <p className="text-sm font-semibold">
              {crypto.tx.network === 'TRON' || check?.confirmations == null || check.required == null
                ? t('foundTron')
                : t('found', { confirmations: Math.min(check.confirmations, check.required), required: check.required })}
            </p>
            <a href={EXPLORER[crypto.tx.network]?.(crypto.tx.hash)} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-accent underline-offset-4 hover:underline">
              {t('viewTx')}
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3" data-testid="crypto-tx-form" noValidate>
            <input type="hidden" name="intentId" value={view.id} />
            <input type="hidden" name="network" value={selected.id} />
            <p className={cn('text-sm', expired ? 'font-medium text-warning' : 'text-muted')} data-testid={expired ? 'crypto-expired' : 'crypto-deadline'}>
              {expired ? t('expired') : t('deadline', { time: format.dateTime(deadline, { hour: '2-digit', minute: '2-digit' }) })}
            </p>
            <label className="flex flex-col gap-1.5 text-sm font-semibold">
              {t('txLabel')}
              <input
                name="txHash"
                dir="ltr"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                inputMode="text"
                required
                className="min-h-11 rounded-xl border border-border-strong bg-surface px-3 font-mono text-sm font-normal focus-visible:outline-2 focus-visible:outline-ring"
                aria-describedby="crypto-tx-hint"
                data-testid="crypto-tx-input"
              />
              <span id="crypto-tx-hint" className="text-xs font-normal text-muted">
                {t('txHint')}
              </span>
            </label>
            {errorText ? (
              <p className="rounded-xl border border-error/40 bg-error/10 p-3 text-sm" role="alert" data-testid="crypto-error" data-code={state.status === 'error' ? state.error : undefined}>
                {errorText}
              </p>
            ) : null}
            <Button type="submit" variant="accent" size="lg" loading={pending} loadingLabel={t('verifying')} data-testid="crypto-verify">
              {t('verify')}
            </Button>
          </form>
        )}
      </div>
    </section>
  );
}
