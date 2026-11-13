import { useId, type CSSProperties } from 'react';
import type { SceneKind } from '@prisma/client';
import { cn } from '@/lib/cn';
import type { CampaignArt, CampaignProduct, CampaignTheme } from '@/lib/catalog/campaigns';
import styles from './scenes.module.css';

/**
 * Decorative CSS-3D scene for a campaign slide (aria-hidden: the slide text carries the
 * accessible content). PHONE rotates in, its screen lights up, specs then the price (only
 * when the linked product really has one) appear as HUD callouts. LAPTOP opens its lid and
 * presents the product line by line. EARBUDS opens the case, the buds float out and the
 * colours of the real variants appear. FLEX / EXPRESS art illustrate the services.
 * `play` = run the entrance animations (active slide, motion allowed); otherwise the final pose.
 */
export function PromoScene({
  kind,
  art,
  theme,
  title,
  product,
  priceLabel,
  play,
  className,
}: {
  kind: SceneKind;
  art: CampaignArt;
  theme: CampaignTheme;
  title: string;
  product: CampaignProduct | null;
  /** Already formatted price (null ⇒ no price shown). */
  priceLabel: string | null;
  play: boolean;
  className?: string;
}) {
  const gradId = `doom-dial-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const warm = theme === 'secondary';
  const specs = product?.specs.slice(0, 3) ?? [];
  const name = product?.name ?? title;
  const i = (n: number) => ({ '--i': n }) as CSSProperties;

  let device: React.ReactNode = null;
  let showFloor = true;
  if (kind === 'PHONE') {
    device = (
      <div className={styles.phone} data-part="phone">
        <div className={styles.phoneBody} />
        <div className={styles.phoneScreen}>
          <div className={styles.screenGlow} />
          <div className={styles.screenContent}>
            {/* Official emblem asset (never redrawn). */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/doom-emblem-transparent-256.webp" alt="" width={256} height={256} className={styles.emblem} style={i(0)} />
            <p className={styles.screenTitle} style={i(1)}>
              {name}
            </p>
            <div className={styles.screenBars} style={i(2)}>
              <span className={styles.screenBar} style={i(2)} />
              <span className={styles.screenBar} style={i(3)} />
              <span className={styles.screenBar} style={i(4)} />
            </div>
          </div>
        </div>
        <div className={styles.island} />
        <div className={styles.glare} />
      </div>
    );
  } else if (kind === 'LAPTOP') {
    const lines = specs.length ? specs : ['', '', ''];
    device = (
      <div className={styles.laptop} data-part="laptop">
        <div className={styles.lid}>
          <div className={styles.lidScreen}>
            <p className={styles.lidTitle} style={i(0)}>
              {name}
            </p>
            {lines.map((s, n) => (
              <span key={`${s}-${n}`} className={styles.lidLine} style={i(n + 1)}>
                {s}
              </span>
            ))}
          </div>
        </div>
        <div className={styles.deck} />
      </div>
    );
  } else if (kind === 'EARBUDS') {
    device = (
      <div className={styles.earbuds} data-part="earbuds">
        <div className={cn(styles.bud, styles.budL)}>
          <span className={styles.budHead} />
          <span className={styles.budStem} />
        </div>
        <div className={cn(styles.bud, styles.budR)}>
          <span className={styles.budHead} />
          <span className={styles.budStem} />
        </div>
        <div className={styles.caseLid} />
        <div className={styles.caseBase}>
          <span className={styles.caseSlot} />
          <span className={styles.led} />
        </div>
      </div>
    );
  } else if (art === 'flex') {
    showFloor = false;
    device = (
      <div className={styles.flexArt} data-part="flex">
        {[12, 6, 3].map((m, n) => (
          <span key={m} className={styles.flexCol} style={i(n)}>
            {m}
          </span>
        ))}
        <span className={styles.zero}>0%</span>
      </div>
    );
  } else if (art === 'express') {
    device = (
      <div className={styles.dial} data-part="express">
        <div className={styles.speed}>
          <span style={i(0)} />
          <span style={i(1)} />
          <span style={i(2)} />
        </div>
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle cx="50" cy="50" r="44" fill="rgb(10 25 55 / 0.55)" stroke="rgb(255 255 255 / 0.18)" strokeWidth="1.5" />
          {Array.from({ length: 24 }, (_, n) => (
            <line
              key={n}
              x1="50"
              y1="9"
              x2="50"
              y2={n % 6 === 0 ? 15 : 12}
              stroke={n % 6 === 0 ? '#fee225' : 'rgb(255 255 255 / 0.35)'}
              strokeWidth={n % 6 === 0 ? 1.6 : 0.8}
              transform={`rotate(${n * 15} 50 50)`}
            />
          ))}
          <circle
            className={styles.dialArc}
            cx="50"
            cy="50"
            r="38"
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth="5"
            strokeLinecap="round"
            pathLength={100}
            transform="rotate(-90 50 50)"
          />
          <defs>
            <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#27407a" />
              <stop offset="1" stopColor="#fee225" />
            </linearGradient>
          </defs>
        </svg>
        <div className={styles.dialLabel}>
          6h
          <small>EXPRESS</small>
        </div>
      </div>
    );
  } else {
    return null;
  }

  const callouts = kind === 'PHONE' || kind === 'LAPTOP' ? specs : [];
  return (
    <div
      className={cn(styles.stage, warm && styles.warm, className)}
      aria-hidden="true"
      data-scene={kind === 'NONE' ? art : kind.toLowerCase()}
      data-play={play ? 'true' : 'false'}
    >
      <div className={styles.halo} />
      {showFloor ? <div className={styles.floor} /> : null}
      {device}
      {kind === 'PHONE' && callouts.length ? (
        <div className={cn(styles.callouts, 'max-md:hidden')}>
          {callouts.map((s, n) => (
            <span key={s} className={styles.callout} style={i(n)}>
              {s}
            </span>
          ))}
        </div>
      ) : null}
      {kind === 'EARBUDS' && product?.colors.length ? (
        <div className={styles.swatches}>
          {product.colors.map((c, n) => (
            <span key={c.hex} className={styles.swatch} style={{ backgroundColor: c.hex, ...i(n) }} title={c.name} />
          ))}
        </div>
      ) : null}
      {priceLabel && kind !== 'NONE' ? <span className={styles.price}>{priceLabel}</span> : null}
    </div>
  );
}
