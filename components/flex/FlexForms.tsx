'use client';

import { useState, useTransition } from 'react';
import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from '@/i18n/navigation';
import { Button } from '@/components/ui/Button';
import { Checkbox } from '@/components/ui/Input';
import { useToast } from '@/components/ui/Toast';
import { acceptFlexAction, applyFlexAction, cancelFlexAction, payInstallmentAction, type FlexActionResult } from '@/app/[locale]/flex/actions';

function newKey() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `k${Date.now()}${Math.random().toString(36).slice(2)}`;
}

function useErrorText() {
  const tp = useTranslations('payments');
  const tf = useTranslations('flex');
  return (res: Extract<FlexActionResult, { ok: false }>) => {
    if (res.reason && tf.has(`detail.notReady.${res.reason}` as never)) return tf(`detail.notReady.${res.reason}` as never);
    if (res.reason && tf.has(`eligibility.reasons.${res.reason}` as never)) return tf(`eligibility.reasons.${res.reason}` as never);
    return tp.has(`errors.${res.error}` as never) ? tp(`errors.${res.error}` as never) : tp('errors.generic');
  };
}

function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium" data-testid="flex-error">
      <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
      {text}
    </p>
  );
}

export function ApplyFlexButton({ productId, variantId, months }: { productId: string; variantId: string; months: number }) {
  const t = useTranslations('flex.apply');
  const router = useRouter();
  const errorText = useErrorText();
  const [key] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3">
      <ErrorNote text={error} />
      <Button
        variant="accent"
        size="lg"
        fullWidth
        className="min-h-14"
        loading={pending}
        loadingLabel={t('submitting')}
        data-testid="flex-apply-submit"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await applyFlexAction({ productId, variantId, months, idempotencyKey: key });
            if (res.ok && res.applicationId) router.replace(`/flex/${res.applicationId}`);
            else if (!res.ok) setError(errorText(res));
          })
        }
      >
        {t('submit')}
      </Button>
    </div>
  );
}

export function AcceptFlexForm({ applicationId, addressId, expectedTotalBaisa, termsVersion }: { applicationId: string; addressId: string; expectedTotalBaisa: number; termsVersion: string }) {
  const t = useTranslations('flex.detail');
  const tp = useTranslations('payments');
  const router = useRouter();
  const errorText = useErrorText();
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="flex flex-col gap-4"
      data-testid="flex-accept-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!accepted) {
          setError(tp('errors.terms_required'));
          return;
        }
        start(async () => {
          setError(null);
          const res = await acceptFlexAction({ applicationId, addressId, expectedTotalBaisa, termsVersion, acceptTerms: true });
          if (res.ok) router.refresh();
          else setError(errorText(res));
        });
      }}
    >
      <Checkbox name="acceptTerms" label={t('acceptLabel')} checked={accepted} onChange={(e) => setAccepted(e.currentTarget.checked)} data-testid="flex-accept-terms" />
      <ErrorNote text={error} />
      <Button type="submit" size="lg" variant="accent" fullWidth className="min-h-14" loading={pending} loadingLabel={t('confirming')} disabled={!accepted} data-testid="flex-accept-submit">
        {t('confirm')}
      </Button>
    </form>
  );
}

export function PayInstallmentButton({ installmentId, label }: { installmentId: string; label: string }) {
  const t = useTranslations('flex.detail');
  const router = useRouter();
  const { toast } = useToast();
  const errorText = useErrorText();
  const [key, setKey] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2">
      <ErrorNote text={error} />
      <Button
        variant="accent"
        size="lg"
        fullWidth
        className="min-h-14"
        loading={pending}
        loadingLabel={t('paying')}
        data-testid="flex-pay-installment"
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await payInstallmentAction({ installmentId, idempotencyKey: key });
            setKey(newKey());
            if (res.ok) {
              toast({ title: t('paidToast'), variant: 'success' });
              router.refresh();
            } else setError(errorText(res));
          })
        }
      >
        {label}
      </Button>
    </div>
  );
}

export function CancelFlexButton({ applicationId }: { applicationId: string }) {
  const t = useTranslations('flex.detail');
  const tc = useTranslations('common.actions');
  const router = useRouter();
  const errorText = useErrorText();
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!confirming) {
    return (
      <Button variant="ghost" onClick={() => setConfirming(true)} data-testid="flex-cancel">
        {t('cancel')}
      </Button>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-error/40 bg-error/5 p-3">
      <ErrorNote text={error} />
      <div className="flex flex-wrap gap-2">
        <Button
          variant="danger"
          loading={pending}
          data-testid="flex-cancel-confirm"
          onClick={() =>
            start(async () => {
              const res = await cancelFlexAction(applicationId);
              if (res.ok) router.refresh();
              else setError(errorText(res));
            })
          }
        >
          {tc('confirm')}
        </Button>
        <Button variant="outline" onClick={() => setConfirming(false)}>
          {tc('cancel')}
        </Button>
      </div>
    </div>
  );
}
