import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { getGovernorateOptions } from '@/lib/delivery/geo';
import { safeRedirectPath } from '@/lib/validation';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { AddressForm } from '@/components/account/AddressForm';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.addresses' });
  return { title: t('newTitle'), robots: { index: false } };
}

export default async function NewAddressPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { next } = await searchParams;
  const returnTo = safeRedirectPath(next, '/account/addresses');
  const { user } = await requireUser({ next: '/account/addresses/new' });
  const [t, governorates] = await Promise.all([getTranslations('account.addresses'), getGovernorateOptions()]);
  return (
    <div>
      <PageHeader title={t('newTitle')} fallbackHref={returnTo} />
      <div className="page-container mt-5 lg:mt-6">
        <Card className="mx-auto max-w-3xl">
          <AddressForm governorates={governorates} defaults={{ recipientName: user.fullName, phone: user.phone }} redirectTo={returnTo} />
        </Card>
      </div>
    </div>
  );
}
