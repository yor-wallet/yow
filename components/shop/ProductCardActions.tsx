'use client';

import { useState, useTransition } from 'react';
import { Heart, Loader2, Share2, ShoppingCart } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { usePathname, useRouter } from '@/i18n/navigation';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';
import { addToCartAction, toggleFavoriteAction, type CartActionError } from '@/app/[locale]/(shop)/actions';

export type CatalogErrorKey = 'generic' | 'signInRequired' | 'compareLimit' | 'notFound' | 'unavailable' | 'outOfStock' | 'invalidQty' | 'rateLimited';

/** Maps an action error code to the `catalog.errors.*` message key. */
export function cartErrorKey(code: CartActionError | 'signInRequired' | 'limit_reached' | 'invalid'): CatalogErrorKey {
  switch (code) {
    case 'not_found':
      return 'notFound';
    case 'unavailable':
      return 'unavailable';
    case 'out_of_stock':
      return 'outOfStock';
    case 'invalid_qty':
    case 'invalid':
      return 'invalidQty';
    case 'rate_limited':
      return 'rateLimited';
    case 'signInRequired':
      return 'signInRequired';
    default:
      return 'generic';
  }
}

/** One-tap "add to cart" for products with a single purchasable variant. */
export function QuickAddButton({ variantId, name, className }: { variantId: string; name: string; className?: string }) {
  const t = useTranslations('catalog');
  const { toast } = useToast();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={t('card.quickAddNamed', { name })}
      data-testid="quick-add"
      onClick={() =>
        start(async () => {
          const res = await addToCartAction(variantId, 1);
          if (res.ok) toast({ title: t('card.added'), description: t('card.addedText', { name }), variant: 'success' });
          else toast({ title: t(`errors.${cartErrorKey(res.error)}`), variant: 'error' });
        })
      }
      className={cn(
        'relative z-10 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-primary px-3 text-sm font-semibold text-on-accent shadow-glow-blue',
        'transition-[transform,box-shadow] duration-(--dur-btn) ease-snappy hover:shadow-glow-cyan active:scale-[0.98] disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      {pending ? <Loader2 size={18} className="animate-spin" aria-hidden="true" /> : <ShoppingCart size={18} aria-hidden="true" className="flip-rtl" />}
      <span className="truncate">{t('card.quickAdd')}</span>
    </button>
  );
}

/** Heart toggle. Visitors are sent to the login page and come back to where they were. */
export function FavoriteButton({
  productId,
  initial,
  className,
}: {
  productId: string;
  initial: boolean;
  className?: string;
}) {
  const t = useTranslations('catalog');
  const { toast } = useToast();
  const router = useRouter();
  const pathname = usePathname();
  const [favorited, setFavorited] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      disabled={pending}
      aria-pressed={favorited}
      aria-label={favorited ? t('card.favoriteRemove') : t('card.favoriteAdd')}
      data-testid="favorite-toggle"
      onClick={() =>
        start(async () => {
          const res = await toggleFavoriteAction(productId);
          if (res.ok) {
            setFavorited(res.favorited);
            toast({ title: t(res.favorited ? 'card.favoriteAdded' : 'card.favoriteRemoved'), variant: 'success', durationMs: 2500 });
          } else if (res.error === 'signInRequired') {
            router.push({ pathname: '/login', query: { next: pathname } });
          } else {
            toast({ title: t(`errors.${cartErrorKey(res.error)}`), variant: 'error' });
          }
        })
      }
      className={cn(
        'relative z-10 grid size-11 place-items-center rounded-full border border-border bg-bg/70 text-fg backdrop-blur',
        'transition-[transform,color,background-color] duration-(--dur-btn) ease-snappy hover:bg-surface-2 active:scale-95 disabled:opacity-60',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        favorited && 'text-error',
        className,
      )}
    >
      <Heart key={favorited ? 'on' : 'off'} size={20} aria-hidden="true" fill={favorited ? 'currentColor' : 'none'} className={favorited ? 'animate-pop' : undefined} />
    </button>
  );
}

/** Share the current page (native share sheet, else copy the link). `iconOnly` for compact title rows. */
export function ShareButton({ title, iconOnly = false, className }: { title: string; iconOnly?: boolean; className?: string }) {
  const t = useTranslations('product.share');
  const { toast } = useToast();
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) {
        await navigator.share({ title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast({ title: t('copied'), variant: 'success', durationMs: 2500 });
      }
    } catch (err) {
      if ((err as DOMException)?.name !== 'AbortError') toast({ title: t('failed'), variant: 'error' });
    }
  };
  return (
    <button
      type="button"
      onClick={share}
      aria-label={iconOnly ? t('label') : undefined}
      data-testid="share"
      className={cn(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-full text-sm font-semibold text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        iconOnly ? 'size-11' : 'px-4',
        className,
      )}
    >
      <Share2 size={iconOnly ? 20 : 18} aria-hidden="true" />
      {iconOnly ? null : t('label')}
    </button>
  );
}
