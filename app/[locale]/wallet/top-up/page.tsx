import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { getWalletLimits } from '@/lib/wallet';
import { listPaymentMethods } from '@/lib/payments/registry';
import { PageHeader } from '@/components/layout/PageHeader';
import { HudCorners } from '@/components/ui/HudCorners';
import { TopUpForm } from '@/components/wallet/TopUpForm';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'wallet.topUp' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function TopUpPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/wallet/top-up' });
  const t = await getTranslations('wallet.topUp');
  const [limits, methods] = await Promise.all([getWalletLimits(), listPaymentMethods({ purpose: 'TOPUP', amountBaisa: 0, userId: user.id })]);
  return (
    <div className="pb-16">
      <PageHeader title={t('title')} fallbackHref="/wallet" />
      <div className="page-container mt-4 lg:mt-8">
        <div className="relative mx-auto max-w-2xl rounded-card border border-border bg-surface p-5 shadow-card sm:p-7">
          <HudCorners />
          <span className="hud-label">{t('eyebrow')}</span>
          <div className="mt-5">
            <TopUpForm methods={methods} minBaisa={limits.minTopUpBaisa} maxBaisa={limits.maxTopUpBaisa} />
          </div>
        </div>
      </div>
    </div>
  );
}
