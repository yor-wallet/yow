import { Bell, Wallet } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import type { HeaderCounts } from '@/lib/nav';
import { Logo } from '@/components/ui/Logo';
import { CountBubble } from '@/components/ui/Badge';
import { ThemeToggle } from './ThemeToggle';
import { LocaleSwitcher } from './LocaleSwitcher';
import { MobileSearchRow } from './MobileSearchRow';

/** Mobile & tablet header (< lg): logo, quick actions, contextual search row. Not sticky (secondary pages use the sticky PageHeader). */
export function MobileHeader({ counts }: { counts: HeaderCounts }) {
  const t = useTranslations('nav');
  return (
    <>
      <header className="lg:hidden" style={{ paddingTop: 'var(--safe-top)' }} data-testid="mobile-header">
        <div className="page-container flex h-14 items-center gap-1">
          <Link href="/" aria-label={t('home')} className="me-auto shrink-0 rounded-lg">
            <Logo height={38} priority />
          </Link>
          {counts.signedIn ? (
            <Link
              href="/account/notifications"
              aria-label={t('unread', { count: counts.notifications })}
              className="relative grid size-11 place-items-center rounded-xl text-fg hover:bg-surface-2"
            >
              <Bell size={20} aria-hidden="true" />
              <CountBubble count={counts.notifications} className="top-1 end-1" />
            </Link>
          ) : null}
          <Link href="/wallet" className="hidden size-11 place-items-center rounded-xl text-fg hover:bg-surface-2 xs:grid" aria-label={t('wallet')}>
            <Wallet size={20} aria-hidden="true" />
          </Link>
          <ThemeToggle />
          <LocaleSwitcher variant="sheet" />
        </div>
        <MobileSearchRow />
      </header>
    </>
  );
}
