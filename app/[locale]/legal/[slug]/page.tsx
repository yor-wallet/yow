import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { asLocale } from '@/i18n/routing';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { PageHeader } from '@/components/layout/PageHeader';

const PAGES = ['terms', 'privacy', 'returns'] as const;
type LegalSlug = (typeof PAGES)[number];
const SECTIONS = ['s1', 's2', 's3', 's4'] as const;
/** Bump when the legal copy in messages/{locale}/legal.json changes. */
const LAST_UPDATED = new Date('2026-11-09T00:00:00Z');

type Props = { params: Promise<{ locale: string; slug: string }> };

function isLegalSlug(s: string): s is LegalSlug {
  return (PAGES as readonly string[]).includes(s);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLegalSlug(slug)) return {};
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'legal' });
  return { title: t(`${slug}.title`) };
}

export default async function LegalPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const [t, format] = await Promise.all([getTranslations('legal'), getFormatter()]);

  return (
    <div>
      <PageHeader title={t(`${slug}.title`)} fallbackHref="/" />
      <div className="page-container">
      <article className="mx-auto mt-6 max-w-3xl lg:mt-8">
        <p className="text-sm text-muted">{t('updated', { date: format.dateTime(LAST_UPDATED, 'short') })}</p>
        <p className="mt-4 text-lg">{t(`${slug}.intro`)}</p>
        {SECTIONS.map((s) => (
          <section key={s} className="mt-8">
            <h2 className="text-xl font-bold">{t(`${slug}.${s}Title`)}</h2>
            <p className="mt-2 leading-relaxed text-muted">{t(`${slug}.${s}Body`)}</p>
          </section>
        ))}
      </article>
      </div>
    </div>
  );
}
