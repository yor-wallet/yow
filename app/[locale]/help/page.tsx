import type { Metadata } from 'next';
import { BadgePercent, ChevronDown, CreditCard, LifeBuoy, RotateCcw, ShieldCheck, Truck, UserRound, type LucideIcon } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { PageHeader } from '@/components/layout/PageHeader';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { HudCorners } from '@/components/ui/HudCorners';
import { buttonClasses } from '@/components/ui/Button';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.help' });
  return { title: t('metaTitle'), description: t('subtitle') };
}

/** FAQ structure: category → question ids (copy in messages/{locale}/account.json → help.faq). */
const FAQ = {
  delivery: ['1', '2', '3', '4'],
  payments: ['1', '2', '3'],
  flex: ['1', '2', '3'],
  returns: ['1', '2'],
  warranty: ['1', '2'],
  account: ['1', '2'],
} as const;
type Category = keyof typeof FAQ;

const ICONS: Record<Category, LucideIcon> = {
  delivery: Truck,
  payments: CreditCard,
  flex: BadgePercent,
  returns: RotateCcw,
  warranty: ShieldCheck,
  account: UserRound,
};

/** Help centre: FAQ in 3 languages (delivery, payments, FLEX, returns, warranty, account). Public page. */
export default async function HelpPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const t = await getTranslations('account.help');
  const categories = Object.keys(FAQ) as Category[];

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} subtitle={t('subtitle')} fallbackHref="/" />
      <div className="page-container mt-5 grid grid-cols-1 gap-8 lg:mt-6 lg:grid-cols-12">
        <nav aria-label={t('categoriesLabel')} className="min-w-0 lg:col-span-3">
          <ul data-scroll-x className="scrollbar-none flex gap-2 overflow-x-auto py-1 lg:sticky lg:top-28 lg:flex-col lg:overflow-visible">
            {categories.map((c) => {
              const Icon = ICONS[c];
              return (
                <li key={c} className="shrink-0">
                  <a
                    href={`#faq-${c}`}
                    className="inline-flex min-h-11 w-full items-center gap-2 rounded-pill border border-border bg-surface/80 px-4 text-sm font-semibold text-muted backdrop-blur transition-colors duration-(--dur-btn) hover:border-cyan/50 hover:text-fg lg:rounded-xl"
                  >
                    <Icon size={16} aria-hidden="true" className="text-cyan" />
                    {t(`categories.${c}`)}
                  </a>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="flex min-w-0 flex-col gap-10 lg:col-span-9" data-testid="help-faq">
          {categories.map((c) => (
            <section key={c} id={`faq-${c}`} aria-labelledby={`faq-${c}-title`} className="scroll-mt-28">
              <SectionHeading id={`faq-${c}-title`} eyebrow="FAQ" title={t(`categories.${c}`)} />
              <div className="flex flex-col gap-2.5">
                {FAQ[c].map((q) => (
                  <details
                    key={q}
                    className="holo-border-hover group rounded-card border border-border bg-surface/80 shadow-card backdrop-blur open:border-cyan/40"
                  >
                    <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold sm:px-5 [&::-webkit-details-marker]:hidden">
                      <span className="min-w-0">{t(`faq.${c}.q${q}` as 'faq.delivery.q1')}</span>
                      <ChevronDown size={18} aria-hidden="true" className="shrink-0 text-cyan transition-transform duration-(--dur-btn) group-open:rotate-180" />
                    </summary>
                    <p className="px-4 pb-4 text-sm leading-relaxed text-muted sm:px-5">{t(`faq.${c}.a${q}` as 'faq.delivery.a1')}</p>
                  </details>
                ))}
              </div>
            </section>
          ))}

          <section aria-labelledby="help-contact" className="relative overflow-hidden rounded-card holo-border p-6 shadow-card sm:p-8">
            <HudCorners />
            <span aria-hidden="true" className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-cyan/15 blur-3xl" />
            <div className="relative flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <h2 id="help-contact" className="text-xl font-bold">
                  {t('contactTitle')}
                </h2>
                <p className="mt-1 text-sm text-muted">{t('contactText')}</p>
              </div>
              <div className="flex flex-wrap gap-3">
                <Link href="/account/support/new" className={buttonClasses({ variant: 'primary' })}>
                  <LifeBuoy size={18} aria-hidden="true" />
                  {t('contactCta')}
                </Link>
                <Link href="/delivery" className={buttonClasses({ variant: 'outline' })}>
                  {t('deliveryCta')}
                </Link>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
