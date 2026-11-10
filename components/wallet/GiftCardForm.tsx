'use client';

import { useActionState, useEffect, useRef } from 'react';
import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Input, Checkbox } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { buttonClasses } from '@/components/ui/Button';
import { HudCorners } from '@/components/ui/HudCorners';
import { submitGiftCardAction, type GiftCardFormState } from '@/app/[locale]/wallet/actions';
import { StatusBadge } from './StatusBadge';

const BRANDS = ['APPLE', 'GOOGLE_PLAY', 'PLAYSTATION', 'XBOX', 'STEAM', 'NINTENDO', 'AMAZON', 'NETFLIX', 'RAZER_GOLD', 'OTHER'] as const;
const CURRENCIES = ['OMR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'] as const;

export function GiftCardForm() {
  const t = useTranslations('wallet.giftCard');
  const tp = useTranslations('payments');
  const [state, action] = useActionState<GiftCardFormState, FormData>(submitGiftCardAction, { status: 'idle' });
  const successRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.status === 'success') successRef.current?.focus();
  }, [state.status]);

  if (state.status === 'success') {
    return (
      <div ref={successRef} tabIndex={-1} className="relative rounded-card holo-border p-6 text-center outline-none" data-testid="giftcard-success" role="status">
        <HudCorners />
        <CheckCircle2 size={40} aria-hidden="true" className="mx-auto text-success" />
        <h2 className="mt-3 text-xl font-bold">{t('submitted')}</h2>
        <div className="mt-2 flex justify-center">
          <StatusBadge status="submitted" />
        </div>
        <p className="mx-auto mt-3 max-w-md text-sm text-muted">{t('submittedText')}</p>
        <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
          <Link href="/wallet?filter=pending" className={buttonClasses({ variant: 'primary' })} data-testid="giftcard-back">
            {t('backToWallet')}
          </Link>
          <a href="" className={buttonClasses({ variant: 'outline' })}>
            {t('another')}
          </a>
        </div>
      </div>
    );
  }

  const fe = state.fieldErrors ?? {};
  const fieldError = (name: string) => {
    const code = fe[name]?.[0];
    if (!code) return undefined;
    if (code === 'consent_required') return t('consentRequired');
    if (t.has(`errors.${code}` as never)) return t(`errors.${code as 'required'}`);
    if (tp.has(`errors.${code}` as never)) return tp(`errors.${code as 'generic'}`);
    return tp('errors.invalid_input');
  };
  const formError =
    state.status === 'error' && state.error && !Object.keys(fe).length
      ? tp.has(`errors.${state.error}` as never)
        ? tp(`errors.${state.error as 'generic'}`)
        : tp('errors.generic')
      : null;

  return (
    <form action={action} className="flex flex-col gap-5" data-testid="giftcard-form" encType="multipart/form-data">
      <Select name="brand" label={t('brand')} placeholder={t('brandPlaceholder')} defaultValue={state.values?.brand ?? ''} error={fieldError('brand')} required>
        {BRANDS.map((b) => (
          <option key={b} value={b}>
            {t(`brands.${b}`)}
          </option>
        ))}
      </Select>
      <Input
        name="code"
        label={t('code')}
        hint={t('codeHint')}
        error={fieldError('code')}
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        dir="ltr"
        className="font-mono tracking-wider"
        required
        maxLength={80}
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
        <Select name="currency" label={t('currency')} defaultValue={state.values?.currency ?? 'OMR'} error={fieldError('currency')} required>
          {CURRENCIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          name="value"
          label={t('value')}
          hint={t('valueHint')}
          error={fieldError('value')}
          inputMode="decimal"
          defaultValue={state.values?.value ?? ''}
          dir="ltr"
          className="font-display tabular-nums"
          required
        />
      </div>
      <Input name="photo" type="file" label={t('photo')} hint={t('photoHint')} error={fieldError('photo')} accept="image/png,image/jpeg,image/webp" className="file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-fg" />
      <Checkbox name="consent" label={t('consent')} error={fieldError('consent')} required />

      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium" data-testid="giftcard-error">
          <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
          {formError}
        </p>
      ) : null}

      <SubmitButton variant="accent" size="lg" fullWidth className="min-h-14" loadingLabel={t('submitting')} data-testid="giftcard-submit" leadingIcon={<ShieldCheck size={18} aria-hidden="true" />}>
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
