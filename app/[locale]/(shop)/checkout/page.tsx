import type { Metadata } from 'next';
import type { DeliveryType } from '@prisma/client';
import { ShoppingBag, TriangleAlert } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth';
import { priceItems } from '@/lib/cart/pricing';
import { cartItems } from '@/lib/cart/store';
import { getGovernorateOptions } from '@/lib/delivery/geo';
import { listAddresses } from '@/lib/delivery/addresses';
import { localize } from '@/lib/localized';
import { getPaymentPort } from '@/lib/orders/payments';
import { quoteLines } from '@/lib/orders/quote';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { CheckoutForm, type CheckoutAddress, type CheckoutLine, type CheckoutMethod, type CheckoutQuoteView } from '@/components/shop/CheckoutForm';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'checkout' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/**
 * Checkout. Address, delivery type and promo code live in the URL (Back works, links are shareable
 * within the account); everything shown — lines, discount, delivery fee, total, payment methods — is
 * computed here from the server cart with exactly the code path `placeOrder()` uses.
 */
export default async function CheckoutPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requireUser({ next: '/checkout' });
  const sp = await searchParams;
  const t = await getTranslations('checkout');
  const userId = session.user.id;

  const [items, addresses, governorates] = await Promise.all([cartItems({ userId }), listAddresses(userId), getGovernorateOptions()]);
  const lines = await priceItems(items, locale);

  const header = <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/cart" />;

  if (lines.length === 0) {
    return (
      <div className="pb-14">
        {header}
        <div className="page-container pt-4 lg:pt-6">
          <EmptyState
            icon={<ShoppingBag size={26} />}
            title={t('empty.title')}
            description={t('empty.text')}
            action={
              <Link href="/categories" className={buttonClasses({ variant: 'primary' })}>
                {t('empty.cta')}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const requestedAddress = first(sp.address);
  const address = addresses.find((a) => a.id === requestedAddress) ?? addresses.find((a) => a.isDefault) ?? addresses[0] ?? null;
  const requestedDelivery: DeliveryType | null = first(sp.delivery) === 'EXPRESS' ? 'EXPRESS' : first(sp.delivery) === 'STANDARD' ? 'STANDARD' : null;
  const promoCode = (first(sp.promo) ?? '').trim().slice(0, 40).toUpperCase();
  const base = { userId, locale, addressId: address?.id ?? null, promoCode: promoCode || null };

  // First pass lists the delivery options; if none was requested, pick the first AVAILABLE one and re-quote.
  let quote = await quoteLines(lines, { ...base, deliveryType: requestedDelivery });
  let deliveryType: DeliveryType | null = requestedDelivery && quote.delivery?.[requestedDelivery].available ? requestedDelivery : null;
  if (!deliveryType && quote.delivery) {
    deliveryType = quote.delivery.STANDARD.available ? 'STANDARD' : quote.delivery.EXPRESS.available ? 'EXPRESS' : null;
    if (deliveryType) quote = await quoteLines(lines, { ...base, deliveryType });
  }

  if (!quote.ready) {
    return (
      <div className="pb-14">
        {header}
        <div className="page-container pt-4 lg:pt-6">
          <EmptyState
            icon={<TriangleAlert size={26} />}
            title={t('blocked.title')}
            description={t('blocked.text')}
            action={
              <Link href="/cart" className={buttonClasses({ variant: 'primary' })}>
                {t('blocked.cta')}
              </Link>
            }
          />
        </div>
      </div>
    );
  }

  const amount = quote.totalBaisa ?? Math.max(0, quote.subtotalBaisa - quote.discountBaisa);
  const methods: CheckoutMethod[] = (await getPaymentPort().listPaymentMethods({ userId, amountBaisa: amount })).map((m) => ({ id: m.id, available: m.available, reason: m.reason ?? null }));

  const addressDtos: CheckoutAddress[] = addresses.map((a) => ({
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    area: a.area,
    building: a.building,
    street: a.street,
    wilaya: localize(a.wilaya.name, locale),
    governorate: localize(a.governorate.name, locale),
    isDefault: a.isDefault,
  }));
  const lineDtos: CheckoutLine[] = quote.lines.map((l) => ({ id: l.itemId ?? l.variantId, name: l.name, variantLabel: l.variantLabel, qty: l.allowedQty, lineTotalBaisa: l.lineTotalBaisa, image: l.image }));
  const quoteView: CheckoutQuoteView = {
    ready: quote.ready,
    subtotalBaisa: quote.subtotalBaisa,
    discountBaisa: quote.discountBaisa,
    promoStatus: quote.promoStatus,
    promoCode,
    delivery: quote.delivery
      ? {
          STANDARD: { available: quote.delivery.STANDARD.available, feeBaisa: quote.delivery.STANDARD.feeBaisa, etaHours: quote.delivery.STANDARD.etaHours, reason: quote.delivery.STANDARD.reason ?? null },
          EXPRESS: { available: quote.delivery.EXPRESS.available, feeBaisa: quote.delivery.EXPRESS.feeBaisa, etaHours: quote.delivery.EXPRESS.etaHours, reason: quote.delivery.EXPRESS.reason ?? null },
        }
      : null,
    expressEligible: quote.expressEligible,
    deliveryType,
    totalBaisa: quote.totalBaisa,
    deliveryFeeBaisa: quote.deliveryFeeBaisa,
  };

  return (
    <div className="pb-14">
      {header}
      <div className="page-container pt-4 lg:pt-6">
        <CheckoutForm
          lines={lineDtos}
          addresses={addressDtos}
          governorates={governorates}
          selectedAddressId={address?.id ?? null}
          quote={quoteView}
          methods={methods}
          defaults={{ recipientName: session.user.fullName, phone: session.user.phone }}
        />
      </div>
    </div>
  );
}
