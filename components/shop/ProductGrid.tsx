import type { ProductCardData } from '@/lib/catalog/types';
import { cn } from '@/lib/cn';
import { ProductCard } from './ProductCard';

/** Responsive product grid (2 columns on phones, up to 5 on wide screens). */
export function ProductGrid({
  products,
  favoriteIds,
  priorityCount = 4,
  className,
}: {
  products: readonly ProductCardData[];
  favoriteIds?: ReadonlySet<string>;
  /** How many leading cards load their image eagerly. */
  priorityCount?: number;
  className?: string;
}) {
  return (
    <ul
      className={cn('grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5', className)}
      data-testid="product-grid"
    >
      {products.map((p, i) => (
        <li key={p.id} className="min-w-0">
          <ProductCard product={p} favorite={favoriteIds?.has(p.id) ?? false} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
