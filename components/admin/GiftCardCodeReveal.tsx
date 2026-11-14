'use client';

import { useState, useTransition } from 'react';
import { Check, Copy, Eye, EyeOff } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { revealGiftCardCodeAction } from '@/app/[locale]/admin/finance/gift-cards/actions';

/** Shows the card code on demand. Each reveal is recorded in the audit log; the code is never in the page source. */
export function GiftCardCodeReveal({ id }: { id: string }) {
  const t = useTranslations('admin.giftCards');
  const [code, setCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  const reveal = () =>
    start(async () => {
      setError(null);
      const res = await revealGiftCardCodeAction(id);
      if (res.ok) setCode(res.code);
      else setError(res.error);
    });

  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable: the code stays selectable */
    }
  };

  return (
    <div className="mt-4 border-t border-border pt-4" data-testid="giftcard-code">
      {code === null ? (
        <Button type="button" variant="outline" onClick={reveal} loading={pending} loadingLabel={t('revealing')} leadingIcon={<Eye size={16} aria-hidden="true" />} data-testid="giftcard-reveal">
          {t('revealCode')}
        </Button>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="select-all break-all rounded-xl border border-border-strong bg-surface-2 p-3 font-mono text-lg font-semibold tracking-wider" dir="ltr" data-testid="giftcard-code-value">
            {code}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={copy} leadingIcon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}>
              {copied ? t('copied') : t('copy')}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setCode(null)} leadingIcon={<EyeOff size={16} aria-hidden="true" />}>
              {t('hideCode')}
            </Button>
          </div>
        </div>
      )}
      {error ? (
        <p role="alert" className="mt-2 text-sm font-medium text-error" data-testid="giftcard-reveal-error">
          {t('revealError')}
        </p>
      ) : null}
      <p className="mt-2 text-xs text-muted">{t('codeAudit')}</p>
    </div>
  );
}
