import type { ReactNode } from 'react';

/**
 * Page transition: every navigation fades the new page in (a template remounts per route).
 * Opacity only and no fill mode, on purpose: a transform or a lingering animation on this wrapper
 * would become the containing block of `position: fixed` children (pinned buy bar, dialogs).
 * Reduced motion: globals.css collapses the duration.
 */
export default function LocaleTemplate({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
