import { Bell, BadgePercent, ShoppingCart, UserRound, Wallet, LayoutDashboard } from 'lucide-react';
import { getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getHeaderCounts, getNavCategories } from '@/lib/nav';
import { Logo } from '@/components/ui/Logo';
import { CountBubble } from '@/components/ui/Badge';
import { SearchBox } from './SearchBox';
import { MegaMenu } from './MegaMenu';
import { ThemeToggle } from './ThemeToggle';
import { LocaleSwitcher } from './LocaleSwitcher';
import { MobileHeader } from './MobileHeader';

const iconLink =
  'relative inline-flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-semibold text-fg transition-colors duration-(--dur-btn) hover:bg-surface-2';

/**
 * Global header. Desktop (lg+): sticky two-row header with logo, search, actions and
 * the categories mega-menu. Mobile/tablet: compact header (bottom nav handles primary nav).
 */
export async function Header() {
  const [t, categories, counts] = await Promise.all([getTranslations('nav'), getNavCategories(), getHeaderCounts()]);
  const accountHref = counts.signedIn ? '/account' : '/login';

  return (
    <>
      {/* Desktop */}
      <header
        className="sticky top-0 z-40 hidden lg:block"
        style={{ background: 'var(--doom-header)', backdropFilter: 'blur(18px) saturate(140%)', WebkitBackdropFilter: 'blur(18px) saturate(140%)' }}
        data-testid="desktop-header"
      >
        <div className="page-container flex h-18 items-center gap-6">
          <Link href="/" aria-label={t('home')} className="shrink-0 rounded-lg transition-[filter] duration-(--dur-nav) hover:drop-shadow-[0_0_14px_rgb(0_217_255/0.45)]">
            <Logo height={38} priority />
          </Link>
          <SearchBox className="max-w-2xl flex-1" />
          <nav aria-label={t('mainNavigation')} className="ms-auto flex items-center gap-0.5">
            <Link href="/promotions" className={iconLink}>
              <BadgePercent size={20} aria-hidden="true" className="text-orange" />
              <span className="hidden xl:inline">{t('promotions')}</span>
              <span className="sr-only xl:hidden">{t('promotions')}</span>
            </Link>
            <Link href="/wallet" className={iconLink}>
              <Wallet size={20} aria-hidden="true" />
              <span className="hidden xl:inline">{t('wallet')}</span>
              <span className="sr-only xl:hidden">{t('wallet')}</span>
            </Link>
            {counts.signedIn ? (
              <Link href="/account/notifications" className={iconLink} aria-label={t('unread', { count: counts.notifications })}>
                <Bell size={20} aria-hidden="true" />
                <CountBubble count={counts.notifications} className="top-0.5 end-0.5" />
              </Link>
            ) : null}
            {counts.isStaff ? (
              <Link href="/admin" className={iconLink}>
                <LayoutDashboard size={20} aria-hidden="true" />
                <span className="sr-only">{t('admin')}</span>
              </Link>
            ) : null}
            <Link href={accountHref} className={iconLink}>
              <UserRound size={20} aria-hidden="true" />
              <span className="hidden xl:inline">{counts.signedIn ? t('account') : t('login')}</span>
              <span className="sr-only xl:hidden">{counts.signedIn ? t('account') : t('login')}</span>
            </Link>
            <Link href="/cart" className={iconLink} aria-label={t('cartCount', { count: counts.cart })} data-testid="header-cart">
              <ShoppingCart size={20} aria-hidden="true" />
              <CountBubble count={counts.cart} className="top-0.5 end-0.5" />
            </Link>
            <span aria-hidden="true" className="mx-1 h-6 w-px bg-border" />
            <ThemeToggle />
            <LocaleSwitcher />
          </nav>
        </div>
        <div className="border-t border-border">
          <div className="page-container">
            <MegaMenu categories={categories} />
          </div>
        </div>
        <span aria-hidden="true" className="doom-hairline bottom-0" />
      </header>

      <MobileHeader counts={counts} />
    </>
  );
}
