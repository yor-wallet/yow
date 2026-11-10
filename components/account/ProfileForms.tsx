'use client';

import { useActionState, useEffect, useTransition } from 'react';
import { Check, Moon, Sun } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { LOCALE_LABELS, locales, type Locale } from '@/i18n/routing';
import { Input } from '@/components/ui/Input';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { useToast } from '@/components/ui/Toast';
import { useValidationMessage } from '@/components/ui/useValidationMessage';
import { useTheme, type Theme } from '@/components/layout/ThemeProvider';
import { setPreferredLocaleAction, updateProfileAction, type ProfileFormState } from '@/app/[locale]/account/profile/actions';
import { cn } from '@/lib/cn';

function localDigits(phone: string | null): string {
  if (!phone) return '';
  const d = phone.replace(/\D/g, '');
  return d.length === 11 && d.startsWith('968') ? d.slice(3) : d;
}

export function ProfileDetailsForm({ fullName, email, phone }: { fullName: string; email: string; phone: string | null }) {
  const t = useTranslations('account.profilePage');
  const vm = useValidationMessage();
  const { toast } = useToast();
  const [state, action] = useActionState(updateProfileAction, { status: 'idle' } as ProfileFormState);
  useEffect(() => {
    if (state.status === 'ok') toast({ title: t('saved'), variant: 'success' });
  }, [state, t, toast]);
  const fieldError = (f: 'fullName' | 'phone') => {
    const code = state.fieldErrors?.[f]?.[0];
    if (code === 'phone_taken') return t('errors.phone_taken');
    return vm(code);
  };
  return (
    <form action={action} className="grid grid-cols-1 gap-4 sm:grid-cols-2" data-testid="profile-form" noValidate>
      <Input name="fullName" label={t('fullName')} autoComplete="name" required defaultValue={state.values?.fullName ?? fullName} error={fieldError('fullName')} />
      <Input
        name="phone"
        label={t('phone')}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        dir="ltr"
        required
        defaultValue={state.values?.phone ?? localDigits(phone)}
        hint="+968"
        error={fieldError('phone')}
      />
      <Input name="email" label={t('email')} value={email} readOnly disabled hint={t('emailHint')} dir="ltr" containerClassName="sm:col-span-2" />
      {state.status === 'error' && state.error && state.error !== 'phone_taken' ? (
        <p role="alert" className="text-sm font-medium text-error sm:col-span-2">
          {t('errors.generic')}
        </p>
      ) : null}
      <div className="flex justify-end sm:col-span-2">
        <SubmitButton data-testid="profile-save">{t('save')}</SubmitButton>
      </div>
    </form>
  );
}

export function LanguagePicker() {
  const t = useTranslations('account.profilePage');
  const current = useLocale() as Locale;
  const router = useRouter();
  const pathname = usePathname();
  const { toast } = useToast();
  const [pending, start] = useTransition();
  const choose = (l: Locale) =>
    start(async () => {
      await setPreferredLocaleAction(l);
      toast({ title: t('languageSaved'), variant: 'success' });
      router.replace(pathname, { locale: l });
    });
  return (
    <div role="radiogroup" aria-label={t('languageTitle')} className="grid grid-cols-1 gap-2 xs:grid-cols-3">
      {locales.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={l === current}
          disabled={pending}
          onClick={() => l !== current && choose(l)}
          lang={l}
          className={cn(
            'flex min-h-12 items-center justify-between gap-2 rounded-xl border px-4 text-start font-semibold transition-[border-color,box-shadow] duration-(--dur-btn)',
            l === current ? 'border-cyan/60 bg-blue/12 neon-box' : 'border-border bg-surface hover:border-border-strong',
          )}
          data-testid={`locale-${l}`}
        >
          {LOCALE_LABELS[l]}
          {l === current ? <Check size={18} aria-hidden="true" className="text-cyan" /> : null}
        </button>
      ))}
    </div>
  );
}

export function ThemePicker() {
  const t = useTranslations('account.profilePage');
  const { theme, setTheme } = useTheme();
  const options: { id: Theme; label: string; icon: typeof Moon }[] = [
    { id: 'dark', label: t('themeDark'), icon: Moon },
    { id: 'light', label: t('themeLight'), icon: Sun },
  ];
  return (
    <div role="radiogroup" aria-label={t('themeTitle')} className="grid grid-cols-2 gap-2">
      {options.map(({ id, label, icon: Icon }) => (
        <button
          key={id}
          type="button"
          role="radio"
          aria-checked={theme === id}
          onClick={() => setTheme(id)}
          className={cn(
            'flex min-h-12 items-center justify-center gap-2 rounded-xl border px-4 font-semibold transition-[border-color,box-shadow] duration-(--dur-btn)',
            theme === id ? 'border-cyan/60 bg-blue/12 neon-box' : 'border-border bg-surface hover:border-border-strong',
          )}
          data-testid={`theme-${id}`}
        >
          <Icon size={18} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}
