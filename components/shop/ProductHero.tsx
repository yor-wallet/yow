'use client';

import { useMemo, useState, useTransition } from 'react';
import { Check, Minus, Plus, Share2, ShieldCheck, ShoppingCart, Truck, Wallet, Zap } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Price } from '@/components/ui/Price';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { flexMonthlyFrom } from '@/lib/catalog/flex-preview';
import type { ProductDetail, VariantView } from '@/lib/catalog/queries';
import { MAX_QTY_PER_LINE } from '@/lib/catalog/stock';
import { formatBaisa } from '@/lib/money';
import { addToCartAction } from '@/app/[locale]/(shop)/actions';
import { cartErrorKey, FavoriteButton } from './ProductCardActions';
import { ProductGallery } from './ProductGallery';

/** "256 GB" / "1 TB" → comparable number of GB (unknown formats sort last, keeping input order). */
function capacityRank(value: string): number {
  const m = /^\s*(\d+(?:\.\d+)?)\s*(tb|gb|mb)?/i.exec(value);
  if (!m) return Number.MAX_SAFE_INTEGER;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'gb').toLowerCase();
  return unit === 'tb' ? n * 1024 : unit === 'mb' ? n / 1024 : n;
}

const purchasable = (v: VariantView) => v.priceBaisa !== null && (v.availability === 'in_stock' || v.availability === 'low_stock');

/**
 * Gallery + buy box. One client island because the gallery follows the selected variant and the
 * buy box needs its price/stock. Every price and quantity shown here comes from the server data;
 * the cart re-validates price and stock on its own (nothing here is trusted).
 */
