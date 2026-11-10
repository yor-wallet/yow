import type { Metadata } from 'next';
import { BadgeCheck, Coins, Send } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { PageHeader } from '@/components/layout/PageHeader';
import { HudCorners } from '@/components/ui/HudCorners';
import { GiftCardForm } from '@/components/wallet/GiftCardForm';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'wallet.giftCard' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function GiftCardPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireUser({ next: '/wallet/gift-card' });
  const t = await getTranslations('wallet.giftCard');
  const steps = [
    { icon: Send, text: t('steps.submit') },
    { icon: BadgeCheck, text: t('steps.verify') },
    { icon: Coins, text: t('steps.credit') },
  ];
  return (
    <div className="pb-16">
      <PageHeader title={t('title')} fallbackHref="/wallet" />
      <div className="page-container mt-4 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,7fr)]">
        <ol className="grid grid-cols-1 gap-3 self-start" aria-label={t('eyebrow')}>
          {steps.map(({ icon: Icon, text }, i) => (
            <li key={i} className="relative flex items-center gap-4 rounded-2xl glass p-4">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-premium font-display text-lg font-bold text-cyan neon-box" aria-hidden="true">
                {i + 1}
              </span>
              <Icon size={20} aria-hidden="true" className="shrink-0 text-accent" />
              <span className="min-w-0 text-sm font-medium">{text}</span>
            </li>
          ))}
        </ol>
        <div className="relative min-w-0 rounded-card glass p-5 shadow-card sm:p-7">
          <HudCorners />
          <span className="hud-label">{t('eyebrow')}</span>
          <div className="mt-5">
            <GiftCardForm />
          </div>
        </div>
      </div>
    </div>
  );
}
