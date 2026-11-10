'use client';

import { useEffect, useMemo, useState, useTransition } from 'react';
import { AlertCircle, Check, MapPin, Plus, Tag, Truck, Zap } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { AddressForm } from '@/components/account/AddressForm';
import type { SavedAddress } from '@/components/account/address-actions';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Textarea } from '@/components/ui/Textarea';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { Price } from '@/components/ui/Price';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { formatBaisa } from '@/lib/money';
import type { GovernorateOption } from '@/lib/delivery/geo';
import { placeOrderAction, type CheckoutErrorKey } from '@/app/[locale]/(shop)/checkout/actions';
import { ShopImage } from './ShopImage';

export type CheckoutAddress = {
  id: string;
  label: string | null;
  recipientName: string;
  phone: string;
  area: string;
  building: string;
  street: string | null;
  wilaya: string;
  governorate: string;
  isDefault: boolean;
};
export type CheckoutLine = { id: string; name: string; variantLabel: string | null; qty: number; lineTotalBaisa: number; image: string | null };
export type DeliveryChoice = { available: boolean; feeBaisa?: number; etaHours?: number; reason?: string | null };
export type CheckoutMethod = { id: 'WALLET' | 'CARD' | 'OOREDOO' | 'OMANTEL' | 'CRYPTO' | 'FLEX' | 'GIFT_CARD'; available: boolean; reason?: string | null };
export type CheckoutQuoteView = {
  ready: boolean;
  subtotalBaisa: number;
  discountBaisa: number;
  promoStatus: 'none' | 'applied' | 'invalid' | 'not_better';
  promoCode: string;
  delivery: { STANDARD: DeliveryChoice; EXPRESS: DeliveryChoice } | null;
  expressEligible: boolean;
  deliveryType: 'STANDARD' | 'EXPRESS' | null;
  totalBaisa: number | null;
  deliveryFeeBaisa: number | null;
};

const RESERVATION_MINUTES = 15;
type Method = CheckoutMethod['id'];
const ORDERABLE = ['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO'] as const;
type OrderableMethod = (typeof ORDERABLE)[number];
/** FLEX and gift cards cannot pay an order from checkout (the registry says why). */
const isOrderable = (id: Method): id is OrderableMethod => (ORDERABLE as readonly string[]).includes(id);
/** Reasons (quote.reasons.*) the delivery namespace can translate. */
const DELIVERY_REASONS = new Set(['invalid_input', 'zone_not_found', 'zone_inactive', 'not_configured', 'express_not_offered', 'not_express_eligible', 'parcel_unknown', 'capacity_full', 'capacity_not_configured', 'after_cutoff']);
const PAYMENT_REASONS = new Set(['not_configured', 'carrier_agreement_required', 'licensed_processor_required', 'login_required', 'insufficient_balance', 'wallet_frozen', 'gift_card_via_wallet', 'flex_apply_from_product', 'amount_below_minimum', 'amount_above_maximum']);

/** One idempotency key per (cart contents, address, delivery, promo, method): reused on retry / Back / double-click. */
function useIdempotencyKey(signature: string): string {
  const [key, setKey] = useState('');
  useEffect(() => {
    const storageKey = `doom:checkout:${signature}`;
    try {
      let k = sessionStorage.getItem(storageKey);
      if (!k) {
        k = crypto.randomUUID().replace(/-/g, '') + Math.random().toString(36).slice(2, 10);
        sessionStorage.setItem(storageKey, k);
      }
      setKey(k);
    } catch {
      setKey(crypto.randomUUID().replace(/-/g, ''));
    }
  }, [signature]);
  return key;
}

