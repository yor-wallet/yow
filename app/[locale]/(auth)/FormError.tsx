'use client';

import { CircleAlert } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { AuthFormState } from './actions';

/** Form-level error banner for auth forms. */
export function FormError({ state }: { state: AuthFormState }) {
  const t = useTranslations('auth.errors');
  if (state.status !== 'error' || !state.error) return null;
  let message: string;
  switch (state.error) {
    case 'rate_limited':
      message = t('rate_limited', { minutes: Math.max(1, Math.ceil((state.retryAfterSec ?? 60) / 60)) });
      break;
    case 'invalid_credentials':
    case 'account_suspended':
    case 'email_taken':
    case 'phone_taken':
    case 'validation':
      message = t(state.error);
      break;
    default:
      message = t('generic');
  }
  return (
    <div role="alert" className="mb-5 flex items-start gap-2.5 rounded-xl border border-error/50 bg-error/10 p-3 text-sm font-medium text-fg" data-testid="form-error">
      <CircleAlert size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-error" />
      <span>{message}</span>
    </div>
  );
}
