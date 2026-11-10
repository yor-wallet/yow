import type { Metadata } from 'next';
import {
  Bell,
  BadgePercent,
  BriefcaseBusiness,
  LayoutGrid,
  Bike,
  ChevronRight,
  CircleHelp,
  Heart,
  KeyRound,
  LayoutDashboard,
  LifeBuoy,
  LogOut,
  MapPin,
  Package,
  ShieldCheck,
  UserRoundCog,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { isStaff } from '@/lib/rbac';
import { asLocale, LOCALE_LABELS } from '@/i18n/routing';
import { formatBaisa } from '@/lib/money';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { HudCorners } from '@/components/ui/HudCorners';
import { SectionHeading } from '@/components/ui/SectionHeading';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { buttonClasses } from '@/components/ui/Button';
import { KycStatusBadge } from '@/components/delivery/StatusBadges';
import { IconTile } from '@/components/account/IconTile';
import { logoutAction } from '../(auth)/actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'account' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const ACTIVE_ORDER = ['PAID', 'PROCESSING', 'PACKED', 'SHIPPED', 'OUT_FOR_DELIVERY'] as const;

type Section = { href: string; icon: LucideIcon; title: string; text: string; badge?: number; testId?: string };

/** Account overview: identity, verification, wallet, orders and every account section. */
export default async function AccountPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/account' });
  const [t, format, details, wallet, ordersCount, activeOrders, unread, courier] = await Promise.all([
    getTranslations('account'),
    getFormatter(),
    prisma.user.findUnique({ where: { id: user.id }, select: { createdAt: true } }),
    prisma.wallet.findUnique({ where: { userId: user.id }, select: { ledgerAccount: { select: { balanceBaisa: true } } } }),
    prisma.order.count({ where: { userId: user.id } }),
    prisma.order.count({ where: { userId: user.id, status: { in: [...ACTIVE_ORDER] } } }),
    prisma.notification.count({ where: { userId: user.id, readAt: null } }),
    prisma.courier.findFirst({ where: { userId: user.id, isActive: true }, select: { id: true } }),
  ]);

  const sections: Section[] = [
    { href: '/orders', icon: Package, title: t('links.orders'), text: t('links.ordersText') },
    { href: '/account/addresses', icon: MapPin, title: t('links.addresses'), text: t('links.addressesText'), testId: 'account-link-addresses' },
    { href: '/account/verification', icon: ShieldCheck, title: t('links.verification'), text: t('links.verificationText') },
    { href: '/wallet', icon: Wallet, title: t('links.wallet'), text: t('links.walletText') },
    { href: '/flex', icon: BadgePercent, title: t('links.flex'), text: t('links.flexText') },
    { href: '/favorites', icon: Heart, title: t('links.favorites'), text: t('links.favoritesText') },
    { href: '/account/notifications', icon: Bell, title: t('links.notifications'), text: t('links.notificationsText'), badge: unread },
    { href: '/account/support', icon: LifeBuoy, title: t('links.support'), text: t('links.supportText') },
    { href: '/account/profile', icon: UserRoundCog, title: t('links.profile'), text: t('links.profileText') },
    { href: '/account/security', icon: KeyRound, title: t('links.security'), text: t('links.securityText') },
    { href: '/help', icon: CircleHelp, title: t('links.help'), text: t('links.helpText') },
  ];
  const staffSections: Section[] = [
    ...(courier || user.role === 'LOGISTICS' ? [{ href: '/courier', icon: Bike, title: t('links.courier'), text: t('links.courierText') }] : []),
    ...(isStaff(user.role) ? [{ href: '/admin', icon: LayoutDashboard, title: t('links.admin'), text: t('links.adminText') }] : []),
  ];
  const initials = user.fullName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} fallbackHref="/" />
      <div className="page-container mt-5 grid grid-cols-1 gap-6 lg:mt-8 lg:grid-cols-12">
        {/* Identity card */}
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-4">
          <div className="relative rounded-card" data-theme="dark">
            <Card tone="premium" className="relative overflow-hidden" data-testid="account-profile">
              <HudCorners />
              <span aria-hidden="true" className="pointer-events-none absolute -end-20 -top-24 size-64 rounded-full bg-blue/30 blur-3xl" />
              <span aria-hidden="true" className="pointer-events-none absolute -bottom-24 -start-16 size-56 rounded-full bg-orange/15 blur-3xl" />
              <span className="hud-label relative">{t('profile.title')}</span>
              <div className="relative mt-4 flex items-center gap-4">
                <span
                  className="font-display grid size-16 shrink-0 place-items-center rounded-2xl bg-gradient-primary text-xl font-extrabold text-on-accent shadow-glow-cyan"
                  aria-hidden="true"
                >
                  {initials || '•'}
                </span>
                <div className="min-w-0">
                  <p className="text-sm text-muted">{t('greeting', { name: user.fullName.split(' ')[0] ?? user.fullName })}</p>
                  <h2 className="truncate text-xl font-extrabold">{user.fullName}</h2>
                  {details ? <p className="text-xs text-muted">{t('memberSince', { date: format.dateTime(details.createdAt, 'short') })}</p> : null}
                </div>
              </div>
              <dl className="relative mt-5 grid grid-cols-1 gap-3 text-sm">
                <div>
                  <dt className="text-muted">{t('profile.email')}</dt>
                  <dd className="break-all font-medium" dir="ltr">
                    {user.email}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t('profile.phone')}</dt>
                  <dd className="font-medium" dir="ltr">
                    {user.phone ?? t('profile.notSet')}
                  </dd>
                </div>
                <div>
                  <dt className="text-muted">{t('profile.language')}</dt>
                  <dd className="font-medium">{LOCALE_LABELS[user.locale]}</dd>
                </div>
                <div>
                  <dt className="flex items-center gap-1.5 text-muted">
                    <ShieldCheck size={16} aria-hidden="true" />
                    {t('kyc.title')}
                  </dt>
                  <dd className="mt-1 flex flex-wrap items-center gap-2">
                    <KycStatusBadge status={user.kycStatus} />
                    <Link href="/account/verification" className="inline-flex min-h-11 items-center text-sm font-semibold text-cyan underline-offset-4 hover:underline">
                      {t(`kyc.cta.${user.kycStatus}`)}
                    </Link>
                  </dd>
                </div>
              </dl>
              <form action={logoutAction} className="relative mt-5">
                <SubmitButton variant="outline" fullWidth leadingIcon={<LogOut size={18} aria-hidden="true" />} data-testid="logout">
                  {t('logout')}
                </SubmitButton>
              </form>
            </Card>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6 lg:col-span-8">
          {/* Quick stats */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <Link href="/wallet" className="relative rounded-card holo-border p-4 shadow-card transition-shadow duration-(--dur-card) hover:shadow-glow-blue" data-testid="account-wallet">
              <HudCorners size={10} />
              <p className="flex items-center gap-2 text-sm text-muted">
                <Wallet size={16} aria-hidden="true" className="text-accent" />
                {t('overview.wallet')}
              </p>
              <p className="font-display neon mt-1 text-2xl font-extrabold tabular-nums [unicode-bidi:isolate]">
                {wallet ? formatBaisa(wallet.ledgerAccount.balanceBaisa, locale) : <span className="text-base font-semibold text-muted [text-shadow:none]">{t('overview.walletInactive')}</span>}
              </p>
            </Link>
            <Card interactive padded={false} className="p-4">
              <Link href="/orders" className="block">
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Package size={16} aria-hidden="true" className="text-accent" />
                  {t('overview.orders')}
                </p>
                <p className="font-display mt-1 text-2xl font-extrabold tabular-nums">{ordersCount}</p>
                <p className="text-xs text-muted">{t('overview.activeOrders', { count: activeOrders })}</p>
              </Link>
            </Card>
            <Card interactive padded={false} className="p-4">
              <Link href="/account/notifications" className="block">
                <p className="flex items-center gap-2 text-sm text-muted">
                  <Bell size={16} aria-hidden="true" className="text-orange" />
                  {t('overview.notifications')}
                </p>
                <p className="font-display mt-1 text-2xl font-extrabold tabular-nums">{unread}</p>
              </Link>
            </Card>
          </div>

          {user.kycStatus !== 'VERIFIED' ? (
            <div className="relative flex flex-col gap-3 rounded-card border border-orange/30 bg-surface p-4 shadow-card sm:flex-row sm:items-center sm:justify-between sm:p-5">
              <div className="flex min-w-0 items-center gap-3">
                <IconTile icon={ShieldCheck} tone="orange" />
                <div className="min-w-0">
                  <p className="font-semibold">{t('links.verification')}</p>
                  <p className="text-sm text-muted">{t('links.verificationText')}</p>
                </div>
              </div>
              <Link href="/account/verification" className={buttonClasses({ variant: 'accent', size: 'sm', className: 'shrink-0' })}>
                {t(`kyc.cta.${user.kycStatus}`)}
              </Link>
            </div>
          ) : null}

          <section aria-labelledby="account-sections">
            <SectionHeading
              id="account-sections"
              title={
                <span className="flex items-center gap-2.5">
                  <LayoutGrid size={22} aria-hidden="true" className="shrink-0 text-accent" />
                  {t('overview.sections')}
                </span>
              }
            />
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {sections.map((s) => (
                <li key={s.href}>
                  <SectionLink {...s} />
                </li>
              ))}
            </ul>
          </section>

          {staffSections.length ? (
            <section aria-labelledby="account-staff">
              <SectionHeading
                id="account-staff"
                title={
                  <span className="flex items-center gap-2.5">
                    <BriefcaseBusiness size={22} aria-hidden="true" className="shrink-0 text-accent" />
                    {t('overview.staff')}
                  </span>
                }
              />
              <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
                {staffSections.map((s) => (
                  <li key={s.href}>
                    <SectionLink {...s} />
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SectionLink({ href, icon: Icon, title, text, badge, testId }: Section) {
  return (
    <Link
      href={href}
      data-spotlight=""
      data-testid={testId}
      className="spotlight holo-border-hover group flex min-h-20 items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-[box-shadow,transform] duration-(--dur-card) ease-premium hover:-translate-y-0.5 hover:shadow-glow-blue"
    >
      <IconTile icon={Icon}>
        {badge ? (
          <span className="absolute -end-1.5 -top-1.5 inline-flex min-w-5 items-center justify-center rounded-pill bg-gradient-secondary px-1 text-[11px] font-bold leading-5 text-on-accent">
            {badge > 99 ? '99+' : badge}
          </span>
        ) : null}
      </IconTile>
      <span className="min-w-0 flex-1">
        <span className="block font-semibold">{title}</span>
        <span className="block text-sm text-muted">{text}</span>
      </span>
      <ChevronRight size={18} aria-hidden="true" className="flip-rtl shrink-0 text-muted transition-transform duration-(--dur-btn) group-hover:translate-x-0.5 rtl:group-hover:-translate-x-0.5" />
    </Link>
  );
}
