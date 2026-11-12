import type { ReactNode } from 'react';

/**
 * Keeps a technical token ("256 GB", "iPhone 17 Pro", "(PRODUCT)RED", "SM-S931B") in left-to-right order
 * inside right-to-left text, so numbers, units and parentheses never get reordered. `<bdi>` isolates it
 * from the surrounding text direction.
 */
export function Ltr({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <bdi dir="ltr" className={className}>
      {children}
    </bdi>
  );
}

/** Same for plain strings (option labels, aria text): wraps in left-to-right marks. */
export const ltr = (s: string): string => `‎${s}‎`;
