'use client';

import { useState, useTransition } from 'react';
import { MailCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { resendVerificationEmailAction } from '@/app/[locale]/account/verification/actions';

/** Shown until the account e-mail is confirmed: identity verification starts after that. */
export function EmailConfirmCard({ email }: { email: string }) {
  const t = useTranslations('kyc.emailConfirm');
  const [pending, start] = useTransition();
  const [result, setResult] = useState<string | null>(null);
  return (
    <section className="rounded-card border border-amber/50 bg-amber/10 p-4" data-testid="email-confirm" aria-labelledby="email-confirm-title">
      <div className="flex items-start gap-3">
        <MailCheck size={24} aria-hidden="true" className="mt-0.5 shrink-0" />
        <div className="min-w-0">
          <h2 id="email-confirm-title" className="font-bold">
            {t('title')}
          </h2>
          <p className="mt-1 text-sm">{t('text')}</p>
          <p className="mt-1 break-all text-sm font-semibold" dir="ltr">
            {email}
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-3"
            loading={pending}
            onClick={() =>
              start(async () => {
                const res = await resendVerificationEmailAction();
                setResult(res.ok ? 'sent' : res.error);
              })
            }
            data-testid="email-confirm-resend"
          >
            {t('resend')}
          </Button>
          {result ? (
            <p className="mt-2 text-sm" role="status" data-testid="email-confirm-result" data-code={result}>
              {t(`result.${result as 'sent'}`)}
            </p>
          ) : null}
        </div>
      </div>
    </section>
  );
}
