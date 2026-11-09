'use client';

import { useActionState } from 'react';
import { useTranslations } from 'next-intl';
import { Input, PasswordInput } from '@/components/ui/Input';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { useValidationMessage } from '@/components/ui/useValidationMessage';
import { loginAction, type AuthFormState } from '../actions';
import { FormError } from '../FormError';

const initial: AuthFormState = { status: 'idle' };

export function LoginForm({ next }: { next?: string }) {
  const t = useTranslations('auth');
  const vm = useValidationMessage();
  const [state, action] = useActionState(loginAction, initial);
  const fe = state.fieldErrors ?? {};

  return (
    <form action={action} noValidate className="flex flex-col gap-4" data-testid="login-form">
      <FormError state={state} />
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <Input
        name="email"
        type="email"
        label={t('login.email')}
        autoComplete="email"
        inputMode="email"
        autoCapitalize="none"
        spellCheck={false}
        required
        defaultValue={state.values?.email}
        error={vm(fe.email?.[0])}
        dir="ltr"
      />
      <PasswordInput
        name="password"
        label={t('login.password')}
        autoComplete="current-password"
        required
        error={vm(fe.password?.[0])}
        showLabel={t('showPassword')}
        hideLabel={t('hidePassword')}
        dir="ltr"
      />
      <SubmitButton fullWidth size="lg" className="mt-2">
        {t('login.submit')}
      </SubmitButton>
    </form>
  );
}
