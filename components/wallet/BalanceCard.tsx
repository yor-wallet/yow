import { Gift, Plus, ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { formatBaisa } from '@/lib/money';
import { cn } from '@/lib/cn';
import { buttonClasses } from '@/components/ui/Button';
import { HudCorners } from '@/components/ui/HudCorners';
import { Badge } from '@/components/ui/Badge';

/**
 * Premium wallet balance card: holographic animated border, HUD corners, drifting aurora
 * (static under reduced motion) and the balance in neon display digits.
 */
export function BalanceCard({
  balanceBaisa,
  pendingCount,
  pendingBaisa,
  frozen,
}: {
  balanceBaisa: number;
  pendingCount: number;
  pendingBaisa: number;
  frozen: boolean;
}) {
  const t = useTranslations('wallet');
  const locale = useLocale();
  const amount = formatBaisa(balanceBaisa, locale, { currency: false });
  return (
    <section
      aria-labelledby="wallet-balance-label"
      data-testid="wallet-balance"
      data-theme="dark"
      className="relative isolate overflow-hidden rounded-card holo-border p-5 text-fg shadow-float sm:p-7"
    >
      <span aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden rounded-card bg-gradient-premium">
        <span
          className="absolute -inset-1/4 animate-[doom-aurora_16s_ease-in-out_infinite_alternate] opacity-90 motion-reduce:animate-none"
          style={{
            background:
              'radial-gradient(40% 55% at 15% 20%, rgb(8 123 255 / 0.38), transparent 70%), radial-gradient(35% 45% at 85% 30%, rgb(0 217 255 / 0.26), transparent 70%), radial-gradient(45% 50% at 70% 95%, rgb(255 121 0 / 0.18), transparent 70%)',
          }}
        />
      </span>
      <HudCorners />
      <span aria-hidden="true" className="doom-hairline bottom-0" />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="hud-label">{t('balance.eyebrow')}</span>
        <Badge variant={frozen ? 'warning' : 'success'}>{frozen ? t('balance.frozen') : t('balance.active')}</Badge>
      </div>
      <p id="wallet-balance-label" className="mt-5 text-sm text-muted">
        {t('balance.label')}
      </p>
      <p className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-3 gap-y-1">
        <span
          className="neon font-display text-[clamp(2.1rem,1.4rem+3.2vw,3.4rem)] font-bold leading-none tracking-tight text-fg tabular-nums [unicode-bidi:isolate]"
          data-testid="wallet-balance-amount"
          data-baisa={balanceBaisa}
          dir="ltr"
        >
          {amount}
        </span>
        <span className="font-display text-lg font-semibold text-accent">{locale === 'ar' ? 'ر.ع.' : 'OMR'}</span>
      </p>
      <p className="mt-1 text-xs text-muted">{t('balance.currency')}</p>
      {pendingCount > 0 ? (
        <p className="mt-4 flex flex-wrap items-center gap-2 text-sm text-fg" data-testid="wallet-pending">
          <span className="inline-block size-2 rounded-full bg-amber shadow-glow-orange" aria-hidden="true" />
          {t('balance.pending', { count: pendingCount })}
          {pendingBaisa > 0 ? <span className="text-muted">· {t('balance.pendingAmount', { amount: formatBaisa(pendingBaisa, locale) })}</span> : null}
        </p>
      ) : null}
      <div className="mt-6 grid grid-cols-1 gap-3 xs:grid-cols-2">
        <Link href="/wallet/top-up" className={buttonClasses({ variant: 'accent', size: 'lg', fullWidth: true, className: 'sheen min-h-13' })} data-testid="wallet-topup">
          <Plus size={18} aria-hidden="true" />
          {t('actions.topUp')}
        </Link>
        <Link href="/wallet/gift-card" className={buttonClasses({ variant: 'secondary', size: 'lg', fullWidth: true, className: 'min-h-13' })} data-testid="wallet-giftcard">
          <Gift size={18} aria-hidden="true" />
          {t('actions.giftCard')}
        </Link>
      </div>
    </section>
  );
}

export function TrustCard() {
  const t = useTranslations('wallet.trust');
  const items = [t('confirmed'), t('giftcards'), t('ledger')];
  return (
    <section className="rounded-card border border-border bg-surface p-5 shadow-card" aria-labelledby="wallet-trust">
      <h2 id="wallet-trust" className="flex items-center gap-2 text-base font-bold">
        <ShieldCheck size={18} aria-hidden="true" className="text-cyan" />
        {t('title')}
      </h2>
      <ul className="mt-3 grid grid-cols-1 gap-2.5 text-sm text-muted">
        {items.map((text, i) => (
          <li key={i} className="flex gap-2.5">
            <span aria-hidden="true" className={cn('mt-1.5 size-1.5 shrink-0 rounded-full', i === 1 ? 'bg-orange' : 'bg-cyan')} />
            <span className="min-w-0">{text}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
