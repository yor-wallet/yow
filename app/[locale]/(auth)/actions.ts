'use server';

import { getLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { login, logout, register, type AuthErrorCode } from '@/lib/auth';
import { mergeAnonymousCartFromCookie } from '@/lib/cart';
import { formDataToObject, safeRedirectPath, type FieldErrors } from '@/lib/validation';
import { routing } from '@/i18n/routing';

export type AuthFormState = {
  status: 'idle' | 'error';
  error?: AuthErrorCode | 'generic';
  fieldErrors?: FieldErrors;
  retryAfterSec?: number;
  /** Non-sensitive values echoed back to refill the form (never passwords). */
  values?: { email?: string; fullName?: string; phone?: string };
};

/** `/en/account` → `/account`; keeps only safe relative paths. */
function nextPath(raw: FormDataEntryValue | null, fallback: string): string {
  const path = safeRedirectPath(typeof raw === 'string' ? raw : undefined, fallback);
  const seg = path.split('/')[1];
  if (seg && (routing.locales as readonly string[]).includes(seg)) return path.slice(seg.length + 1) || '/';
  return path;
}

export async function loginAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = formDataToObject(formData);
  let res;
  try {
    res = await login({ email: input.email, password: input.password });
  } catch (err) {
    console.error('[auth] login failed', err);
    return { status: 'error', error: 'generic', values: { email: String(input.email ?? '') } };
  }
  if (!res.ok) {
    return {
      status: 'error',
      error: res.error,
      fieldErrors: res.fieldErrors,
      retryAfterSec: res.retryAfterSec,
      values: { email: String(input.email ?? '') },
    };
  }
  // Visitor cart (cookie) → the account's cart. Never blocks the sign-in.
  await mergeAnonymousCartFromCookie(res.user.id);
  const locale = await getLocale();
  redirect({ href: nextPath(formData.get('next'), '/account'), locale });
  return { status: 'idle' };
}

export async function registerAction(_prev: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const input = formDataToObject(formData);
  const locale = await getLocale();
  const values = { email: String(input.email ?? ''), fullName: String(input.fullName ?? ''), phone: String(input.phone ?? '') };
  let res;
  try {
    res = await register({
      fullName: input.fullName,
      email: input.email,
      phone: input.phone,
      password: input.password,
      confirmPassword: input.confirmPassword,
      acceptTerms: input.acceptTerms === true,
      locale,
    });
  } catch (err) {
    console.error('[auth] register failed', err);
    return { status: 'error', error: 'generic', values };
  }
  if (!res.ok) {
    return { status: 'error', error: res.error, fieldErrors: res.fieldErrors, retryAfterSec: res.retryAfterSec, values };
  }
  await mergeAnonymousCartFromCookie(res.user.id);
  redirect({ href: nextPath(formData.get('next'), '/account'), locale });
  return { status: 'idle' };
}

export async function logoutAction(): Promise<void> {
  await logout();
  const locale = await getLocale();
  redirect({ href: '/', locale });
}
