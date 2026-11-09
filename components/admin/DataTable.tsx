import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';

/**
 * A real <table> on md+ screens that turns into a list of cards on phones (each cell prints its label from
 * `data-label`). One DOM for both layouts, so tests and assistive tech see every value once.
 */
export function DataTable({ caption, head, children, testId }: { caption: string; head: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <div className="overflow-hidden rounded-card border border-border bg-surface shadow-card">
      <table className="block w-full text-sm md:table" data-testid={testId}>
        <caption className="sr-only">{caption}</caption>
        <thead className="hidden md:table-header-group">
          <tr className="bg-surface-2 text-xs font-semibold uppercase tracking-wide text-muted">{head}</tr>
        </thead>
        <tbody className="block md:table-row-group">{children}</tbody>
      </table>
    </div>
  );
}

export function Th({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <th scope="col" className={cn('px-4 py-3 text-start font-semibold', className)}>
      {children}
    </th>
  );
}

export function Tr({ children, className, testId }: { children: ReactNode; className?: string; testId?: string }) {
  return (
    <tr data-testid={testId} className={cn('block border-b border-border py-2 last:border-b-0 hover:bg-surface-2/50 md:table-row md:py-0', className)}>
      {children}
    </tr>
  );
}

/** `primary` cells (the thing the row is about) span the card on phones and carry no label. */
export function Td({ label, children, className, primary }: { label?: string; children: ReactNode; className?: string; primary?: boolean }) {
  return (
    <td
      data-label={label}
      className={cn(
        primary
          ? 'block px-4 py-1.5 md:table-cell md:py-3'
          : 'flex items-center justify-between gap-3 px-4 py-1.5 before:text-xs before:font-semibold before:text-muted before:content-[attr(data-label)] md:table-cell md:py-3 md:before:content-none',
        'align-middle',
        className,
      )}
    >
      {children}
    </td>
  );
}
