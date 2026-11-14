import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { getAddress } from '@/lib/delivery/addresses';
import { getGovernorateOptions } from '@/lib/delivery/geo';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { AddressForm } from '@/components/account/AddressForm';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.addresses' });
  return { title: t('editTitle'), robots: { index: false } };
}

export default async function EditAddressPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: `/account/addresses/${id}` });
  const [t, governorates, address] = await Promise.all([
    getTranslations('account.addresses'),
    getGovernorateOptions(),
    getAddress(user.id, id.slice(0, 64)),
  ]);
  if (!address) notFound();
  return (
    <div>
      <PageHeader title={t('editTitle')} fallbackHref="/account/addresses" />
      <div className="page-container mt-5 lg:mt-6">
        <Card className="mx-auto max-w-3xl">
          <AddressForm
            governorates={governorates}
            address={{
              id: address.id,
              label: address.label ?? '',
              recipientName: address.recipientName,
              phone: address.phone,
              governorateId: address.governorateId,
              wilayaId: address.wilayaId,
              neighborhoodId: address.neighborhoodId ?? undefined,
              area: address.area,
              building: address.building,
              street: address.street ?? '',
              instructions: address.instructions ?? '',
              isDefault: address.isDefault,
              lat: address.lat,
              lng: address.lng,
            }}
          />
        </Card>
      </div>
    </div>
  );
}
