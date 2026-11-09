import { PackageSearch } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { Reveal } from '@/components/ui/Reveal';
import type { ProductCardData } from '@/lib/catalog/types';
import { ProductCard } from './ProductCard';
import { RailScroller } from './RailControls';

/**
 * Titled section with a horizontal rail of products. With no products it renders an
 * elegant empty state — never a placeholder product (SPEC: no invented data).
 */
export function ProductRail({
  id,
  eyebrow,
  title,
  subtitle,
  seeAllHref,
  seeAllLabel,
  emptyTitle,
  emptyText,
  products,
  favoriteIds,
  headingLevel = 2,
}: {
  id: string;
  eyebrow?: string;
  title: string;
  subtitle?: string;
  seeAllHref?: string;
  seeAllLabel: string;
  emptyTitle: string;
  emptyText: string;
  products: readonly ProductCardData[];
  favoriteIds?: ReadonlySet<string>;
  headingLevel?: 2 | 3;
}) {
  const Heading = headingLevel === 2 ? 'h2' : 'h3';
  return (
    <section className="page-container mt-12" aria-labelledby={`${id}-title`} data-testid={`rail-${id}`}>
      <Reveal>
        <div className="mb-4 flex items-end justify-between gap-4">
          <div className="min-w-0">
            {eyebrow ? <p className="text-xs font-semibold uppercase tracking-wide text-accent">{eyebrow}</p> : null}
            <Heading id={`${id}-title`} className="text-xl font-bold sm:text-2xl">
              {title}
            </Heading>
            {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
          </div>
          {seeAllHref && products.length > 0 ? (
            <Link
              href={seeAllHref}
              className="inline-flex min-h-11 shrink-0 items-center text-sm font-semibold text-accent underline-offset-4 hover:underline"
            >
              {seeAllLabel}
            </Link>
          ) : null}
        </div>
        {products.length === 0 ? (
          <EmptyState compact icon={<PackageSearch size={24} />} title={emptyTitle} description={emptyText} />
        ) : (
          <RailScroller label={title}>
            {products.map((p, i) => (
              <li key={p.id} className="w-[min(46vw,15rem)] shrink-0 snap-start sm:w-56 xl:w-60">
                <ProductCard product={p} favorite={favoriteIds?.has(p.id) ?? false} priority={i < 2 && id === 'deals'} />
              </li>
            ))}
          </RailScroller>
        )}
      </Reveal>
    </section>
  );
}
