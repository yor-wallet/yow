import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { Link } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { builtNavForRole } from '@/lib/admin/nav';
import { can, isStaff } from '@/lib/rbac';
import { LocaleSwitcher } from '@/components/layout/LocaleSwitcher';
import { ThemeToggle } from '@/components/layout/ThemeToggle';
import { Logo } from '@/components/ui/Logo';
import { AdminMenuButton, AdminSidebar, type SidebarGroup } from '@/components/admin/AdminSidebar';

export const metadata: Metadata = { robots: { index: false, follow: false } };

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

/**
 * Admin shell (rendered without the storefront chrome, see SiteChrome BARE_ROUTES).
 *
 * The shell is only drawn for a staff session. It deliberately does NOT redirect by itself: a layout cannot
 * know which page was asked for, so every page guards itself with `requireAdmin(permission, '/its/path')`
 * (visitors go to sign in and come back to that page, customers get a 404). A unit test checks that every
 * admin page does so (tests/unit/admin-guard.test.ts).
 */
export default async function AdminLayout({ children, params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const session = await getSession();
  if (!session || !isStaff(session.user.role) || !can(session.user.role, 'admin:access')) return <>{children}</>;
  const t = await getTranslations('admin');

  const groups: SidebarGroup[] = builtNavForRole(session.user.role).map((g) => ({
    key: g.key,
    label: t(`nav.groups.${g.key as 'main'}`),
    items: g.items.map((i) => ({ key: i.key, label: t(`nav.${i.key as 'overview'}`), href: i.href, icon: i.icon })),
  }));

  return (
    <div className="min-h-dvh bg-bg lg:grid lg:grid-cols-[17rem_minmax(0,1fr)]" data-testid="admin-shell">
      <AdminSidebar groups={groups} email={session.user.email} />
      <div className="min-w-0">
        <header
          className="sticky top-0 z-30 flex min-h-14 items-center gap-2 border-b border-border px-4 sm:px-6"
          style={{ background: 'var(--doom-header)', backdropFilter: 'blur(16px)', paddingTop: 'var(--safe-top)' }}
        >
          <AdminMenuButton groups={groups} email={session.user.email} />
          <Link href="/admin" className="flex min-h-11 items-center gap-2 font-bold" aria-label={t('shell.title')}>
            <Logo height={40} />
            <span className="hidden sm:inline">{t('shell.title')}</span>
          </Link>
          <div className="ms-auto flex items-center gap-1">
            <ThemeToggle />
            <LocaleSwitcher variant="menu" />
          </div>
        </header>
        <div className="p-4 pb-16 sm:p-6" id="admin-content">
          {children}
        </div>
      </div>
    </div>
  );
}
