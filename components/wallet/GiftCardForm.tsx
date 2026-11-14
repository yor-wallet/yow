'use client';

import { useActionState, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { CheckCircle2, CircleAlert, ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Input, Checkbox } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { buttonClasses } from '@/components/ui/Button';
import { HudCorners } from '@/components/ui/HudCorners';
import { submitGiftCardAction, type GiftCardFormState } from '@/app/[locale]/wallet/actions';
import { prepareImage } from '@/components/delivery/compress-image';
import { StatusBadge } from './StatusBadge';

const BRANDS = ['APPLE', 'GOOGLE_PLAY', 'PLAYSTATION', 'XBOX', 'STEAM', 'NINTENDO', 'AMAZON', 'NETFLIX', 'RAZER_GOLD', 'OTHER'] as const;
const CURRENCIES = ['OMR', 'USD', 'EUR', 'GBP', 'AED', 'SAR'] as const;
/** Below the host's request limit (4.5 MB) with room for the other fields. */
const MAX_PHOTO_BYTES = 3_500_000;

export function GiftCardForm() {
  const t = useTranslations('wallet.giftCard');
  const tp = useTranslations('payments');
  const [state, action] = useActionState<GiftCardFormState, FormData>(submitGiftCardAction, { status: 'idle' });
  const successRef = useRef<HTMLDivElement>(null);
  const [photoState, setPhotoState] = useState<'idle' | 'preparing' | 'unreadable' | 'too_large'>('idle');

  /**
   * Phone photos are often heavier than what the host accepts in one request (4.5 MB). The photo is
   * downscaled and re-encoded on the device (which also strips its location data) and swapped into the
   * field, so the normal form submission sends the light version.
   */
  const onPhoto = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (!file) return setPhotoState('idle');
    setPhotoState('preparing');
    try {
      const prepared = await prepareImage(file, { maxDimension: 2000, maxOutputBytes: MAX_PHOTO_BYTES });
      URL.revokeObjectURL(prepared.url);
      const dt = new DataTransfer();
      dt.items.add(new File([prepared.blob], 'gift-card.jpg', { type: 'image/jpeg' }));
      input.files = dt.files;
      setPhotoState('idle');
    } catch (err) {
      const code = err instanceof Error ? err.message : '';
      // No canvas / DataTransfer on this browser: keep the original when it is light enough to be sent.
      if (code !== 'too_large' && code !== 'image_unreadable' && code !== 'heic_unsupported' && code !== 'unsupported_type' && file.size <= MAX_PHOTO_BYTES) {
        return setPhotoState('idle');
      }
      input.value = '';
      setPhotoState(code === 'too_large' || file.size > MAX_PHOTO_BYTES ? 'too_large' : 'unreadable');
    }
  };

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
      <Input
        name="photo"
        type="file"
        label={t('photo')}
        hint={photoState === 'preparing' ? t('photoPreparing') : t('photoHint')}
        error={photoState === 'unreadable' ? t('photoUnreadable') : photoState === 'too_large' ? t('photoTooLarge') : fieldError('photo')}
        accept="image/png,image/jpeg,image/webp"
        onChange={onPhoto}
        data-testid="giftcard-photo"
        className="file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-sm file:text-fg" />
      <Checkbox name="consent" label={t('consent')} error={fieldError('consent')} required />

      {formError ? (
        <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium" data-testid="giftcard-error">
          <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
          {formError}
        </p>
      ) : null}

      <SubmitButton variant="accent" size="lg" fullWidth className="min-h-14" loadingLabel={t('submitting')} data-testid="giftcard-submit" disabled={photoState === 'preparing'} leadingIcon={<ShieldCheck size={18} aria-hidden="true" />}>
        {t('submit')}
      </SubmitButton>
    </form>
  );
}
