'use client';

import { usePathname } from '@/i18n/navigation';
import { SearchBox } from './SearchBox';

/** Browsing pages where the mobile header shows the search field. */
const SEARCH_PAGES = [/^\/$/, /^\/search/, /^\/categories/, /^\/category\//, /^\/promotions/];

export function MobileSearchRow() {
  const pathname = usePathname();
  if (!SEARCH_PAGES.some((r) => r.test(pathname))) return null;
  return (
    <div className="page-container pb-3">
      <SearchBox />
    </div>
  );
}
