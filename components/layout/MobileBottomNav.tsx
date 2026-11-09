'use client';

import { House, LayoutGrid, Package, ShoppingCart, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { CountBubble } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

type Item = { key: 'home' | 'categories' | 'cart' | 'orders' | 'profile'; href: string; icon: LucideIcon; match: RegExp };

const ITEMS: Item[] = [
  { key: 'home', href: '/', icon: House, match: /^\/$/ },
  { key: 'categories', href: '/categories', icon: LayoutGrid, match: /^\/(categories|category)(\/|$)/ },
  { key: 'cart', href: '/cart', icon: ShoppingCart, match: /^\/(cart|checkout)(\/|$)/ },
  { key: 'orders', href: '/orders', icon: Package, match: /^\/orders(\/|$)/ },
  { key: 'profile', href: '/account', icon: UserRound, match: /^\/(account|login|register|wallet|flex)(\/|$)/ },
];

/**
 * Fixed mobile bottom navigation (< lg): Home — Categories — Cart — Orders — Profile.
 * ≥44px targets, active state, bottom safe-area padding.
 */
export function MobileBottomNav({ cartCount }: { cartCount: number }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('bottomNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border lg:hidden"
      style={{
        paddingBottom: 'var(--safe-bottom)',
        background: 'var(--doom-header)',
        backdropFilter: 'blur(18px) saturate(140%)',
        WebkitBackdropFilter: 'blur(18px) saturate(140%)',
      }}
      data-testid="bottom-nav"
    >
      <ul className="mx-auto grid h-(--bottom-nav-h) max-w-xl grid-cols-5 px-1">
        {ITEMS.map(({ key, href, icon: Icon, match }) => {
          const active = match.test(pathname);
          const label = key === 'profile' ? t('profile') : t(key);
          return (
            <li key={key} className="min-w-0">
              <Link
                href={href}
                aria-current={active ? 'page' : undefined}
                aria-label={key === 'cart' ? t('cartCount', { count: cartCount }) : undefined}
                className={cn(
                  'group flex h-full min-h-11 flex-col items-center justify-center gap-0.5 rounded-xl text-[11px] font-semibold transition-colors duration-(--dur-nav)',
                  active ? 'text-fg' : 'text-muted hover:text-fg',
                )}
              >
                <span
                  className={cn(
                    'relative grid h-8 w-12 place-items-center rounded-pill transition-[background-color,box-shadow] duration-(--dur-nav)',
                    active && 'bg-gradient-primary text-on-accent shadow-glow-blue',
                  )}
                >
                  <Icon size={20} aria-hidden="true" strokeWidth={active ? 2.4 : 2} />
                  {key === 'cart' ? <CountBubble count={cartCount} className="-top-1.5 end-0.5" /> : null}
                </span>
                <span className="max-w-full truncate px-0.5" aria-hidden={key === 'cart' ? true : undefined}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
