import type { Metadata } from 'next';
import { Languages, Palette, UserRound } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { HudCorners } from '@/components/ui/HudCorners';
import { LanguagePicker, ProfileDetailsForm, ThemePicker } from '@/components/account/ProfileForms';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.profilePage' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function ProfilePage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/account/profile' });
  const t = await getTranslations('account.profilePage');

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} fallbackHref="/account" />
      <div className="page-container mt-5 grid grid-cols-1 gap-5 lg:mt-6 lg:grid-cols-12">
        <Card tone="glass" className="relative lg:col-span-7">
          <HudCorners size={12} />
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <UserRound size={20} aria-hidden="true" className="text-cyan" />
            {t('detailsTitle')}
          </h2>
          <p className="mb-4 text-sm text-muted">{t('detailsText')}</p>
          <ProfileDetailsForm fullName={user.fullName} email={user.email} phone={user.phone} />
        </Card>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-5">
          <Card tone="glass">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Languages size={20} aria-hidden="true" className="text-cyan" />
              {t('languageTitle')}
            </h2>
            <p className="mb-4 text-sm text-muted">{t('languageText')}</p>
            <LanguagePicker />
          </Card>
          <Card tone="glass">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <Palette size={20} aria-hidden="true" className="text-cyan" />
              {t('themeTitle')}
            </h2>
            <p className="mb-4 text-sm text-muted">{t('themeText')}</p>
            <ThemePicker />
          </Card>
        </div>
      </div>
    </div>
  );
}
