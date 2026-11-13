import type { Metadata } from 'next';
import { Scale } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { listCompare, specMatrix } from '@/lib/catalog/compare';
import { productPath } from '@/lib/catalog/paths';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { EmptyState } from '@/components/ui/EmptyState';
import { Price } from '@/components/ui/Price';
import { CompareRemove } from '@/components/shop/CompareRemove';
import { ShopImage } from '@/components/shop/ShopImage';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'catalog.compare' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const AVAILABILITY_KEY = { in_stock: 'inStock', low_stock: 'lowStock', out_of_stock: 'outOfStock', unavailable: 'unavailable' } as const;

export default async function ComparePage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, tc, session] = await Promise.all([getTranslations('catalog.compare'), getTranslations('catalog.card'), getSession()]);
  const products = session ? await listCompare(session.user.id, locale) : [];
  const specs = specMatrix(products);
  const none = <span className="text-muted">{t('notSpecified')}</span>;
  const th = 'sticky start-0 z-[1] w-24 min-w-24 bg-surface p-3 text-start align-top text-sm font-semibold text-muted sm:w-40 sm:min-w-40';
  const td = 'min-w-[8.25rem] p-3 align-top text-sm sm:min-w-40';

  return (
    <div className="pb-14">
      <PageHeader
        title={t('title')}
        subtitle={t('subtitle')}
        fallbackHref="/"
        actions={products.length > 0 ? <CompareRemove productId={null} label={t('clear')} variant="text" /> : undefined}
      />
      <div className="page-container pt-4 lg:pt-6">
        {!session ? (
          <EmptyState
            icon={<Scale size={26} />}
            title={t('signInTitle')}
            description={t('signInText')}
            action={
              <Link href={{ pathname: '/login', query: { next: '/compare' } }} className={buttonClasses({ variant: 'primary' })}>
                {t('signIn')}
              </Link>
            }
          />
        ) : products.length === 0 ? (
          <EmptyState icon={<Scale size={26} />} title={t('emptyTitle')} description={t('emptyText')} />
        ) : (
          <div className="overflow-x-auto rounded-card border border-border bg-surface shadow-card" data-scroll-x data-testid="compare-table">
            <table className="w-full border-collapse">
              <caption className="sr-only">{t('table')}</caption>
              <thead>
                <tr>
                  <td className={th} />
                  {products.map(({ card }) => (
                    <th key={card.id} scope="col" className={`${td} text-start font-normal`}>
                      <div className="flex flex-col gap-2">
                        <div className="relative grid aspect-square w-full max-w-36 place-items-center overflow-hidden rounded-xl bg-blue/8 text-accent">
                          {card.image ? (
                            <ShopImage src={card.image.src} width={card.image.width} height={card.image.height} alt={card.image.alt} sizes="144px" className="size-full object-contain p-2" />
                          ) : (
                            <CategoryIcon name={card.categoryIcon} size={36} />
                          )}
                        </div>
                        <Link href={productPath(card.slug)} className="line-clamp-2 font-bold underline-offset-4 hover:underline">
                          <bdi>{card.name}</bdi>
                        </Link>
                        <CompareRemove productId={card.id} label={t('remove', { name: card.name })} variant="icon" />
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="[&>tr]:border-t [&>tr]:border-border">
                <tr>
                  <th scope="row" className={th}>
                    {t('price')}
                  </th>
                  {products.map(({ card }) => (
                    <td key={card.id} className={td}>
                      <span className="flex flex-wrap items-baseline gap-x-1.5">
                        {card.priceBaisa !== null && card.priceFrom ? <span className="text-xs text-muted">{tc('from')}</span> : null}
                        <Price baisa={card.priceBaisa} compareAtBaisa={card.compareAtBaisa} size="md" />
                      </span>
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={th}>
                    {t('availability')}
                  </th>
                  {products.map(({ card }) => (
                    <td key={card.id} className={td}>
                      {tc(AVAILABILITY_KEY[card.availability])}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={th}>
                    {t('brand')}
                  </th>
                  {products.map(({ card }) => (
                    <td key={card.id} className={td}>
                      {card.brand ?? none}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={th}>
                    {t('warranty')}
                  </th>
                  {products.map((p) => (
                    <td key={p.card.id} className={td}>
                      {p.warrantyMonths ? t('warrantyMonths', { count: p.warrantyMonths }) : none}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className={th}>
                    {t('variants')}
                  </th>
                  {products.map((p) => (
                    <td key={p.card.id} className={td}>
                      {p.capacities.length + p.colors.length === 0 ? (
                        none
                      ) : (
                        <span className="flex flex-col gap-0.5 [unicode-bidi:plaintext]">
                          {p.capacities.length > 0 ? <span>{p.capacities.join(' · ')}</span> : null}
                          {p.colors.length > 0 ? <span className="text-muted">{p.colors.join(' · ')}</span> : null}
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
                {specs.map((row) => (
                  <tr key={row.label}>
                    <th scope="row" className={th}>
                      {row.label}
                    </th>
                    {row.values.map((v, i) => (
                      <td key={products[i]!.card.id} className={td}>
                        {v ?? none}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <td className={th} />
                  {products.map(({ card }) => (
                    <td key={card.id} className={td}>
                      <Link href={productPath(card.slug)} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                        {t('view')}
                      </Link>
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
