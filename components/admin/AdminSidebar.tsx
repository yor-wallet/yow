'use client';

import {
  BookOpen,
  Bell,
  Bike,
  Bot,
  CalendarClock,
  CreditCard,
  ExternalLink,
  Folders,
  Gift,
  Inbox,
  Languages,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  Map as MapIcon,
  Megaphone,
  Menu,
  Package,
  Palette,
  Percent,
  Receipt,
  Scale,
  ScrollText,
  Settings,
  ShieldCheck,
  Siren,
  Tags,
  Truck,
  Undo2,
  Users,
  Wallet,
  type LucideIcon, Star } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { MouseEvent } from 'react';
import { Link, usePathname, useRouter } from '@/i18n/navigation';
import { logoutAction } from '@/app/[locale]/(auth)/actions';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { cn } from '@/lib/cn';

const ICONS: Record<string, LucideIcon> = {
  dashboard: LayoutDashboard,
  package: Package,
  folders: Folders,
  tags: Tags,
  percent: Percent,
  megaphone: Megaphone,
  receipt: Receipt,
  star: Star,
  wallet: Wallet,
  book: BookOpen,
  card: CreditCard,
  gift: Gift,
  undo: Undo2,
  calendar: CalendarClock,
  scale: Scale,
  users: Users,
  shield: ShieldCheck,
  lifebuoy: LifeBuoy,
  truck: Truck,
  bike: Bike,
  map: MapIcon,
  siren: Siren,
  settings: Settings,
  bell: Bell,
  languages: Languages,
  palette: Palette,
  bot: Bot,
  inbox: Inbox,
  scroll: ScrollText,
};

export type SidebarGroup = { key: string; label: string; items: { key: string; label: string; href: string; icon: string }[] };

const FOOTER_LINK =
  'flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-start text-sm font-medium text-fg transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

/** In the sheet, a link first closes the sheet (history pop) and only then navigates — otherwise the pop would undo the push. */
type Navigate = (href: string) => void;

function NavList({ groups, email, onNavigate }: { groups: SidebarGroup[]; email: string; onNavigate?: Navigate }) {
  const t = useTranslations('admin.shell');
  const pathname = usePathname();
  const isActive = (href: string) => (href === '/admin' ? pathname === '/admin' : pathname === href || pathname.startsWith(`${href}/`));
  // Longest matching href wins (e.g. /admin/logistics vs /admin/logistics/zones).
  const best = groups
    .flatMap((g) => g.items)
    .filter((i) => isActive(i.href))
    .sort((a, b) => b.href.length - a.href.length)[0]?.href;

  const intercept = (href: string) => (e: MouseEvent<HTMLAnchorElement>) => {
    if (!onNavigate || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    onNavigate(href);
  };

  return (
    <nav aria-label={t('navLabel')} className="flex flex-col gap-5">
      {groups.map((g) => (
        <div key={g.key}>
          <p className="px-3 pb-1 text-xs font-semibold uppercase tracking-wide text-muted">{g.label}</p>
          <ul className="flex flex-col gap-0.5">
            {g.items.map((i) => {
              const Icon = ICONS[i.icon] ?? Package;
              const active = i.href === best;
              return (
                <li key={i.key}>
                  <Link
                    href={i.href}
                    onClick={intercept(i.href)}
                    aria-current={active ? 'page' : undefined}
                    data-testid={`admin-nav-${i.key}`}
                    className={cn(
                      'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
                      active ? 'bg-gradient-primary text-on-accent shadow-glow-blue' : 'text-fg hover:bg-surface-2',
                    )}
                  >
                    <Icon size={18} aria-hidden="true" />
                    <span className="truncate">{i.label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
      <div className="flex flex-col gap-0.5 border-t border-border pt-3">
        <Link href="/" onClick={intercept('/')} className={FOOTER_LINK} data-testid="admin-view-site">
          <ExternalLink size={18} aria-hidden="true" />
          <span className="truncate">{t('viewSite')}</span>
        </Link>
        <form action={logoutAction}>
          <button type="submit" className={FOOTER_LINK} title={email} data-testid="admin-signout">
            <LogOut size={18} aria-hidden="true" />
            <span className="truncate">{t('signOut')}</span>
          </button>
        </form>
      </div>
    </nav>
  );
}

/** Fixed sidebar (large screens). Phones and tablets use `AdminMenuButton` in the header instead. */
export function AdminSidebar({ groups, email }: { groups: SidebarGroup[]; email: string }) {
  return (
    <aside className="hidden border-e border-border bg-bg-2 p-4 lg:block" data-testid="admin-sidebar">
      <div className="sticky top-4 max-h-[calc(100dvh-2rem)] overflow-y-auto pe-1">
        <NavList groups={groups} email={email} />
      </div>
    </aside>
  );
}

/** Menu button for screens below `lg`: opens the same navigation in a history-backed bottom sheet (Back closes it). */
export function AdminMenuButton({ groups, email }: { groups: SidebarGroup[]; email: string }) {
  const t = useTranslations('admin.shell');
  const router = useRouter();
  const sheet = useHistoryModal('admin-nav');
  return (
    <>
      <button
        type="button"
        onClick={sheet.open}
        aria-label={t('menu')}
        data-testid="admin-menu"
        className="-ms-2 grid size-11 shrink-0 place-items-center rounded-xl hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-ring lg:hidden"
      >
        <Menu size={22} aria-hidden="true" />
      </button>
      <BottomSheet {...sheet.props} title={t('title')}>
        <NavList groups={groups} email={email} onNavigate={(href) => sheet.closeThen(() => router.push(href))} />
      </BottomSheet>
    </>
  );
}
