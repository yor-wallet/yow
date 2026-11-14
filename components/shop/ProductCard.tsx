import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Price } from '@/components/ui/Price';
import { Ltr } from '@/components/ui/Ltr';
import { flexMonthlyFrom } from '@/lib/catalog/flex-preview';
import { productPath } from '@/lib/catalog/paths';
import type { ProductCardData } from '@/lib/catalog/types';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import { FavoriteButton, QuickAddButton } from './ProductCardActions';
import { ShopImage } from './ShopImage';

/**
 * Product card used by rails, grids, search results and favourites. Works in server and
 * client trees (no server-only imports). The whole card is one link (stretched name link);
 * the heart and the quick-add button sit above it.
 */
export function ProductCard({
  product,
  favorite = false,
  showFavorite = true,
  priority = false,
  className,
}: {
  product: ProductCardData;
  favorite?: boolean;
  showFavorite?: boolean;
  /** First images of a page (above the fold) load eagerly. */
  priority?: boolean;
  className?: string;
}) {
  const t = useTranslations('catalog.card');
  const locale = useLocale();
  const purchasable = product.availability === 'in_stock' || product.availability === 'low_stock';
  const stockLabel = {
    in_stock: t('inStock'),
    low_stock: t('lowStock'),
    out_of_stock: t('outOfStock'),
    unavailable: t('unavailable'),
  }[product.availability];
  const flexMonthly = flexMonthlyFrom(product.priceBaisa);
  const promoLabel = product.promo
    ? product.promo.type === 'PERCENT'
      ? t('promoPercent', { value: Number((product.promo.value / 100).toFixed(2)) })
      : t('promoFixed', { amount: formatBaisa(product.promo.value, locale) })
    : null;

  return (
    <article
      data-testid="product-card"
      data-spotlight=""
      data-tilt=""
      className={cn(
        'spotlight holo-border-hover group relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface/90 shadow-card',
        'tilt-3d transition-[transform,box-shadow,border-color] duration-(--dur-card) ease-premium hover:shadow-glow-blue',
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-surface lg:border-b lg:border-border lg:bg-[radial-gradient(70%_62%_at_50%_42%,rgb(8_123_255/0.2),transparent_72%)]">
        {product.image ? (
          <ShopImage
            src={product.image.src}
            width={product.image.width}
            height={product.image.height}
            alt={product.image.alt}
            sizes="(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 46vw"
            priority={priority}
            className="size-full object-contain p-3 transition-transform duration-(--dur-card) ease-premium group-hover:scale-[1.03]"
          />
        ) : (
          <div className="grid size-full place-items-center bg-blue/8 text-accent" aria-hidden="true">
            <CategoryIcon name={product.categoryIcon} size={44} />
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-2 top-2 flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-col items-start gap-1">
            {promoLabel ? <Badge variant="secondary">{promoLabel}</Badge> : null}
            {product.isNew ? <Badge variant="primary">{t('new')}</Badge> : null}
          </div>
          {showFavorite ? (
            <div className="pointer-events-auto">
              <FavoriteButton productId={product.id} initial={favorite} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 max-lg:items-center max-lg:pt-1 max-lg:text-center sm:p-4">
        {product.brand ? <p className="hidden truncate font-display text-[11px] font-semibold uppercase tracking-[0.16em] text-accent lg:block rtl:tracking-normal">{product.brand}</p> : null}
        <h3 className="line-clamp-2 text-sm font-bold leading-snug sm:text-[15px] lg:min-h-[2.6em] lg:font-semibold">
          <Link
            href={productPath(product.slug)}
            className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring"
          >
            <Ltr>{product.name}</Ltr>
          </Link>
        </h3>

        <div className="mt-auto flex flex-col gap-1 pt-1 max-lg:items-center">
          <div className="flex flex-wrap items-baseline gap-x-1.5 max-lg:justify-center">
            {product.priceBaisa !== null && product.priceFrom ? <span className="text-xs text-muted">{t('from')}</span> : null}
            <Price baisa={product.priceBaisa} compareAtBaisa={product.compareAtBaisa} size="md" className="font-display" />
          </div>
          {flexMonthly !== null ? (
            <p className="hidden text-xs text-muted lg:block">{t('flexFrom', { amount: formatBaisa(flexMonthly, locale) })}</p>
          ) : null}
          <StockChip availability={product.availability} label={stockLabel} />
        </div>

        <div className="mt-2 hidden lg:block">
          {purchasable && product.quickAddVariantId ? (
            <QuickAddButton variantId={product.quickAddVariantId} name={product.name} />
          ) : purchasable ? (
            <Link
              href={productPath(product.slug)}
              aria-label={t('chooseOptionsNamed', { name: product.name })}
              className="relative z-10 inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-border-strong px-3 text-sm font-semibold transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {t('chooseOptions')}
            </Link>
          ) : null}
        </div>
      </div>
    </article>
  );
}

const STOCK_DOT = {
  in_stock: 'bg-success shadow-[0_0_8px_var(--color-success)]',
  low_stock: 'bg-amber shadow-[0_0_8px_var(--color-amber)]',
  out_of_stock: 'bg-error',
  unavailable: 'bg-muted',
} as const;

/** HUD-style availability chip with a glowing status node. */
export function StockChip({ availability, label }: { availability: ProductCardData['availability']; label: string }) {
  return (
    <p
      className={cn(
        'inline-flex items-center gap-1.5 text-xs font-semibold',
        availability === 'low_stock' ? 'text-fg' : availability === 'in_stock' ? 'text-muted' : 'text-muted',
      )}
      data-availability={availability}
    >
      <span aria-hidden="true" className={cn('size-1.5 shrink-0 rounded-full', STOCK_DOT[availability])} />
      {label}
    </p>
  );
}
