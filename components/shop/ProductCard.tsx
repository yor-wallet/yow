import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/Badge';
import { CategoryIcon } from '@/components/ui/CategoryIcon';
import { Price } from '@/components/ui/Price';
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
  const flexMonthly = flexMonthlyFrom(product.priceBaisa);
  const promoLabel = product.promo
    ? product.promo.type === 'PERCENT'
      ? t('promoPercent', { value: Number((product.promo.value / 100).toFixed(2)) })
      : t('promoFixed', { amount: formatBaisa(product.promo.value, locale) })
    : null;

  return (
    <article
      data-testid="product-card"
      className={cn(
        'group relative flex h-full min-w-0 flex-col overflow-hidden rounded-card border border-border bg-surface shadow-card',
        'transition-[transform,box-shadow,border-color] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue',
        className,
      )}
    >
      <div className="relative aspect-square w-full overflow-hidden bg-surface-2">
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
          <div className="grid size-full place-items-center bg-gradient-premium text-cyan" aria-hidden="true">
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

      <div className="flex min-w-0 flex-1 flex-col gap-1.5 p-3 sm:p-4">
        {product.brand ? <p className="truncate text-xs font-medium uppercase tracking-wide text-muted">{product.brand}</p> : null}
        <h3 className="line-clamp-2 min-h-[2.6em] text-sm font-semibold leading-snug sm:text-[15px]">
          <Link
            href={productPath(product.slug)}
            className="outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:outline-2 focus-visible:after:outline-offset-[-2px] focus-visible:after:outline-ring"
          >
            {product.name}
          </Link>
        </h3>

        <div className="mt-auto flex flex-col gap-1 pt-1">
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            {product.priceBaisa !== null && product.priceFrom ? <span className="text-xs text-muted">{t('from')}</span> : null}
            <Price baisa={product.priceBaisa} compareAtBaisa={product.compareAtBaisa} size="md" />
          </div>
          {flexMonthly !== null ? (
            <p className="text-xs text-muted">{t('flexFrom', { amount: formatBaisa(flexMonthly, locale) })}</p>
          ) : null}
          {product.availability === 'low_stock' ? <p className="text-xs font-semibold text-amber">{t('lowStock')}</p> : null}
          {product.availability === 'out_of_stock' ? <p className="text-xs font-semibold text-muted">{t('outOfStock')}</p> : null}
          {product.availability === 'unavailable' ? <p className="text-xs font-semibold text-muted">{t('unavailable')}</p> : null}
        </div>

        <div className="mt-2">
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
