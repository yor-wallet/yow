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

/**
 * Mixed Arabic + technical text ("حتى 4.47 GHz", "256 GB · 512 GB"): isolates every number-with-unit as a
 * left-to-right run (U+2066 … U+2069) so the unit stays on the right of its number inside RTL text.
 */
export function isolateUnits(s: string): string {
  return s.replace(/(\d[\d.,]*(?:\s?[×x]\s?\d[\d.,]*)*\s?(?:GHz|GB|TB|MP|mm|mAh|Hz|px|ppi|W|h|g|m|MB)\b)/g, '\u2066$1\u2069');
}
