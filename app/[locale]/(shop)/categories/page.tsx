import type { Metadata } from 'next';
import { LayoutGrid } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { categoryPath } from '@/lib/catalog/paths';
import { localize } from '@/lib/localized';
import { getNavCategories } from '@/lib/nav';
import { PageHeader } from '@/components/layout/PageHeader';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { Reveal } from '@/components/ui/Reveal';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'catalog.categories' });
  return { title: t('metaTitle') };
}

export default async function CategoriesPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, categories] = await Promise.all([getTranslations('catalog.categories'), getNavCategories()]);

  return (
    <div className="pb-12">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/" />
      <div className="page-container pt-4 lg:pt-6">
        {categories.length === 0 ? (
          <EmptyState icon={<LayoutGrid size={26} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {categories.map((c, i) => (
              <li key={c.id} className="min-w-0">
                <Reveal delay={i * 0.05} className="h-full">
                  <section aria-labelledby={`cat-${c.slug}`} className="flex h-full flex-col gap-4 rounded-card border border-border bg-surface p-5 shadow-card">
                    <div className="flex items-center gap-3">
                      <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-gradient-premium text-cyan">
                        <CategoryIcon name={c.icon} size={22} />
                      </span>
                      <div className="min-w-0">
                        <h2 id={`cat-${c.slug}`} className="truncate text-lg font-bold">
                          {localize(c.name, locale)}
                        </h2>
                        <p className="text-xs text-muted">{t('subcount', { count: c.children.length })}</p>
                      </div>
                    </div>
                    <ul className="flex flex-col">
                      {c.children.map((ch) => (
                        <li key={ch.id}>
                          <Link href={categoryPath(ch.slug)} className="flex min-h-11 items-center justify-between gap-2 rounded-lg px-2 text-sm transition-colors hover:bg-surface-2">
                            <span className="truncate">{localize(ch.name, locale)}</span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link href={categoryPath(c.slug)} className="mt-auto inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">
                      {t('viewAll', { name: localize(c.name, locale) })}
                    </Link>
                  </section>
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
