'use client';

import { useState } from 'react';
import { Copy, KeyRound } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { useToast } from '@/components/ui/Toast';

/** Large 6-digit handover code (shown to the order owner only, while out for delivery). */
export function HandoverCode({
  code,
  title,
  text,
  meta,
  copyLabel,
  copiedLabel,
}: {
  code: string;
  title: string;
  text: string;
  meta?: string;
  copyLabel: string;
  copiedLabel: string;
}) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      toast({ title: copiedLabel, variant: 'success' });
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard denied — the code stays visible */
    }
  };
  return (
    <section
      data-theme="dark"
      className="relative overflow-hidden rounded-card border border-border bg-gradient-premium p-5 text-fg shadow-glow-cyan sm:p-6"
      aria-labelledby="handover-title"
      data-testid="handover-code"
    >
      <span aria-hidden="true" className="pointer-events-none absolute -end-16 -top-16 size-48 rounded-full bg-cyan/20 blur-3xl" />
      <div className="relative flex items-center gap-2 text-cyan">
        <KeyRound size={20} aria-hidden="true" />
        <h2 id="handover-title" className="text-base font-bold text-fg">
          {title}
        </h2>
      </div>
      <p className="relative mt-1 text-sm text-muted">{text}</p>
      <p className="relative mt-4 flex justify-center gap-1.5 sm:gap-2.5" dir="ltr" aria-label={code.split('').join(' ')} data-testid="handover-code-value">
        {code.split('').map((d, i) => (
          <span
            key={i}
            aria-hidden="true"
            className="grid h-14 w-[clamp(2.25rem,11vw,3.25rem)] place-items-center rounded-xl border border-cyan/40 bg-night/60 font-mono text-[clamp(1.5rem,7vw,2rem)] font-extrabold tabular-nums text-white shadow-[inset_0_0_18px_rgb(0_217_255/0.18)]"
          >
            {d}
          </span>
        ))}
      </p>
      <div className="relative mt-4 flex flex-wrap items-center justify-between gap-2">
        {meta ? <p className="text-xs text-muted">{meta}</p> : <span />}
        <Button variant="outline" size="sm" onClick={copy} leadingIcon={<Copy size={16} aria-hidden="true" />}>
          {copied ? copiedLabel : copyLabel}
        </Button>
      </div>
    </section>
  );
}
