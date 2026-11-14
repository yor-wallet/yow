import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { formatDeclaredValue, getGiftCardForAdmin } from '@/lib/admin/gift-cards';
import { getSetting } from '@/lib/admin/settings';
import { formatBaisa } from '@/lib/money';
import { giftCardBrandLabel } from '@/lib/payments/giftcard-brands';
import { AdminForm, FMoney, FSelect, FTextarea } from '@/components/admin/AdminForm';
import { GiftCardCodeReveal } from '@/components/admin/GiftCardCodeReveal';
import { AdminPageHeader, StatusBadge } from '@/components/admin/ui';
import { reviewGiftCardAction } from '../actions';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('giftCards.detailTitle'), robots: { index: false } };
}

const BADGE: Record<string, string> = { SUBMITTED: 'DRAFT', UNDER_REVIEW: 'DRAFT', VERIFIED: 'ACTIVE', REJECTED: 'ARCHIVED' };

export default async function AdminGiftCardDetailPage({ params }: Props) {
  const { locale: raw, id } = await params;
  const locale = asLocale(raw);
  setRequestLocale(locale);
  const ctx = await requireAdmin('giftcards:review', `/admin/finance/gift-cards/${id}`);
  const card = await getGiftCardForAdmin(id);
  if (!card) notFound();
  const [tt, tk, format, feeBps] = await Promise.all([getTranslations('admin.giftCards'), getTranslations('admin.kyc'), getFormatter(), getSetting('giftcard.feeBps')]);
  const t = tt as unknown as (key: string, values?: Record<string, string | number>) => string;
  const kycLabel = tk as unknown as (key: string) => string;
  const open = card.status === 'SUBMITTED' || card.status === 'UNDER_REVIEW';
  const ownCard = card.user.id === ctx.actor.id;
  const date = (d: Date) => format.dateTime(d, { dateStyle: 'medium', timeStyle: 'short' });
  const brand = giftCardBrandLabel(card.brand, t('otherBrand'));
  const percent = format.number(feeBps / 10_000, { style: 'percent', maximumFractionDigits: 2 });
  const credited = card.status === 'VERIFIED' && card.encashedValueBaisa !== null ? card.encashedValueBaisa - (card.commissionBaisa ?? 0) : null;

  return (
    <>
      <AdminPageHeader title={brand} subtitle={t('detailTitle')} backHref="/admin/finance/gift-cards" />
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,22rem)]">
        <section className="flex flex-col gap-4">
          <div className="rounded-card border border-border bg-surface p-4" data-testid="giftcard-card">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-base font-bold">{t('card')}</h2>
              <StatusBadge status={BADGE[card.status] ?? 'DRAFT'} label={t(`status.${card.status}`)} testId="giftcard-status" />
            </div>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{t('brand')}</dt><dd className="font-semibold">{brand}</dd></div>
              <div><dt className="text-muted">{t('declaredValue')}</dt><dd className="font-semibold" dir="ltr">{formatDeclaredValue(card.declaredValue, card.declaredCurrency)}</dd></div>
              <div><dt className="text-muted">{t('codeEnding')}</dt><dd className="font-mono font-semibold" dir="ltr">{card.codeLast4 ? `•••• ${card.codeLast4}` : '—'}</dd></div>
              <div><dt className="text-muted">{t('sentLabel')}</dt><dd>{date(card.createdAt)}</dd></div>
            </dl>
            {ownCard ? null : <GiftCardCodeReveal id={card.id} />}
          </div>

          <div className="rounded-card border border-border bg-surface p-4" data-testid="giftcard-customer">
            <h2 className="text-base font-bold">{t('customer')}</h2>
            <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
              <div><dt className="text-muted">{t('name')}</dt><dd className="font-semibold">{card.user.fullName}</dd></div>
              <div><dt className="text-muted">{t('email')}</dt><dd className="break-all font-semibold" dir="ltr">{card.user.email}</dd></div>
              <div><dt className="text-muted">{t('phone')}</dt><dd className="font-semibold" dir="ltr">{card.user.phone ?? '—'}</dd></div>
              <div><dt className="text-muted">{t('identity')}</dt><dd className="font-semibold">{kycLabel(`status.${card.user.kycStatus}`)}</dd></div>
              <div><dt className="text-muted">{t('accountSince')}</dt><dd>{date(card.user.createdAt)}</dd></div>
            </dl>
          </div>

          <div className="rounded-card border border-border bg-surface p-4">
            <h2 className="text-base font-bold">{t('photo')}</h2>
            {card.hasImage ? (
              <>
                <a href={`/api/admin/gift-cards/${card.id}/image`} target="_blank" rel="noopener noreferrer" className="mt-3 block overflow-hidden rounded-xl border border-border">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={`/api/admin/gift-cards/${card.id}/image`} alt={t('photoAlt', { brand })} referrerPolicy="no-referrer" loading="lazy" className="max-h-96 w-full bg-surface-2 object-contain" data-testid="giftcard-photo" />
                </a>
                <p className="mt-3 text-xs text-muted">{t('photoAudit')}</p>
              </>
            ) : (
              <p className="mt-2 text-sm text-muted">{t('noPhoto')}</p>
            )}
          </div>
        </section>

        <aside className="self-start rounded-card border border-border bg-surface p-4" data-testid="giftcard-decision">
          <h2 className="text-base font-bold">{t('decision')}</h2>
          {!open ? (
            <dl className="mt-3 flex flex-col gap-2 text-sm" data-testid="giftcard-outcome">
              {card.encashedValueBaisa !== null ? (
                <div><dt className="text-muted">{t('encashedValue')}</dt><dd className="font-semibold">{formatBaisa(card.encashedValueBaisa, locale)}</dd></div>
              ) : null}
              {card.commissionBaisa !== null ? (
                <div><dt className="text-muted">{t('commission')}</dt><dd className="font-semibold">{formatBaisa(card.commissionBaisa, locale)}</dd></div>
              ) : null}
              {credited !== null ? (
                <div><dt className="text-muted">{t('credited')}</dt><dd className="font-semibold" data-testid="giftcard-credited">{formatBaisa(credited, locale)}</dd></div>
              ) : null}
              {card.reviewedAt ? (
                <div><dt className="text-muted">{t('reviewed')}</dt><dd>{date(card.reviewedAt)}{card.reviewedBy ? ` — ${card.reviewedBy.fullName}` : ''}</dd></div>
              ) : null}
              {card.notes ? <div><dt className="text-muted">{t('notes')}</dt><dd>{card.notes}</dd></div> : null}
              <p className="text-muted">{t('alreadyDecided')}</p>
            </dl>
          ) : ownCard ? (
            <p className="mt-2 text-sm text-muted" data-testid="giftcard-own">{t('ownCard')}</p>
          ) : (
            <AdminForm action={reviewGiftCardAction} hidden={{ id: card.id }} submitLabel={t('save')} testId="giftcard-form" className="mt-3 flex flex-col gap-4">
              <FSelect
                name="decision"
                label={t('decisionLabel')}
                defaultValue="VERIFIED"
                options={[
                  { value: 'VERIFIED', label: t('decide.VERIFIED') },
                  { value: 'REJECTED', label: t('decide.REJECTED') },
                  ...(card.status === 'SUBMITTED' ? [{ value: 'UNDER_REVIEW', label: t('decide.UNDER_REVIEW') }] : []),
                ]}
              />
              <FMoney name="encashedValue" label={t('encashedValue')} hint={feeBps > 0 ? t('encashedHintFee', { percent }) : t('encashedHint')} />
              <FTextarea name="notes" label={t('notes')} hint={t('notesHint')} rows={3} maxLength={1000} defaultValue={card.notes ?? ''} />
            </AdminForm>
          )}
        </aside>
      </div>
    </>
  );
}