export function CheckoutForm({
  lines,
  addresses,
  governorates,
  selectedAddressId,
  quote,
  methods,
  defaults,
}: {
  lines: CheckoutLine[];
  addresses: CheckoutAddress[];
  governorates: GovernorateOption[];
  selectedAddressId: string | null;
  quote: CheckoutQuoteView;
  methods: CheckoutMethod[];
  defaults: { recipientName: string; phone: string | null };
}) {
  const t = useTranslations('checkout');
  const tp = useTranslations('payments');
  const td = useTranslations('delivery');
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const addressSheet = useHistoryModal('checkout-address');
  const [navigating, startNav] = useTransition();
  const [placing, startPlace] = useTransition();
  const [promo, setPromo] = useState(quote.promoCode);
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<CheckoutErrorKey | null>(null);

  const firstAvailable = methods.find((m) => m.available && isOrderable(m.id))?.id ?? null;
  const [method, setMethod] = useState<Method | null>(firstAvailable);
  // A method that stops being available (total changed, balance too low) is dropped.
  const chosen = methods.find((m) => m.id === method && m.available) ? method : firstAvailable;

  const total = quote.totalBaisa;
  const canPlace = quote.ready && !!selectedAddressId && !!quote.deliveryType && total !== null && !!chosen;

  const signature = useMemo(
    () => [lines.map((l) => `${l.id}:${l.qty}`).join(','), selectedAddressId, quote.deliveryType, quote.promoCode, chosen, total].join('|'),
    [lines, selectedAddressId, quote.deliveryType, quote.promoCode, chosen, total],
  );
  const idempotencyKey = useIdempotencyKey(signature);

  /** Re-quote through the URL (address / delivery / promo live in search params, so Back works). */
  const update = (next: { address?: string | null; delivery?: string | null; promo?: string | null }) => {
    const query: Record<string, string> = {};
    const address = next.address === undefined ? selectedAddressId : next.address;
    const delivery = next.delivery === undefined ? quote.deliveryType : next.delivery;
    const code = next.promo === undefined ? quote.promoCode : next.promo;
    if (address) query.address = address;
    if (delivery) query.delivery = delivery;
    if (code) query.promo = code;
    setError(null);
    startNav(() => router.replace({ pathname, query }, { scroll: false }));
  };

  const place = () => {
    if (!canPlace || !selectedAddressId || !quote.deliveryType || total === null || !chosen || !idempotencyKey) return;
    setError(null);
    startPlace(async () => {
      const res = await placeOrderAction({
        idempotencyKey,
        addressId: selectedAddressId,
        deliveryType: quote.deliveryType!,
        paymentMethod: chosen as OrderableMethod,
        promoCode: quote.promoCode || null,
        notes: notes || null,
        expectedTotalBaisa: total,
      });
      // Success redirects (this code is not reached); only failures come back.
      if (res && !res.ok) {
        setError(res.error);
        if (res.error === 'price_changed' || res.error === 'cart_changed' || res.error === 'out_of_stock') router.refresh();
      }
    });
  };

  const onAddressSaved = (a: SavedAddress) => {
    addressSheet.closeThen(() => update({ address: a.id, delivery: null }));
  };

  const reasonText = (kind: 'delivery' | 'payment', reason?: string | null) => {
    if (!reason) return null;
    if (kind === 'delivery') return DELIVERY_REASONS.has(reason) ? td(`quote.reasons.${reason as 'invalid_input'}`) : td('quote.reasons.not_configured');
    return PAYMENT_REASONS.has(reason) ? tp(`reasons.${reason as 'not_configured'}`) : tp('reasons.not_configured');
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:gap-8" aria-busy={navigating || undefined}>
      <div className="flex min-w-0 flex-col gap-6">
        {/* 1 — address */}
        <Section icon={<MapPin size={20} aria-hidden="true" />} title={t('steps.address')} id="co-address">
          {addresses.length === 0 ? (
            <p className="text-sm text-muted" data-testid="no-address">{t('address.empty')}</p>
          ) : (
            <ul role="radiogroup" aria-labelledby="co-address-title" className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="address-list">
              {addresses.map((a) => {
                const on = a.id === selectedAddressId;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => update({ address: a.id, delivery: null })}
                      data-testid="address-option"
                      className={cn(
                        'flex h-full w-full flex-col gap-1 rounded-card border p-4 text-start transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        on ? 'border-blue bg-blue/8 shadow-glow-blue' : 'border-border bg-surface hover:border-border-strong',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{a.label || a.recipientName}</span>
                        {on ? <Check size={18} aria-hidden="true" className="text-accent" /> : a.isDefault ? <span className="text-xs text-muted">{t('address.default')}</span> : null}
                      </span>
                      {a.label ? <span className="text-sm">{a.recipientName}</span> : null}
                      <span className="text-sm text-muted">{t('address.area', { area: a.area, wilaya: a.wilaya, governorate: a.governorate })}</span>
                      <span className="text-sm text-muted [unicode-bidi:isolate]">{[a.building, a.street].filter(Boolean).join(' · ')}</span>
                      <span className="text-xs text-muted [unicode-bidi:isolate]">{t('address.phone', { phone: a.phone })}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <Button type="button" variant="secondary" size="sm" className="mt-3 self-start" onClick={addressSheet.open} leadingIcon={<Plus size={18} aria-hidden="true" />} data-testid="add-address">
            {addresses.length === 0 ? t('address.add') : t('address.addAnother')}
          </Button>
        </Section>

        {/* 2 — delivery */}
        <Section icon={<Truck size={20} aria-hidden="true" />} title={t('steps.delivery')} id="co-delivery">
          {!quote.delivery ? (
            <p className="text-sm text-muted" data-testid="delivery-need-address">{t('delivery.needAddress')}</p>
          ) : (
            <ul role="radiogroup" aria-labelledby="co-delivery-title" className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="delivery-list">
              {(['STANDARD', 'EXPRESS'] as const).map((type) => {
                const opt = quote.delivery![type];
                const on = quote.deliveryType === type;
                const blockedByItem = type === 'EXPRESS' && !quote.expressEligible;
                return (
                  <li key={type}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      disabled={!opt.available}
                      onClick={() => update({ delivery: type })}
                      data-testid={`delivery-${type.toLowerCase()}`}
                      className={cn(
                        'flex h-full w-full flex-col gap-1 rounded-card border p-4 text-start transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
                        on ? 'border-blue bg-blue/8 shadow-glow-blue' : 'border-border bg-surface enabled:hover:border-border-strong',
                      )}
                    >
                      <span className="flex items-center justify-between gap-2 font-semibold">
                        <span className="flex items-center gap-2">
                          {type === 'EXPRESS' ? <Zap size={16} aria-hidden="true" className="text-amber" /> : <Truck size={16} aria-hidden="true" className="text-accent" />}
                          {t(`delivery.${type}`)}
                        </span>
                        {on ? <Check size={18} aria-hidden="true" className="text-accent" /> : null}
                      </span>
                      {opt.available ? (
                        <>
                          <span className="text-sm">{opt.feeBaisa === 0 ? <span className="font-semibold text-success">{t('delivery.free')}</span> : <Price baisa={opt.feeBaisa ?? null} size="md" />}</span>
                          {typeof opt.etaHours === 'number' ? <span className="text-xs text-muted">{t('delivery.eta', { hours: opt.etaHours })}</span> : null}
                        </>
                      ) : (
                        <>
                          <span className="text-sm font-medium text-muted">{t('delivery.unavailable')}</span>
                          <span className="text-xs text-muted">{blockedByItem ? t('delivery.expressIneligible') : reasonText('delivery', opt.reason)}</span>
                        </>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>

        {/* 3 — promo */}
        <Section icon={<Tag size={20} aria-hidden="true" />} title={t('steps.promo')} id="co-promo">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              update({ promo: promo.trim().toUpperCase() || null });
            }}
          >
            <Input
              id="co-promo-input"
              label={t('promo.label')}
              value={promo}
              onChange={(e) => setPromo(e.target.value)}
              placeholder={t('promo.placeholder')}
              maxLength={40}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              containerClassName="min-w-52 flex-1"
              data-testid="promo-input"
            />
            <Button type="submit" variant="secondary" disabled={!promo.trim() && !quote.promoCode} data-testid="promo-apply">
              {t('promo.apply')}
            </Button>
            {quote.promoCode ? (
              <Button type="button" variant="ghost" onClick={() => { setPromo(''); update({ promo: null }); }}>
                {t('promo.remove')}
              </Button>
            ) : null}
          </form>
          {quote.promoStatus === 'invalid' ? <p role="alert" className="mt-2 text-sm font-medium text-error" data-testid="promo-status">{t('promo.invalid')}</p> : null}
          {quote.promoStatus === 'not_better' ? <p role="status" className="mt-2 text-sm text-amber" data-testid="promo-status">{t('promo.not_better')}</p> : null}
          {quote.promoStatus === 'applied' ? <p role="status" className="mt-2 text-sm font-medium text-success" data-testid="promo-status">{t('promo.applied', { amount: formatBaisa(quote.discountBaisa, locale) })}</p> : null}
          {quote.promoStatus === 'none' && quote.discountBaisa > 0 ? <p role="status" className="mt-2 text-sm font-medium text-success" data-testid="promo-status">{t('promo.automatic', { amount: formatBaisa(quote.discountBaisa, locale) })}</p> : null}
        </Section>

        {/* 4 — payment */}
        <Section icon={<Check size={20} aria-hidden="true" />} title={t('steps.payment')} id="co-payment">
          <p className="mb-3 text-sm text-muted">{t('payment.text')}</p>
          {methods.filter((m) => isOrderable(m.id)).length === 0 ? (
            <p className="text-sm text-muted">{t('payment.none')}</p>
          ) : (
            <ul role="radiogroup" aria-labelledby="co-payment-title" className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="payment-list">
              {methods
                .filter((m) => isOrderable(m.id))
                .map((m) => {
                  const on = chosen === m.id;
                  return (
                    <li key={m.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={on}
                        disabled={!m.available}
                        onClick={() => setMethod(m.id)}
                        data-testid={`payment-${m.id.toLowerCase()}`}
                        className={cn(
                          'flex h-full w-full flex-col gap-1 rounded-card border p-4 text-start transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-60',
                          on ? 'border-blue bg-blue/8 shadow-glow-blue' : 'border-border bg-surface enabled:hover:border-border-strong',
                        )}
                      >
                        <span className="flex items-center justify-between gap-2 font-semibold">
                          {tp(`methods.${m.id}.label`)}
                          {on ? <Check size={18} aria-hidden="true" className="text-accent" /> : null}
                        </span>
                        <span className="text-sm text-muted">{m.available ? tp(`methods.${m.id}.description`) : reasonText('payment', m.reason)}</span>
                        {!m.available ? <span className="text-xs font-medium text-muted">{t('payment.unavailable')}</span> : null}
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}
        </Section>

        <Section icon={<AlertCircle size={20} aria-hidden="true" />} title={t('steps.notes')} id="co-notes">
          <Textarea id="co-notes-input" label={t('notes.label')} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('notes.placeholder')} maxLength={500} rows={3} />
        </Section>
      </div>

      {/* summary */}
      <aside className="flex h-fit flex-col gap-4 rounded-card border border-border bg-surface p-4 shadow-card sm:p-5 lg:sticky lg:top-24" aria-labelledby="co-summary-title" data-testid="checkout-summary">
        <div className="flex items-center justify-between gap-2">
          <h2 id="co-summary-title" className="text-lg font-bold">{t('summary.title')}</h2>
          <Link href="/cart" className="inline-flex min-h-11 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline">{t('summary.editCart')}</Link>
        </div>
        <ul className="flex flex-col gap-3">
          {lines.map((l) => (
            <li key={l.id} className="flex gap-3">
              <span className="block size-14 shrink-0 overflow-hidden rounded-lg bg-surface-2">
                {l.image ? <ShopImage src={l.image} width={160} height={160} alt="" sizes="56px" className="size-full object-contain p-0.5" /> : null}
              </span>
              <span className="min-w-0 flex-1">
                <span className="line-clamp-2 text-sm font-medium">{l.name}</span>
                <span className="block text-xs text-muted">{[l.variantLabel, t('summary.qty', { qty: l.qty })].filter(Boolean).join(' · ')}</span>
              </span>
              <span className="text-sm font-semibold tabular-nums [unicode-bidi:isolate]">{formatBaisa(l.lineTotalBaisa, locale)}</span>
            </li>
          ))}
        </ul>
        <dl className="flex flex-col gap-2 border-t border-border pt-3 text-sm">
          <Row label={t('summary.subtotal')} value={formatBaisa(quote.subtotalBaisa, locale)} />
          {quote.discountBaisa > 0 ? <Row label={t('summary.discount')} value={`−${formatBaisa(quote.discountBaisa, locale)}`} tone="success" /> : null}
          <Row
            label={t('summary.delivery')}
            value={quote.deliveryFeeBaisa === null ? t('summary.deliveryPending') : quote.deliveryFeeBaisa === 0 ? t('delivery.free') : formatBaisa(quote.deliveryFeeBaisa, locale)}
            muted={quote.deliveryFeeBaisa === null}
          />
          <div className="flex items-baseline justify-between gap-3 border-t border-border pt-3">
            <dt className="text-base font-bold">{t('summary.total')}</dt>
            <dd className="text-2xl font-extrabold tabular-nums text-price [unicode-bidi:isolate]" data-testid="checkout-total">
              {total === null ? <span className="text-sm font-medium text-muted">{t('summary.totalPending')}</span> : formatBaisa(total, locale)}
            </dd>
          </div>
        </dl>

        {error ? (
          <p role="alert" className="flex items-start gap-2 rounded-xl border border-error/40 bg-error/10 p-3 text-sm font-medium text-error" data-testid="checkout-error">
            <AlertCircle size={16} aria-hidden="true" className="mt-0.5 shrink-0" />
            {t(`errors.${error}`)}
          </p>
        ) : null}
        {!canPlace && quote.ready ? <p className="text-xs text-muted" data-testid="checkout-incomplete">{t('incomplete')}</p> : null}

        <Button type="button" variant="accent" size="lg" fullWidth disabled={!canPlace || !idempotencyKey} loading={placing} loadingLabel={t('placing')} onClick={place} data-testid="place-order">
          {total === null ? t('place') : t('placeAndPay', { amount: formatBaisa(total, locale) })}
        </Button>
        <p className="text-center text-xs text-muted">{t('reserved', { minutes: RESERVATION_MINUTES })}</p>
      </aside>

      <BottomSheet {...addressSheet.props} title={t('address.newTitle')}>
        <AddressForm governorates={governorates} defaults={defaults} draftKey="checkout-address" onSaved={onAddressSaved} onCancel={addressSheet.close} />
      </BottomSheet>
    </div>
  );
}

function Section({ icon, title, id, children }: { icon: React.ReactNode; title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={`${id}-title`} className="flex flex-col rounded-card border border-border bg-surface/60 p-4 shadow-card sm:p-5" data-testid={id}>
      <h2 id={`${id}-title`} className="mb-3 flex items-center gap-2 text-lg font-bold">
        <span className="text-accent">{icon}</span>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Row({ label, value, tone, muted }: { label: string; value: string; tone?: 'success'; muted?: boolean }) {
  return (
    <div className={cn('flex items-center justify-between gap-3', tone === 'success' && 'text-success')}>
      <dt className={muted ? 'text-muted' : undefined}>{label}</dt>
      <dd className={cn('font-semibold tabular-nums [unicode-bidi:isolate]', muted && 'text-xs font-medium text-muted')}>{value}</dd>
    </div>
  );
}
