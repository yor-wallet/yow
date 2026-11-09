import type { Metadata } from 'next';
import { Heart } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { listFavoriteCards } from '@/lib/catalog/favorites';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { ProductGrid } from '@/components/shop/ProductGrid';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'catalog.favorites' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function FavoritesPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, session] = await Promise.all([getTranslations('catalog.favorites'), getSession()]);
  const cards = session ? await listFavoriteCards(session.user.id, locale) : [];

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" />
      <div className="page-container pt-4 lg:pt-6">
        {!session ? (
          <EmptyState
            icon={<Heart size={26} />}
            title={t('signInTitle')}
            description={t('signInText')}
            action={
              <Link href={{ pathname: '/login', query: { next: '/favorites' } }} className={buttonClasses({ variant: 'primary' })}>
                {t('signIn')}
              </Link>
            }
          />
        ) : cards.length === 0 ? (
          <EmptyState icon={<Heart size={26} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <ProductGrid products={cards} favoriteIds={new Set(cards.map((c) => c.id))} />
        )}
      </div>
    </div>
  );
}
