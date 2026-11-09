'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Checkbox, Input, PasswordInput } from '@/components/ui/Input';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { useValidationMessage } from '@/components/ui/useValidationMessage';
import { registerAction, type AuthFormState } from '../actions';
import { FormError } from '../FormError';

const initial: AuthFormState = { status: 'idle' };

export function RegisterForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const vm = useValidationMessage();
  const [state, action] = useActionState(registerAction, initial);
  const fe = state.fieldErrors ?? {};
  const linkClass = 'font-semibold text-accent underline underline-offset-4';

  return (
    <form action={action} noValidate className="flex flex-col gap-4" data-testid="register-form">
      <FormError state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Input
        name="fullName"
        label={t('register.fullName')}
        autoComplete="name"
        required
        defaultValue={state.values?.fullName}
        error={vm(fe.fullName?.[0])}
      />
      <Input
        name="email"
        type="email"
        label={t('register.email')}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.values?.email}
        error={vm(fe.email?.[0])}
        dir="ltr"
      />
      <Input
        name="phone"
        type="tel"
        label={t('register.phone')}
        hint={t('register.phoneHint')}
        autoComplete="tel-national"
        inputMode="tel"
        required
        defaultValue={state.values?.phone}
        error={vm(fe.phone?.[0])}
        dir="ltr"
        placeholder="+968 9123 4567"
      />
      <PasswordInput
        name="password"
        label={t('register.password')}
        hint={t('register.passwordHint')}
        autoComplete="new-password"
        required
        error={vm(fe.password?.[0])}
        showLabel={t('showPassword')}
        hideLabel={t('hidePassword')}
        dir="ltr"
      />
      <PasswordInput
        name="confirmPassword"
        label={t('register.confirmPassword')}
        autoComplete="new-password"
        required
        error={vm(fe.confirmPassword?.[0])}
        showLabel={t('showPassword')}
        hideLabel={t('hidePassword')}
        dir="ltr"
      />
      <Checkbox
        name="acceptTerms"
        required
        error={vm(fe.acceptTerms?.[0])}
        label={t.rich('register.acceptTerms', {
          terms: (chunks) => (
            <Link href="/legal/terms" className={linkClass} target="_blank">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/legal/privacy" className={linkClass} target="_blank">
              {chunks}
            </Link>
          ),
        })}
      />
      <SubmitButton fullWidth size="lg" className="mt-1">
        {t('register.submit')}
      </SubmitButton>
    </form>
  );
}