export function ProductHero({ product, favorite }: { product: ProductDetail; favorite: boolean }) {
  const t = useTranslations('product');
  const tc = useTranslations('catalog');
  const locale = useLocale();
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  const initial = useMemo(
    () => product.variants.find((v) => v.isDefault && purchasable(v)) ?? product.variants.find(purchasable) ?? product.variants.find((v) => v.isDefault) ?? product.variants[0] ?? null,
    [product.variants],
  );
  const [selectedId, setSelectedId] = useState<string | null>(initial?.id ?? null);
  const [qty, setQty] = useState(1);
  const selected = product.variants.find((v) => v.id === selectedId) ?? null;

  const colors = useMemo(() => [...new Map(product.variants.filter((v) => v.color).map((v) => [v.color!, v.colorHex] as const)).entries()], [product.variants]);
  const capacities = useMemo(
    () => [...new Set(product.variants.map((v) => v.capacity).filter((c): c is string => !!c))].sort((a, b) => capacityRank(a) - capacityRank(b)),
    [product.variants],
  );
  const labelOnly = colors.length === 0 && capacities.length === 0 && product.variants.length > 1;

  /** Choose the best variant matching the new colour/capacity (keeps the other dimension when possible). */
  const choose = (patch: { color?: string; capacity?: string }) => {
    const color = patch.color ?? selected?.color ?? null;
    const capacity = patch.capacity ?? selected?.capacity ?? null;
    const pool = product.variants;
    const match =
      pool.find((v) => v.color === color && v.capacity === capacity) ??
      pool.find((v) => (patch.color ? v.color === patch.color : v.capacity === patch.capacity) && purchasable(v)) ??
      pool.find((v) => (patch.color ? v.color === patch.color : v.capacity === patch.capacity));
    if (match) {
      setSelectedId(match.id);
      setQty(1);
    }
  };

  const maxQty = selected ? Math.max(1, Math.min(selected.available, MAX_QTY_PER_LINE)) : 1;
  const canBuy = !!selected && purchasable(selected) && product.isSellable;
  const flexMonthly = flexMonthlyFrom(selected?.priceBaisa ?? null);
  const activeImage = product.images.find((i) => i.variantId === selectedId)?.id ?? null;

  const addToCart = (then?: 'checkout') =>
    start(async () => {
      if (!selected) {
        toast({ title: t('errors.pickVariant'), variant: 'error' });
        return;
      }
      const res = await addToCartAction(selected.id, qty);
      if (!res.ok) {
        toast({ title: tc(`errors.${cartErrorKey(res.error)}`), variant: 'error' });
        return;
      }
      if (then === 'checkout') {
        router.push('/checkout');
        return;
      }
      toast({ title: t('added'), description: `${product.name}${qty > 1 ? ` × ${qty}` : ''}`, variant: 'success' });
    });

  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title: product.name, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t('share.copied'), variant: 'success', durationMs: 2500 });
      }
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') toast({ title: t('share.failed'), variant: 'error' });
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:gap-10" data-testid="product-hero">
      <ProductGallery images={product.images} activeId={activeImage} name={product.name} />

      <div className="flex min-w-0 flex-col gap-5">
        <div className="min-w-0">
          {product.brand ? (
            <Link href={`/search?brand=${product.brand.slug}`} className="text-sm font-semibold uppercase tracking-wide text-accent underline-offset-4 hover:underline">
              {product.brand.name}
            </Link>
          ) : null}
          <h1 className="mt-1 text-2xl font-extrabold leading-tight sm:text-3xl" data-testid="product-title">
            {product.name}
          </h1>
          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
            {product.model ? <span>{t('model', { model: product.model })}</span> : null}
            <span className="[unicode-bidi:isolate]">{t('sku', { sku: selected?.sku ?? product.sku })}</span>
          </p>
        </div>

        <div className="flex flex-col gap-2" data-testid="product-price">
          {selected && selected.priceBaisa !== null ? (
            <Price baisa={selected.priceBaisa} compareAtBaisa={selected.compareAtBaisa} size="xl" showSavings />
          ) : (
            <div className="rounded-card border border-dashed border-border-strong bg-surface/50 p-3">
              <p className="font-semibold">{t('price.unavailableTitle')}</p>
              <p className="mt-0.5 text-sm text-muted">{t('price.unavailableText')}</p>
            </div>
          )}
          {selected ? (
            <p className="flex items-center gap-2 text-sm" data-testid="product-availability">
              {selected.availability === 'in_stock' ? (
                <Badge variant="success">
                  <Check size={12} aria-hidden="true" />
                  {t('availability.in_stock')}
                </Badge>
              ) : selected.availability === 'low_stock' ? (
                <Badge variant="warning">{t('availability.low_stock', { count: selected.available })}</Badge>
              ) : (
                <Badge variant="neutral">{t(`availability.${selected.availability}`)}</Badge>
              )}
            </p>
          ) : null}
          {flexMonthly !== null ? (
            <p className="text-sm text-muted">{t('flex.from', { amount: formatBaisa(flexMonthly, locale) })}</p>
          ) : null}
        </div>

        {colors.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">
              {t('variants.color')}
              {selected?.color ? <span className="ms-2 font-normal text-muted">{selected.color}</span> : null}
            </legend>
            <ul className="flex flex-wrap gap-2">
              {colors.map(([color, hex]) => {
                const on = selected?.color === color;
                return (
                  <li key={color}>
                    <button
                      type="button"
                      onClick={() => choose({ color })}
                      aria-pressed={on}
                      aria-label={color}
                      className={cn(
                        'inline-flex min-h-11 items-center gap-2 rounded-pill border px-3.5 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        on ? 'border-blue bg-blue/12 text-fg shadow-glow-blue' : 'border-border-strong hover:bg-surface-2',
                      )}
                    >
                      {hex ? <span aria-hidden="true" className="size-4 rounded-full border border-border-strong" style={{ backgroundColor: hex }} /> : null}
                      {color}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {capacities.length > 0 ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t('variants.capacity')}</legend>
            <ul className="flex flex-wrap gap-2">
              {capacities.map((cap) => {
                const on = selected?.capacity === cap;
                return (
                  <li key={cap}>
                    <button
                      type="button"
                      onClick={() => choose({ capacity: cap })}
                      aria-pressed={on}
                      className={cn(
                        'inline-flex min-h-11 items-center rounded-pill border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                        on ? 'border-blue bg-blue/12 shadow-glow-blue' : 'border-border-strong hover:bg-surface-2',
                      )}
                    >
                      {cap}
                    </button>
                  </li>
                );
              })}
            </ul>
          </fieldset>
        ) : null}

        {labelOnly ? (
          <fieldset>
            <legend className="mb-2 text-sm font-semibold">{t('variants.other')}</legend>
            <ul className="flex flex-wrap gap-2">
              {product.variants.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedId(v.id);
                      setQty(1);
                    }}
                    aria-pressed={v.id === selectedId}
                    className={cn(
                      'inline-flex min-h-11 items-center rounded-pill border px-4 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      v.id === selectedId ? 'border-blue bg-blue/12 shadow-glow-blue' : 'border-border-strong hover:bg-surface-2',
                    )}
                  >
                    {v.label ?? v.sku}
                  </button>
                </li>
              ))}
            </ul>
          </fieldset>
        ) : null}

        <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4">
          <div className="flex items-center justify-between gap-3">
            <span id="qty-label" className="text-sm font-semibold">
              {t('qty.label')}
            </span>
            <div role="group" aria-labelledby="qty-label" className="inline-flex items-center rounded-xl border border-border-strong">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} disabled={qty <= 1 || !canBuy} aria-label={t('qty.decrease')} className="grid size-11 place-items-center rounded-s-xl transition-colors hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring">
                <Minus size={18} aria-hidden="true" />
              </button>
              <output aria-live="polite" data-testid="qty-value" className="grid min-w-10 place-items-center text-base font-bold tabular-nums">
                {qty}
              </output>
              <button type="button" onClick={() => setQty((q) => Math.min(maxQty, q + 1))} disabled={qty >= maxQty || !canBuy} aria-label={t('qty.increase')} className="grid size-11 place-items-center rounded-e-xl transition-colors hover:bg-surface-2 disabled:opacity-40 focus-visible:outline-2 focus-visible:outline-ring">
                <Plus size={18} aria-hidden="true" />
              </button>
            </div>
          </div>
          {canBuy && qty >= MAX_QTY_PER_LINE ? <p className="text-xs text-muted">{t('qty.max', { max: MAX_QTY_PER_LINE })}</p> : null}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Button type="button" size="lg" fullWidth disabled={!canBuy} loading={pending} loadingLabel={t('adding')} onClick={() => addToCart()} leadingIcon={<ShoppingCart size={20} aria-hidden="true" className="flip-rtl" />} data-testid="add-to-cart">
              {t('addToCart')}
            </Button>
            <Button type="button" variant="accent" size="lg" fullWidth disabled={!canBuy} loading={pending} loadingLabel={t('adding')} onClick={() => addToCart('checkout')} data-testid="buy-now">
              {t('buyNow')}
            </Button>
          </div>
          {!canBuy && selected && selected.priceBaisa !== null ? (
            <p className="text-center text-sm font-medium text-muted">{t(`availability.${selected.availability === 'in_stock' || selected.availability === 'low_stock' ? 'unavailable' : selected.availability}`)}</p>
          ) : null}

          <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
            <FavoriteButton productId={product.id} initial={favorite} className="static" />
            <Button type="button" variant="ghost" size="sm" onClick={share} leadingIcon={<Share2 size={18} aria-hidden="true" />} data-testid="share">
              {t('share.label')}
            </Button>
          </div>
        </div>

        <ul className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
          <li className="flex gap-3 rounded-card border border-border bg-surface p-3">
            <Truck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="font-semibold">{t('delivery.title')}</p>
              <p className="text-muted">{t('delivery.standard')}</p>
              <p className="flex items-center gap-1 text-muted">
                {product.expressEligible ? <Zap size={14} aria-hidden="true" className="text-amber" /> : null}
                {product.expressEligible ? t('delivery.express') : t('delivery.notExpress')}
              </p>
              <Link href="/delivery" className="mt-1 inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
                {t('delivery.link')}
              </Link>
            </div>
          </li>
          <li className="flex gap-3 rounded-card border border-border bg-surface p-3">
            <ShieldCheck size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="font-semibold">{t('warranty.title')}</p>
              <p className="text-muted">{product.warrantyMonths ? t('warranty.months', { count: product.warrantyMonths }) : t('warranty.none')}</p>
            </div>
          </li>
          <li className="flex gap-3 rounded-card border border-border bg-surface p-3 sm:col-span-2">
            <Wallet size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
            <div className="min-w-0">
              <p className="font-semibold">{t('payments.title')}</p>
              <p className="text-muted">{t('payments.text')}</p>
              <p className="mt-1 text-muted">{t('flex.text')}</p>
              <Link href="/flex" className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline">
                {t('flex.cta')}
              </Link>
            </div>
          </li>
        </ul>
      </div>
    </div>
  );
}
