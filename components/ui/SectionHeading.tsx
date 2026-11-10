import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

type Props = {
  title: ReactNode;
  /** Small HUD label above the title (e.g. "New", "Live deals"). */
  eyebrow?: ReactNode;
  /** Optional trailing action (e.g. "See all" link). */
  action?: ReactNode;
  id?: string;
  as?: 'h1' | 'h2' | 'h3';
  /** Phones show the title only (no eyebrow): the compact storefront layout. */
  compact?: boolean;
  className?: string;
};

/**
 * Futuristic section heading: HUD eyebrow, display-face title, circuit rule that runs to the
 * action (mirrors in RTL). Use for every storefront/admin section for visual consistency.
 */
export function SectionHeading({ title, eyebrow, action, id, as: Tag = 'h2', compact = false, className }: Props) {
  return (
    <div className={cn('mb-5 flex flex-col gap-2 sm:mb-6', className)}>
      {eyebrow ? <span className={cn('hud-label', compact && 'max-lg:hidden')}>{eyebrow}</span> : null}
      <div className="flex min-w-0 items-center gap-4">
        <Tag id={id} className="min-w-0 text-[clamp(1.25rem,1rem+1.2vw,1.875rem)] font-bold leading-tight text-fg">
          {title}
        </Tag>
        <span aria-hidden="true" className="circuit-rule hidden flex-1 sm:block" />
        {action ? <div className="ms-auto shrink-0 sm:ms-0">{action}</div> : null}
      </div>
    </div>
  );
}
