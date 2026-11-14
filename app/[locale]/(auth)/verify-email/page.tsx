import type { Metadata } from 'next';
import { CheckCircle2, CircleAlert } from 'lucide-react';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';
import { confirmEmail } from '@/lib/auth/email-verification';
import { buttonClasses } from '@/components/ui/Button';
import { AuthShell } from '../AuthShell';

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<{ token?: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'auth.verifyEmail' });
  return { title: t('title'), robots: { index: false, follow: false }, referrer: 'no-referrer' };
}

/** Landing page of the confirmation link sent by e-mail. */
export default async function VerifyEmailPage({ params, searchParams }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  const { token } = await searchParams;
  const res = token ? await confirmEmail(token) : ({ ok: false, error: 'invalid' } as const);
  const t = await getTranslations('auth.verifyEmail');
  return (
    <AuthShell title={t('title')} subtitle={res.ok ? t('okText') : t('invalidText')}>
      <div className="rounded-card border border-border bg-surface p-5" data-testid="verify-email" data-result={res.ok ? 'ok' : 'invalid'} aria-live="polite">
        <div className="flex items-start gap-3">
          {res.ok ? <CheckCircle2 size={28} aria-hidden="true" className="shrink-0 text-success" /> : <CircleAlert size={28} aria-hidden="true" className="shrink-0 text-error" />}
          <div className="min-w-0">
            <h2 className="text-lg font-bold">{res.ok ? t('okTitle') : t('invalidTitle')}</h2>
            <p className="mt-1 text-sm text-muted">{res.ok ? t('okText') : t('invalidText')}</p>
          </div>
        </div>
        <Link href="/account/verification" className={buttonClasses({ variant: 'accent', size: 'lg', className: 'mt-5 w-full' })}>
          {res.ok ? t('next') : t('resend')}
        </Link>
      </div>
    </AuthShell>
  );
}
