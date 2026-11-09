import type { Metadata } from 'next';
import { Camera, KeyRound, Route, Truck, Zap } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { listZoneSummaries } from '@/lib/delivery/zones';
import { localize } from '@/lib/localized';
import { formatBaisa } from '@/lib/money';
import { PageHeader } from '@/components/layout/PageHeader';
import { buttonClasses } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'delivery' });
  return { title: t('metaTitle'), description: t('metaDescription') };
}

/**
 * DOOM EXPRESS information page. Every figure comes from the live zone configuration; a zone whose fees
 * are not set yet says so (SPEC: never promise what is not configured).
 */
export default async function DeliveryPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const [t, { zones, expressCutoffHour, includedWeightGrams }] = await Promise.all([getTranslations('delivery'), listZoneSummaries()]);
  const configured = zones.filter((z) => z.standard.configured).length;

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} fallbackHref="/" />
      <div className="page-container flex flex-col gap-10 pt-4 lg:pt-6">
        <section aria-labelledby="delivery-hero" data-theme="dark" className="relative overflow-hidden rounded-[28px] border border-border bg-gradient-premium p-6 text-white shadow-float sm:p-10">
          <p className="text-sm font-semibold text-cyan">{t('hero.eyebrow')}</p>
          <h2 id="delivery-hero" className="mt-2 max-w-2xl text-[clamp(1.6rem,4vw,2.6rem)] font-extrabold leading-tight">
            {t('hero.title')}
          </h2>
          <p className="mt-3 max-w-2xl text-mist">{t('hero.text')}</p>
          <dl className="mt-6 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
              <dt className="flex items-center gap-2 font-semibold">
                <Truck size={18} aria-hidden="true" /> {t('hero.standard')}
              </dt>
              <dd className="mt-1 text-sm text-mist">{t('hero.standardText')}</dd>
              <dd className="mt-1 text-lg font-bold">{t('hero.target', { hours: 24 })}</dd>
            </div>
            <div className="rounded-2xl border border-white/20 bg-white/10 p-4 backdrop-blur">
              <dt className="flex items-center gap-2 font-semibold">
                <Zap size={18} aria-hidden="true" className="text-amber" /> {t('hero.express')}
              </dt>
              <dd className="mt-1 text-sm text-mist">{t('hero.expressText')}</dd>
              <dd className="mt-1 text-lg font-bold">{t('hero.target', { hours: 6 })}</dd>
            </div>
          </dl>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link href="/orders" className={buttonClasses({ variant: 'primary' })}>
              {t('hero.trackCta')}
            </Link>
            <Link href="/account/help" className={buttonClasses({ variant: 'outline' })}>
              {t('hero.helpCta')}
            </Link>
          </div>
        </section>

        <section aria-labelledby="delivery-how">
          <h2 id="delivery-how" className="text-xl font-bold sm:text-2xl">
            {t('how.title')}
          </h2>
          <p className="mt-2 text-muted">{t('how.intro')}</p>
          <ul className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
            {(['base', 'weight', 'volume', 'express', 'free'] as const).map((k) => (
              <li key={k} className="flex gap-3 rounded-card border border-border bg-surface p-4">
                <Route size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                <span>{t(`how.${k}`)}</span>
              </li>
            ))}
            <li className="flex gap-3 rounded-card border border-border bg-surface p-4">
              <Route size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
              <span>{t('how.includedWeight', { kg: (includedWeightGrams / 1000).toString() })}</span>
            </li>
          </ul>
        </section>

        <section aria-labelledby="delivery-capacity">
          <h2 id="delivery-capacity" className="text-xl font-bold sm:text-2xl">
            {t('capacity.title')}
          </h2>
          <p className="mt-2 text-muted">{t('capacity.text')}</p>
          <p className="mt-2 text-sm font-medium">{expressCutoffHour !== null ? t('capacity.cutoff', { hour: expressCutoffHour }) : t('capacity.noCutoff')}</p>
        </section>

        <section aria-labelledby="delivery-zones" data-testid="delivery-zones">
          <h2 id="delivery-zones" className="text-xl font-bold sm:text-2xl">
            {t('zones.title')}
          </h2>
          <p className="mt-2 text-muted">{t('zones.intro')}</p>
          <p className="mt-1 text-sm font-medium text-accent">{t('zones.configuredCount', { count: configured })}</p>
          {zones.length === 0 ? (
            <EmptyState className="mt-4" compact icon={<Truck size={24} />} title={t('zones.empty')} />
          ) : (
            <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
              {zones.map((z) => (
                <li key={z.id} className="min-w-0">
                  <Card className="flex h-full flex-col gap-2">
                    <h3 className="font-bold">{localize(z.governorateName, locale)}</h3>
                    <p className="text-xs text-muted">{z.wilayaCount > 0 ? t('zones.wilayas', { count: z.wilayaCount }) : t('zones.wholeGovernorate')}</p>
                    {!z.isActive ? <p className="text-sm font-medium text-amber">{t('zones.paused')}</p> : null}
                    <dl className="mt-1 flex flex-col gap-1.5 text-sm">
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted">{t('zones.standard')}</dt>
                        <dd className="text-end font-semibold">
                          {z.standard.configured && z.standard.feeBaisa !== null ? (
                            <>
                              {t('zones.fee', { fee: formatBaisa(z.standard.feeBaisa, locale) })}
                              <span className="block text-xs font-normal text-muted">{t('zones.within', { hours: z.standard.hours })}</span>
                              {z.standard.freeFromBaisa ? <span className="block text-xs font-normal text-success">{t('zones.freeFrom', { amount: formatBaisa(z.standard.freeFromBaisa, locale) })}</span> : null}
                            </>
                          ) : (
                            <span className="font-medium text-muted">{t('zones.notConfigured')}</span>
                          )}
                        </dd>
                      </div>
                      <div className="flex items-baseline justify-between gap-3">
                        <dt className="text-muted">{t('zones.express')}</dt>
                        <dd className="text-end font-semibold">
                          {z.express.configured && z.express.surchargeBaisa !== null ? (
                            <>
                              {t('zones.surcharge', { fee: formatBaisa(z.express.surchargeBaisa, locale) })}
                              <span className="block text-xs font-normal text-muted">{t('zones.within', { hours: z.express.hours })}</span>
                            </>
                          ) : (
                            <span className="font-medium text-muted">{z.standard.configured ? t('zones.notOffered') : t('zones.notConfigured')}</span>
                          )}
                        </dd>
                      </div>
                      {z.perKgBaisa !== null ? (
                        <p className="text-xs text-muted">{t('zones.perKg', { fee: formatBaisa(z.perKgBaisa, locale) })}</p>
                      ) : null}
                    </dl>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-labelledby="delivery-handover">
          <h2 id="delivery-handover" className="text-xl font-bold sm:text-2xl">
            {t('handover.title')}
          </h2>
          <ul className="mt-4 grid grid-cols-1 gap-3 md:grid-cols-3">
            {[
              { icon: KeyRound, title: t('handover.otpTitle'), text: t('handover.otpText') },
              { icon: Camera, title: t('handover.proofTitle'), text: t('handover.proofText') },
              { icon: Route, title: t('handover.trackingTitle'), text: t('handover.trackingText') },
            ].map(({ icon: Icon, title, text }) => (
              <li key={title} className="flex gap-3 rounded-card border border-border bg-surface p-4">
                <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="mt-0.5 block text-sm text-muted">{text}</span>
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
