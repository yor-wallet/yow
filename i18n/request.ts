import { hasLocale } from 'next-intl';
import { getRequestConfig } from 'next-intl/server';
import { NAMESPACES } from './namespaces';
import { routing, type Locale } from './routing';

export type Messages = Record<string, Record<string, unknown>>;

/** Load every namespace file for a locale and merge into `{ namespace: {...} }`. */
export async function loadMessages(locale: Locale): Promise<Messages> {
  const entries = await Promise.all(
    NAMESPACES.map(async (ns) => {
      const mod = (await import(`../messages/${locale}/${ns}.json`)) as { default: Record<string, unknown> };
      return [ns, mod.default] as const;
    }),
  );
  return Object.fromEntries(entries);
}

export default getRequestConfig(async ({ requestLocale }) => {
  const requested = await requestLocale;
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: 'Asia/Muscat',
    formats: {
      dateTime: {
        short: { day: 'numeric', month: 'short', year: 'numeric', numberingSystem: 'latn' },
        long: { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', numberingSystem: 'latn' },
      },
      number: {
        // Latin digits everywhere (money uses lib/money.ts, not Intl).
        plain: { numberingSystem: 'latn' },
      },
    },
  };
});
