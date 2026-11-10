import { ArrowRight, PackageSearch } from 'lucide-react';
import { Link } from '@/i18n/navigation';
import { EmptyState } from '@/components/ui/EmptyState';
import { Reveal } from '@/components/ui/Reveal';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { Skeleton } from '@/components/ui/Skeleton';
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
  priorityImages = false,
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
  priorityImages?: boolean;
}) {
  return (
    <section className="page-container mt-14" aria-labelledby={`${id}-title`} data-testid={`rail-${id}`}>
      <Reveal>
        <SectionHeading
          id={`${id}-title`}
          as={headingLevel === 2 ? 'h2' : 'h3'}
          eyebrow={eyebrow}
          title={title}
          className="mb-2 sm:mb-2"
          action={
            seeAllHref && products.length > 0 ? (
              <Link
                href={seeAllHref}
                className="group inline-flex min-h-11 items-center gap-1.5 rounded-xl px-2 text-sm font-semibold text-accent transition-colors hover:text-fg"
              >
                {seeAllLabel}
                <ArrowRight size={16} aria-hidden="true" className="flip-rtl transition-transform duration-(--dur-btn) group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
              </Link>
            ) : undefined
          }
        />
        {subtitle ? <p className="mb-5 max-w-2xl text-sm text-muted">{subtitle}</p> : null}
        {products.length === 0 ? (
          <EmptyState compact icon={<PackageSearch size={24} />} title={emptyTitle} description={emptyText} />
        ) : (
          <RailScroller label={title}>
            {products.map((p, i) => (
              <li key={p.id} className="w-[min(46vw,15rem)] shrink-0 snap-start sm:w-56 xl:w-60">
                <ProductCard product={p} favorite={favoriteIds?.has(p.id) ?? false} priority={priorityImages && i < 2} />
              </li>
            ))}
          </RailScroller>
        )}
      </Reveal>
    </section>
  );
}

/** Same footprint as a loaded rail (no layout shift when the stream resolves). */
export function RailSkeleton({ id }: { id: string }) {
  return (
    <section className="page-container mt-14" aria-hidden="true" data-testid={`rail-skeleton-${id}`}>
      <Skeleton className="h-3 w-24 rounded-md" />
      <Skeleton className="mt-3 h-7 w-56 rounded-lg" />
      <Skeleton className="mb-5 mt-3 h-4 w-72 max-w-full rounded-md" />
      <div className="flex gap-3 overflow-hidden sm:gap-4">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="w-[min(46vw,15rem)] shrink-0 sm:w-56 xl:w-60">
            <Skeleton className="aspect-square w-full rounded-card" />
            <Skeleton className="mt-3 h-3 w-1/3 rounded-md" />
            <Skeleton className="mt-2 h-4 w-5/6 rounded-md" />
            <Skeleton className="mt-2 h-5 w-1/2 rounded-md" />
            <Skeleton className="mt-3 h-11 w-full rounded-xl" />
          </div>
        ))}
      </div>
    </section>
  );
}
