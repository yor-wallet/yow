import type { Metadata } from 'next';
import { asLocale } from '@/i18n/routing';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link, redirect } from '@/i18n/navigation';
import { getSession } from '@/lib/auth';
import { safeRedirectPath } from '@/lib/validation';
import { AuthShell } from '../AuthShell';
import { LoginForm } from './LoginForm';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ next?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'auth.login' });
  return { title: t('metaTitle'), robots: { index: false } };
}

export default async function LoginPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { next: rawNext } = await searchParams;
  const next = rawNext ? safeRedirectPath(rawNext, '/account') : undefined;
  if (await getSession()) redirect({ href: next ?? '/account', locale });
  const t = await getTranslations('auth');

  return (
    <AuthShell title={t('login.title')} subtitle={t('login.subtitle')}>
      <LoginForm next={next} />
      <p className="mt-6 text-center text-sm text-muted">
        {t('login.noAccount')}{' '}
        <Link
          href={next ? { pathname: '/register', query: { next } } : '/register'}
          className="inline-flex min-h-11 items-center font-semibold text-accent underline-offset-4 hover:underline"
        >
          {t('login.createAccount')}
        </Link>
      </p>
    </AuthShell>
  );
}
