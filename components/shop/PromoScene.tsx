import type { SceneKind } from '@prisma/client';
import { cn } from '@/lib/cn';
import type { CampaignTheme } from '@/lib/catalog/campaigns';
import styles from './PromoScene.module.css';

/**
 * Decorative 3D scene for a campaign (phone, laptop or earbuds case), drawn in CSS only.
 * `NONE` renders nothing. Purely decorative: hidden from assistive technology.
 */
export function PromoScene({ kind, theme, className }: { kind: SceneKind; theme: CampaignTheme; className?: string }) {
  if (kind === 'NONE') return null;
  return (
    <div className={cn(styles.stage, theme === 'secondary' && styles.warm, className)} aria-hidden="true" data-scene={kind.toLowerCase()}>
      <div className={styles.glow} />
      {kind === 'PHONE' ? (
        <div className={styles.phone}>
          <div className={styles.screen}>
            <div className={styles.sheen} />
          </div>
          <div className={styles.island} />
        </div>
      ) : null}
      {kind === 'LAPTOP' ? (
        <div className={styles.laptop}>
          <div className={styles.lid}>
            <div className={styles.lidScreen} />
          </div>
          <div className={styles.deck} />
        </div>
      ) : null}
      {kind === 'EARBUDS' ? (
        <div className={styles.case}>
          <div className={cn(styles.bud, styles.budL)} />
          <div className={cn(styles.bud, styles.budR)} />
          <div className={styles.caseBase}>
            <div className={styles.led} />
          </div>
          <div className={styles.caseLid} />
        </div>
      ) : null}
    </div>
  );
}
