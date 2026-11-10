import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { FileWarning, LifeBuoy } from 'lucide-react';
import { asLocale } from '@/i18n/routing';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { HudCorners } from '@/components/ui/HudCorners';

/** Section ids per page (copy in messages/{locale}/legal.json). */
const PAGES = {
  terms: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8'],
  privacy: ['s1', 's2', 's3', 's4', 's5', 's6', 's7', 's8', 's9', 's10'],
  returns: ['s1', 's2', 's3', 's4', 's5', 's6', 's7'],
} as const;
type LegalSlug = keyof typeof PAGES;
/** Bump when the legal copy in messages/{locale}/legal.json changes. */
const LAST_UPDATED = new Date('2026-11-10T00:00:00Z');

type Props = { params: Promise<{ locale: string; slug: string }> };

function isLegalSlug(s: string): s is LegalSlug {
  return Object.hasOwn(PAGES, s);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale, slug } = await params;
  if (!isLegalSlug(slug)) return {};
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'legal' });
  return { title: t(`${slug}.title`), description: t(`${slug}.intro`) };
}

/**
 * Legal pages (terms, privacy incl. Oman PDPL — Royal Decree 6/2022, returns & warranty).
 * Clearly flagged as templates pending review by a lawyer qualified in Omani law.
 */
export default async function LegalPage({ params }: Props) {
  const { locale: rawLocale, slug } = await params;
  if (!isLegalSlug(slug)) notFound();
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const [t, format] = await Promise.all([getTranslations('legal'), getFormatter()]);
  const sections = PAGES[slug];
  const key = (s: string, part: 'Title' | 'Body') => `${slug}.${s}${part}` as 'terms.s1Title';
  const others = (Object.keys(PAGES) as LegalSlug[]).filter((p) => p !== slug);

  return (
    <div className="pb-14">
      <PageHeader title={t(`${slug}.title`)} fallbackHref="/" />
      <div className="page-container mt-5 grid grid-cols-1 gap-8 lg:mt-6 lg:grid-cols-12">
        <aside className="min-w-0 lg:order-2 lg:col-span-4">
          <nav aria-labelledby="legal-toc" className="rounded-card border border-border bg-surface p-4 shadow-card lg:sticky lg:top-28">
            <h2 id="legal-toc" className="hud-label">
              {t('contents')}
            </h2>
            <ol className="mt-3 space-y-0.5 text-sm">
              {sections.map((s, i) => (
                <li key={s}>
                  <a href={`#${s}`} className="flex min-h-11 items-center gap-2 rounded-lg px-2 text-muted hover:bg-surface-2 hover:text-fg">
                    <span className="font-display w-6 shrink-0 text-xs font-bold text-accent tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                    <span className="min-w-0">{t(key(s, 'Title'))}</span>
                  </a>
                </li>
              ))}
            </ol>
            <h2 className="mt-4 text-xs font-bold uppercase tracking-wider text-muted">{t('related')}</h2>
            <ul className="mt-1 text-sm">
              {others.map((p) => (
                <li key={p}>
                  <Link href={`/legal/${p}`} className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
                    {t(`${p}.title`)}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0 lg:order-1 lg:col-span-8" data-testid="legal-article">
          <div className="relative rounded-card border border-amber/50 bg-amber/10 p-4" role="note" data-testid="legal-template-notice">
            <HudCorners size={10} className="text-amber/70" />
            <p className="flex items-center gap-2 font-semibold">
              <FileWarning size={18} aria-hidden="true" className="shrink-0 text-amber" />
              {t('templateTitle')}
            </p>
            <p className="mt-1 text-sm">{t('templateNotice')}</p>
          </div>
          <p className="mt-5 text-sm text-muted">{t('updated', { date: format.dateTime(LAST_UPDATED, 'short') })}</p>
          <p className="mt-3 text-lg leading-relaxed">{t(`${slug}.intro`)}</p>
          {sections.map((s, i) => (
            <section key={s} id={s} className="mt-8 scroll-mt-28" aria-labelledby={`${s}-title`}>
              <h2 id={`${s}-title`} className="flex items-baseline gap-3 text-xl font-bold">
                <span className="font-display neon text-sm font-bold text-accent tabular-nums">{String(i + 1).padStart(2, '0')}</span>
                {t(key(s, 'Title'))}
              </h2>
              <p className="mt-2 leading-relaxed text-muted">{t(key(s, 'Body'))}</p>
            </section>
          ))}
          <Link href="/account/support/new" className="mt-10 inline-flex min-h-11 items-center gap-2 font-semibold text-accent underline-offset-4 hover:underline">
            <LifeBuoy size={18} aria-hidden="true" />
            {t('contactSupport')}
          </Link>
        </article>
      </div>
    </div>
  );
}
