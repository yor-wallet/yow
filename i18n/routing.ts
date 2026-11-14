import { defineRouting } from 'next-intl/routing';
import { LOCALE_COOKIE, ONE_YEAR_SECONDS } from '@/lib/cookies';

/** Two languages offered to shoppers (owner's decision, November 2026): Arabic and English. Old /fr links redirect to English (next.config.ts). */
export const locales = ['ar', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'ar';

export const routing = defineRouting({
  locales,
  defaultLocale,
  localePrefix: 'always',
  localeCookie: { name: LOCALE_COOKIE, maxAge: ONE_YEAR_SECONDS, sameSite: 'lax' },
});

export const RTL_LOCALES: readonly Locale[] = ['ar'];

export function isRtl(locale: string): boolean {
  return (RTL_LOCALES as readonly string[]).includes(locale);
}

export function getDirection(locale: string): 'rtl' | 'ltr' {
  return isRtl(locale) ? 'rtl' : 'ltr';
}

/** Native language names for the locale switcher. */
export const LOCALE_LABELS: Record<Locale, string> = { ar: 'العربية', en: 'English' };

/** Narrow a route param to a supported locale (falls back to the default). */
export function asLocale(value: string | undefined | null): Locale {
  return (locales as readonly string[]).includes(value ?? '') ? (value as Locale) : defaultLocale;
}
