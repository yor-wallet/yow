'use client';

import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { buttonClasses } from '@/components/ui/Button';

/**
 * Shown wherever a payment method is locked because the customer's identity is not verified yet:
 * says why and leads straight to the verification — never a silent, greyed-out method.
 */
export function KycRequiredNotice({ className }: { className?: string }) {
  const t = useTranslations('payments.kycNotice');
  return (
    <div
      className={cn('flex flex-col gap-3 rounded-2xl border border-blue/40 bg-blue/8 p-4 sm:flex-row sm:items-center sm:justify-between', className)}
      data-testid="kyc-required-notice"
    >
      <div className="flex items-start gap-3">
        <ShieldCheck size={22} aria-hidden="true" className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0">
          <p className="font-semibold">{t('title')}</p>
          <p className="mt-0.5 text-sm text-muted">{t('text')}</p>
        </div>
      </div>
      <Link href="/account/verification" className={cn(buttonClasses({ variant: 'primary' }), 'shrink-0')} data-testid="kyc-required-cta">
        {t('cta')}
      </Link>
    </div>
  );
}
