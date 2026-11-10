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
 * Mobile & tablet header (< lg): a sticky violet band with the logo centred (always dark, so the logo's
 * transparent variant is correct in both themes). Start side: language on the home page, the back arrow on
 * every other page. End side: theme / notifications. Below it the light page sheet rises with rounded
 * corners, then the delivery-area selector and search on browsing pages.
 */
export function MobileHeader({ counts, areaOptions, area }: { counts: HeaderCounts; areaOptions: AreaChoice[]; area: AreaChoice | null }) {
  const t = useTranslations('nav');
  const onDark = 'text-white hover:bg-white/10';
  return (
    <>
      <header className="bg-band sticky top-0 z-40 text-white lg:hidden" style={{ paddingTop: 'var(--safe-top)' }} data-testid="mobile-header">
        <div className="grid h-14 grid-cols-[1fr_auto_1fr] items-center ps-[max(8px,var(--safe-left))] pe-[max(8px,var(--safe-right))]">
          <div className="flex items-center justify-self-start">
            <MobileHeaderStart />
          </div>
          <Link href="/" aria-label={t('home')} className="rounded-lg">
            <Logo height={38} surface="dark" priority />
          </Link>
          <div className="flex items-center justify-self-end">
            <ThemeToggle tone="onDark" />
            {counts.signedIn ? (
              <Link href="/account/notifications" aria-label={t('unread', { count: counts.notifications })} className={`relative grid size-11 place-items-center rounded-xl ${onDark}`}>
                <Bell size={20} aria-hidden="true" />
                <CountBubble count={counts.notifications} className="top-1 end-1" />
              </Link>
            ) : null}
          </div>
        </div>
      </header>
      {/* The light page sheet rises over the bottom of the band (rounded top corners). */}
      <div aria-hidden="true" className="bg-band lg:hidden">
        <div className="h-5 rounded-t-[28px] bg-bg" />
      </div>
      <div className="lg:hidden">
        <MobileSearchRow areaOptions={areaOptions} area={area} />
      </div>
    </>
  );
}
