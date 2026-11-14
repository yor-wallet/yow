'use client';

import { useCallback, useEffect, useState, useTransition } from 'react';
import { Minus, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link, useRouter } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/Button';
import { CountBubble } from '@/components/ui/Badge';
import { Drawer, useHistoryModal } from '@/components/ui/Drawer';
import { Price } from '@/components/ui/Price';
import { removeCartItemAction, updateCartItemAction } from '@/app/[locale]/(shop)/actions';
import { cn } from '@/lib/cn';

type Line = {
  itemId: string | null;
  slug: string;
  name: string;
  variantLabel: string | null;
  image: string | null;
  qty: number;
  max: number;
  unitPriceBaisa: number | null;
  lineTotalBaisa: number;
  state: 'ok' | 'qty_reduced' | 'out_of_stock' | 'unavailable';
};
type Data = { lines: Line[]; totals: { subtotalBaisa: number; totalBaisa: number; itemCount: number; checkoutReady: boolean } };

/**
 * Header cart on desktop: opens a drawer to review the cart, change quantities and go to payment
 * (specification §3). Prices and stock are always re-read from the server; the full cart page stays
 * one click away. Works for visitors (cart cookie) and signed-in customers alike.
 */
export function QuickCart({ count, className }: { count: number; className?: string }) {
  const t = useTranslations('cart');
  const tn = useTranslations('nav');
  const locale = useLocale();
  const router = useRouter();
  const drawer = useHistoryModal('quick-cart');
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const res = await fetch(`/api/cart/quick?locale=${locale}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('quick-cart');
      setData((await res.json()) as Data);
    } catch {
      setFailed(true);
    }
  }, [locale]);

  useEffect(() => {
    if (drawer.isOpen) void load();
    else setData(null);
  }, [drawer.isOpen, load]);

  // Navigating from inside the drawer: close it first (history entry), then go — otherwise Back undoes the navigation.
  const go = (href: string) => (e: React.MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    drawer.closeThen(() => router.push(href));
  };

  const change = (fn: () => Promise<unknown>) =>
    start(async () => {
      await fn();
      await load();
      router.refresh();
    });

  return (
    <>
      <button type="button" onClick={drawer.open} aria-haspopup="dialog" aria-label={tn('cartCount', { count })} className={className} data-testid="header-cart">
        <ShoppingCart size={20} aria-hidden="true" />
        <CountBubble count={count} className="top-0.5 end-0.5" />
      </button>
      <Drawer
        {...drawer.props}
        title={t('quick.title')}
        footer={
          data && data.lines.length > 0 ? (
            <div className="flex w-full flex-col gap-3">
              <p className="flex items-center justify-between gap-3 text-base font-bold">
                <span>{t('summary.total')}</span>
                <Price baisa={data.totals.totalBaisa} size="lg" />
              </p>
              <Link href="/checkout" onClick={go('/checkout')} aria-disabled={!data.totals.checkoutReady || undefined} className={buttonClasses({ variant: 'primary', size: 'lg', fullWidth: true })} data-testid="quick-cart-checkout">
                {t('quick.checkout')}
              </Link>
              <Link href="/cart" onClick={go('/cart')} className={buttonClasses({ variant: 'outline', fullWidth: true })} data-testid="quick-cart-open-cart">
                {t('quick.viewCart')}
              </Link>
            </div>
          ) : undefined
        }
      >
        <div aria-busy={pending || undefined} data-testid="quick-cart">
          {failed ? (
            <div role="alert" className="flex flex-col items-start gap-3 py-4 text-sm">
              <p className="font-medium text-error">{t('quick.error')}</p>
              <button type="button" onClick={() => void load()} className={buttonClasses({ variant: 'outline', size: 'sm' })}>
                {t('quick.retry')}
              </button>
            </div>
          ) : !data ? (
            <div role="status" className="flex flex-col gap-3 py-2" aria-label={t('quick.loading')}>
              {[0, 1].map((i) => (
                <div key={i} className="skeleton h-20 w-full rounded-xl" />
              ))}
            </div>
          ) : data.lines.length === 0 ? (
            <p className="py-6 text-sm text-muted" data-testid="quick-cart-empty">
              {t('quick.empty')}
            </p>
          ) : (
            <ul className="flex flex-col divide-y divide-border">
              {data.lines.map((l) => {
                const ok = l.state === 'ok' || l.state === 'qty_reduced';
                return (
                  <li key={l.itemId ?? l.slug} className={cn('flex gap-3 py-3', !ok && 'opacity-70')} data-testid="quick-cart-line">
                    <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-surface-2">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {l.image ? <img src={l.image} width={64} height={64} alt="" loading="lazy" decoding="async" className="size-full object-contain" /> : null}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <Link href={`/product/${l.slug}`} onClick={go(`/product/${l.slug}`)} className="line-clamp-2 text-sm font-semibold underline-offset-4 hover:underline">
                          <bdi>{l.name}</bdi>
                        </Link>
                        <button
                          type="button"
                          onClick={() => l.itemId && change(() => removeCartItemAction(l.itemId!))}
                          disabled={pending}
                          aria-label={t('line.remove', { name: l.name })}
                          className="-me-2 -mt-2 grid size-11 shrink-0 place-items-center rounded-full text-muted hover:bg-surface-2 hover:text-error disabled:opacity-50"
                        >
                          <Trash2 size={16} aria-hidden="true" />
                        </button>
                      </div>
                      {l.variantLabel ? (
                        <p className="text-xs text-muted">
                          <bdi>{l.variantLabel}</bdi>
                        </p>
                      ) : null}
                      {ok ? (
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <div role="group" aria-label={t('line.qty')} className="inline-flex items-center rounded-xl border border-border-strong">
                            <button type="button" onClick={() => l.itemId && change(() => updateCartItemAction(l.itemId!, l.qty - 1))} disabled={pending || l.qty <= 1} aria-label={t('line.decrease', { name: l.name })} className="grid size-11 place-items-center rounded-s-xl hover:bg-surface-2 disabled:opacity-40">
                              <Minus size={14} aria-hidden="true" />
                            </button>
                            <output aria-live="polite" className="grid min-w-8 place-items-center text-sm font-bold tabular-nums">
                              {l.qty}
                            </output>
                            <button type="button" onClick={() => l.itemId && change(() => updateCartItemAction(l.itemId!, l.qty + 1))} disabled={pending || l.qty >= l.max} aria-label={t('line.increase', { name: l.name })} className="grid size-11 place-items-center rounded-e-xl hover:bg-surface-2 disabled:opacity-40">
                              <Plus size={14} aria-hidden="true" />
                            </button>
                          </div>
                          <Price baisa={l.lineTotalBaisa} size="md" />
                        </div>
                      ) : (
                        <p role="status" className="mt-1 text-xs font-semibold text-error">
                          {t(`line.state.${l.state === 'out_of_stock' ? 'out_of_stock' : 'unavailable'}`)}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </Drawer>
    </>
  );
}
