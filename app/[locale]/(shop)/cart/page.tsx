import type { Metadata } from 'next';
import { ShoppingBag } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { getCartView } from '@/lib/cart';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CartLines } from '@/components/shop/CartLines';
import { CartSummary } from '@/components/shop/CartSummary';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'cart' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function CartPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, cart] = await Promise.all([getTranslations('cart'), getCartView(locale)]);
  const hasUnavailable = cart.lines.some((l) => l.state === 'out_of_stock' || l.state === 'unavailable');

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={cart.lines.length > 0 ? t('count', { count: cart.totals.itemCount }) : undefined} fallbackHref="/" />
      <div className="page-container pt-4 lg:pt-6">
        {cart.lines.length === 0 ? (
          <EmptyState
            icon={<ShoppingBag size={26} />}
            title={t('emptyTitle')}
            description={t('emptyText')}
            action={
              <Link href="/categories" className={buttonClasses({ variant: 'primary' })}>
                {t('shop')}
              </Link>
            }
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-8">
            <CartLines lines={cart.lines} />
            <CartSummary totals={cart.totals} hasUnavailable={hasUnavailable} />
          </div>
        )}
      </div>
    </div>
  );
}
