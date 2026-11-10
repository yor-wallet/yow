import type { Metadata } from 'next';
import { MapPinPlus } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { listAddresses, MAX_ADDRESSES_PER_USER } from '@/lib/delivery/addresses';
import type { LocalizedText } from '@/lib/localized';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { buttonClasses } from '@/components/ui/Button';
import { AddressList } from '@/components/account/AddressList';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.addresses' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function AddressesPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/account/addresses' });
  const [t, rows] = await Promise.all([getTranslations('account.addresses'), listAddresses(user.id)]);
  const addresses = rows.map((a) => ({
    id: a.id,
    label: a.label,
    recipientName: a.recipientName,
    phone: a.phone,
    governorateId: a.governorateId,
    governorateName: a.governorate.name as LocalizedText,
    wilayaId: a.wilayaId,
    wilayaName: a.wilaya.name as LocalizedText,
    area: a.area,
    street: a.street,
    building: a.building,
    lat: a.lat,
    lng: a.lng,
    instructions: a.instructions,
    isDefault: a.isDefault,
  }));
  const canAdd = addresses.length < MAX_ADDRESSES_PER_USER;
  const addLink = (
    <Link href="/account/addresses/new" className={buttonClasses({ variant: 'primary', size: 'sm' })} data-testid="address-add">
      <MapPinPlus size={18} aria-hidden="true" />
      {t('add')}
    </Link>
  );

  return (
    <div>
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/account" actions={canAdd && addresses.length ? addLink : undefined} />
      <div className="page-container mt-5 lg:mt-6">
        {addresses.length === 0 ? (
          <EmptyState icon={<MapPinPlus size={26} />} title={t('emptyTitle')} description={t('emptyText')} action={addLink} />
        ) : (
          <>
            <AddressList addresses={addresses} />
            {!canAdd ? <p className="mt-4 text-sm text-muted">{t('limit', { max: MAX_ADDRESSES_PER_USER })}</p> : null}
          </>
        )}
      </div>
    </div>
  );
}
