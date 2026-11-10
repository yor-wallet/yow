import type { Metadata } from 'next';
import { KeyRound, MonitorSmartphone, UserX } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireUser } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { ACCOUNT_DELETION_SUBJECT } from '@/lib/support';
import { PageHeader } from '@/components/layout/PageHeader';
import { Card } from '@/components/ui/Card';
import { HudCorners } from '@/components/ui/HudCorners';
import { ChangePasswordForm, DeletionRequest, SessionList, type SessionView } from '@/components/account/SecurityForms';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'account.security' });
  return { title: t('metaTitle'), robots: { index: false } };
}

/** Minimal user-agent summary (no fingerprinting library): browser + OS. */
function describeAgent(ua: string | null): { browser: string | null; os: string | null; mobile: boolean } {
  if (!ua) return { browser: null, os: null, mobile: false };
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /SamsungBrowser/.test(ua)
      ? 'Samsung Internet'
      : /OPR\/|Opera/.test(ua)
        ? 'Opera'
        : /Firefox\//.test(ua)
          ? 'Firefox'
          : /Chrome\/|CriOS/.test(ua)
            ? 'Chrome'
            : /Safari\//.test(ua)
              ? 'Safari'
              : null;
  const os = /Android/.test(ua)
    ? 'Android'
    : /iPhone|iPad|iPod/.test(ua)
      ? 'iOS'
      : /Windows/.test(ua)
        ? 'Windows'
        : /Mac OS X|Macintosh/.test(ua)
          ? 'macOS'
          : /CrOS/.test(ua)
            ? 'ChromeOS'
            : /Linux/.test(ua)
              ? 'Linux'
              : null;
  return { browser, os, mobile: /Mobile|Android|iPhone|iPad/.test(ua) };
}

export default async function SecurityPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const session = await requireUser({ next: '/account/security' });
  const [t, format, rows, deletion] = await Promise.all([
    getTranslations('account.security'),
    getFormatter(),
    prisma.session.findMany({
      where: { userId: session.user.id, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { lastSeenAt: 'desc' },
      take: 20,
      select: { id: true, ip: true, userAgent: true, createdAt: true, lastSeenAt: true },
    }),
    prisma.supportTicket.findFirst({
      where: { userId: session.user.id, subject: ACCOUNT_DELETION_SUBJECT, status: { notIn: ['CLOSED', 'RESOLVED'] } },
      select: { number: true },
    }),
  ]);
  const sessions: SessionView[] = rows
    .map((s) => {
      const a = describeAgent(s.userAgent);
      return {
        id: s.id,
        device: a.browser && a.os ? t('browserOn', { browser: a.browser, os: a.os }) : (a.browser ?? a.os ?? t('unknownDevice')),
        mobile: a.mobile,
        ip: s.ip,
        lastActive: format.dateTime(s.lastSeenAt, 'long'),
        signedIn: format.dateTime(s.createdAt, 'short'),
        current: s.id === session.sessionId,
      };
    })
    .sort((a, b) => Number(b.current) - Number(a.current));

  return (
    <div className="pb-14">
      <PageHeader title={t('title')} fallbackHref="/account" />
      <div className="page-container mt-5 grid grid-cols-1 gap-5 lg:mt-6 lg:grid-cols-12">
        <Card tone="glass" className="relative lg:col-span-5">
          <HudCorners size={12} />
          <h2 className="flex items-center gap-2 text-lg font-bold">
            <KeyRound size={20} aria-hidden="true" className="text-cyan" />
            {t('passwordTitle')}
          </h2>
          <p className="mb-4 text-sm text-muted">{t('passwordText')}</p>
          <ChangePasswordForm />
        </Card>
        <div className="flex min-w-0 flex-col gap-5 lg:col-span-7">
          <Card tone="glass">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <MonitorSmartphone size={20} aria-hidden="true" className="text-cyan" />
              {t('sessionsTitle')}
            </h2>
            <p className="mb-4 text-sm text-muted">{t('sessionsText')}</p>
            <SessionList sessions={sessions} />
          </Card>
          <Card className="border-error/40">
            <h2 className="flex items-center gap-2 text-lg font-bold">
              <UserX size={20} aria-hidden="true" className="text-error" />
              {t('deletionTitle')}
            </h2>
            <p className="mb-4 text-sm text-muted">{t('deletionText')}</p>
            <DeletionRequest pendingNumber={deletion?.number ?? null} />
          </Card>
        </div>
      </div>
    </div>
  );
}
