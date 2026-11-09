import type { Metadata } from 'next';
import { ChevronRight, LayoutDashboard, LogOut, Package, ShieldCheck, Wallet } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { requireUser } from '@/lib/auth';
import { isStaff } from '@/lib/rbac';
import { asLocale, LOCALE_LABELS } from '@/i18n/routing';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { Badge, type BadgeVariant } from '@/components/ui/Badge';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { logoutAction } from '../(auth)/actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'account' });
  return { title: t('metaTitle'), robots: { index: false } };
}

const KYC_BADGE: Record<string, BadgeVariant> = {
  UNVERIFIED: 'neutral',
  PENDING: 'info',
  DOCUMENTS_REQUESTED: 'warning',
  VERIFIED: 'success',
  REJECTED: 'error',
};

/**
 * Minimal account shell (foundation). The logistics & account module extends it
 * (addresses, KYC flow, notifications, support).
 */
export default async function AccountPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { user } = await requireUser({ next: '/account' });
  const t = await getTranslations('account');

  const links = [
    { href: '/orders', icon: Package, title: t('links.orders'), text: t('links.ordersText') },
    { href: '/wallet', icon: Wallet, title: t('links.wallet'), text: t('links.walletText') },
    ...(isStaff(user.role) ? [{ href: '/admin', icon: LayoutDashboard, title: t('links.admin'), text: t('links.adminText') }] : []),
  ];

  return (
    <div>
      <PageHeader title={t('title')} fallbackHref="/" />
      <div className="page-container mt-6 grid grid-cols-1 gap-5 lg:mt-8 lg:grid-cols-3">
        <Card className="lg:col-span-1" data-testid="account-profile">
          <p className="text-sm text-muted">{t('greeting', { name: user.fullName })}</p>
          <h2 className="mt-1 text-lg font-bold">{t('profile.title')}</h2>
          <dl className="mt-4 grid grid-cols-1 gap-3 text-sm">
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
              <dd className="mt-1">
                <Badge variant={KYC_BADGE[user.kycStatus] ?? 'neutral'}>{t(`kyc.status.${user.kycStatus}`)}</Badge>
              </dd>
            </div>
          </dl>
          <form action={logoutAction} className="mt-6">
            <SubmitButton variant="outline" fullWidth leadingIcon={<LogOut size={18} aria-hidden="true" />} data-testid="logout">
              {t('logout')}
            </SubmitButton>
          </form>
        </Card>

        <ul className="grid grid-cols-1 gap-3 lg:col-span-2 lg:grid-cols-2 lg:content-start">
          {links.map(({ href, icon: Icon, title, text }) => (
            <li key={href}>
              <Link
                href={href}
                className="group flex min-h-20 items-center gap-4 rounded-card border border-border bg-surface p-4 shadow-card transition-[border-color,box-shadow,transform] duration-(--dur-card) hover:-translate-y-0.5 hover:border-border-strong hover:shadow-glow-blue"
              >
                <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-gradient-premium text-cyan">
                  <Icon size={20} aria-hidden="true" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-muted">{text}</span>
                </span>
                <ChevronRight size={18} aria-hidden="true" className="flip-rtl shrink-0 text-muted" />
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
