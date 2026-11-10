'use client';

import { usePathname } from '@/i18n/navigation';
import { DeliverTo, type AreaChoice } from './DeliverTo';
import { SearchBox } from './SearchBox';

/** Browsing pages where the mobile header shows the delivery-area selector and the search field. */
const SEARCH_PAGES = [/^\/$/, /^\/search/, /^\/categories/, /^\/category\//, /^\/promotions/];

export function MobileSearchRow({ areaOptions, area }: { areaOptions: AreaChoice[]; area: AreaChoice | null }) {
  const pathname = usePathname();
  if (!SEARCH_PAGES.some((r) => r.test(pathname))) return null;
  return (
    <div className="page-container flex flex-col gap-1 pb-3" data-testid="mobile-search-row">
      <DeliverTo options={areaOptions} current={area} />
      <SearchBox variant="pill" />
    </div>
  );
}
