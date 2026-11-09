'use client';

import { useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

/** Copies a promo code to the clipboard (falls back to a toast with the code when the clipboard is blocked). */
export function CopyCodeButton({ code }: { code: string }) {
  const t = useTranslations('catalog.promotions');
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      data-testid="copy-code"
      leadingIcon={copied ? <Check size={16} aria-hidden="true" /> : <Copy size={16} aria-hidden="true" />}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          toast({ title: t('copied'), description: code, variant: 'success', durationMs: 2500 });
          window.setTimeout(() => setCopied(false), 2000);
        } catch {
          toast({ title: code, variant: 'info' });
        }
      }}
    >
      {t('copy')}
    </Button>
  );
}
