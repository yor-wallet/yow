import { Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { HeaderCounts } from '@/lib/nav';
import { Logo } from '@/components/ui/Logo';
import { CountBubble } from '@/components/ui/Badge';
import { ThemeToggle } from './ThemeToggle';
import { MobileHeaderStart } from './MobileHeaderStart';
import { MobileSearchRow } from './MobileSearchRow';
import type { AreaChoice } from './DeliverTo';

/**
 * Mobile & tablet header (< lg): a sticky light bar (specification: light header, clear logo, search
 * visible) with the logo centred. Start side: language on the home page, the back arrow on every other
 * page. End side: theme / notifications. Below it: the delivery-area selector and search on browsing pages.
 */
export function MobileHeader({ counts, areaOptions, area }: { counts: HeaderCounts; areaOptions: AreaChoice[]; area: AreaChoice | null }) {
  const t = useTranslations('nav');
  const iconLink = 'relative grid size-11 place-items-center rounded-xl text-fg hover:bg-surface-2';
  return (
    <>
      <header
        className="band-scroll-shadow sticky top-0 z-40 border-b border-border text-fg lg:hidden"
        style={{ paddingTop: 'var(--safe-top)', background: 'var(--doom-header)', backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }}
        data-testid="mobile-header"
      >
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center ps-[max(8px,var(--safe-left))] pe-[max(8px,var(--safe-right))]">
          <div className="flex items-center justify-self-start">
            <MobileHeaderStart />
          </div>
          <Link href="/" aria-label={t('home')} className="inline-flex min-h-11 items-center rounded-lg">
            <Logo height={34} priority />
          </Link>
          <div className="flex items-center justify-self-end">
            <ThemeToggle />
            {counts.signedIn ? (
              <Link href="/account/notifications" aria-label={t('unread', { count: counts.notifications })} className={iconLink}>
                <Bell size={20} aria-hidden="true" />
                <CountBubble count={counts.notifications} className="top-1 end-1" />
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      <div className="lg:hidden">
        <MobileSearchRow areaOptions={areaOptions} area={area} />
      </div>
    </>
  );
}
