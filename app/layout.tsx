import type { ReactNode } from 'react';

/**
 * Pass-through root layout. The real document (<html lang dir data-theme>) is
 * rendered by app/[locale]/layout.tsx. Required because app/not-found.tsx exists.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
