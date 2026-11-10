'use client';

import { Heart, House, LayoutGrid, ShoppingCart, UserRound, type LucideIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link, usePathname } from '@/i18n/navigation';
import { CountBubble } from '@/components/ui/Badge';
import { cn } from '@/lib/cn';

type Item = { key: 'home' | 'categories' | 'favorites' | 'cart' | 'profile'; href: string; icon: LucideIcon; match: RegExp };

const ITEMS: Item[] = [
  { key: 'home', href: '/', icon: House, match: /^\/$/ },
  { key: 'categories', href: '/categories', icon: LayoutGrid, match: /^\/(categories|category)(\/|$)/ },
  { key: 'favorites', href: '/favorites', icon: Heart, match: /^\/favorites(\/|$)/ },
  { key: 'cart', href: '/cart', icon: ShoppingCart, match: /^\/(cart|checkout)(\/|$)/ },
  // Orders, wallet and the rest of the account live under the account page.
  { key: 'profile', href: '/account', icon: UserRound, match: /^\/(account|login|register|wallet|flex|orders)(\/|$)/ },
];

/**
 * Fixed mobile bottom navigation (< lg): Home — Categories — Favourites — Cart — Account.
 * ≥44px targets; the current section is shown in the accent colour; bottom safe-area padding.
 */
export function MobileBottomNav({ cartCount }: { cartCount: number }) {
  const t = useTranslations('nav');
  const pathname = usePathname();
  return (
    <nav
      aria-label={t('bottomNavigation')}
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-surface shadow-[0_-6px_24px_rgb(16_5_46/0.08)] lg:hidden"
      style={{ paddingBottom: 'var(--safe-bottom)' }}
      data-testid="bottom-nav"
    >
      <span aria-hidden="true" className="doom-hairline top-0" />
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
                  active ? 'text-accent' : 'text-muted hover:text-fg',
                )}
              >
                <span className="relative grid h-7 w-12 place-items-center">
                  <Icon size={22} aria-hidden="true" strokeWidth={active ? 2.4 : 1.9} />
                  {key === 'cart' ? <CountBubble count={cartCount} className="-top-1 end-1" /> : null}
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
