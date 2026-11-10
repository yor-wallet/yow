import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { getPaymentIntentView, refreshPaymentIntent } from '@/lib/payments/core';
import { PageHeader } from '@/components/layout/PageHeader';
import { PaymentStatus } from '@/components/payments/PaymentStatus';

/**
 * Return page of every provider (`success_url` / `cancel_url`) and status page of any payment.
 * State is re-read from the server (and, while pending, checked with the provider by the
 * server); query parameters are never trusted. Visiting it again — Back, refresh — never
 * starts or repeats a payment.
 */
type Props = { params: Promise<{ locale: string; intentId: string }>; searchParams: Promise<{ cancelled?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'payments.status' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function PaymentStatusPage({ params, searchParams }: Props) {
  const { locale: raw, intentId } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(intentId)) notFound();
  const { user } = await requireUser({ next: `/pay/${intentId}` });
  const viewer = { id: user.id, role: user.role };
  let view = await getPaymentIntentView(intentId, viewer);
  if (!view) notFound();
  if (['CREATED', 'PENDING', 'REQUIRES_ACTION'].includes(view.status) && view.provider !== 'WALLET') {
    try {
      await refreshPaymentIntent(intentId, 'return');
      view = (await getPaymentIntentView(intentId, viewer)) ?? view;
    } catch (err) {
      console.error('[pay] status refresh failed', err instanceof Error ? err.message : err);
    }
  }
  const t = await getTranslations('payments.status');
  const fallback =
    view.purpose === 'ORDER' && view.orderNumber
      ? `/orders/${view.orderNumber}`
      : view.purpose === 'INSTALLMENT' && view.flexApplicationId
        ? `/flex/${view.flexApplicationId}`
        : '/wallet';
  return (
    <div className="pb-16">
      <PageHeader title={t('title')} fallbackHref={fallback} />
      <div className="page-container mt-4 lg:mt-8">
        <div className="mx-auto max-w-2xl">
          <PaymentStatus initial={view} cancelled={(await searchParams).cancelled === '1'} />
        </div>
      </div>
    </div>
  );
}
