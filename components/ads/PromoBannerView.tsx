'use client';

import { useRef } from 'react';
import { ArrowRight } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/Button';
import { HudCorners } from '@/components/ui/HudCorners';
import { cn } from '@/lib/cn';
import { formatBaisa } from '@/lib/money';
import type { CampaignSlide } from '@/lib/catalog/campaigns';
import { PromoScene } from './PromoScene';
import { SlideMedia } from './SlideMedia';
import { trackCampaign, useCampaignImpression, useMotionPrefs, useVisibleRatio } from './tracking';
import styles from './carousel.module.css';

const BG = {
  primary: 'bg-[linear-gradient(120deg,#10052E_0%,#0B2A6B_60%,#087BFF_150%)]',
  secondary: 'bg-[linear-gradient(120deg,#10052E_0%,#3A1A5E_55%,#FF7900_170%)]',
  premium: 'bg-[linear-gradient(140deg,#10052E_0%,#190B45_60%,#087BFF_160%)]',
} as const;

/**
 * Compact campaign banner for the secondary placements (`home_mid`, `category_top`,
 * `product_side`). `layout="wide"` = full-width strip, `layout="side"` = stacked card for a
 * sidebar. Records an impression at ≥ 50 % visibility and every CTA click.
 */
export function PromoBannerView({ slide, layout = 'wide', placement }: { slide: CampaignSlide; layout?: 'wide' | 'side'; placement: string }) {
  const t = useTranslations('home.carousel');
  const locale = useLocale();
  const ref = useRef<HTMLElement>(null);
  const prefs = useMotionPrefs();
  const visible = useVisibleRatio(ref, 0.5);
  useCampaignImpression(ref, slide.id);
  const play = visible && prefs.ready && !prefs.reduced;
  const hasMedia = !!slide.media && slide.mediaType !== 'SCENE_3D';
  const showScene = !hasMedia && (slide.sceneKind !== 'NONE' || slide.art !== 'generic');
  const price = slide.product?.priceBaisa ?? null;
  const onClick = () => trackCampaign(slide.id, 'click');
  const cta = slide.cta ?? t('buyNow');
  const side = layout === 'side';

  return (
    <aside
      ref={ref}
      data-theme="dark"
      data-testid={`promo-banner-${placement}`}
      data-campaign={slide.slug}
      aria-label={slide.title}
      className={cn('holo-border relative isolate overflow-clip rounded-card text-white shadow-float', BG[slide.theme])}
    >
      <div className={cn(styles.slide, 'min-h-0!')} data-active="true" data-play={play ? 'true' : 'false'}>
        {hasMedia && slide.media ? (
          <>
            <SlideMedia type={slide.mediaType} media={slide.media} priority={false} active visible={visible} play={play} lite={prefs.lite} reduced={prefs.reduced} />
            <div className={styles.scrim} aria-hidden="true" />
          </>
        ) : null}
        <div className={styles.sheen} aria-hidden="true" />
        <div className={cn('relative z-[1] grid items-center gap-4 p-5 sm:p-6', side ? 'grid-cols-1' : 'grid-cols-1 sm:grid-cols-[1fr_auto]')}>
          <div className="min-w-0">
            <p className={styles.rise} style={{ '--i': 0 } as React.CSSProperties}>
              <span className="hud-label">{slide.art === 'flex' ? 'DOOM FLEX' : slide.art === 'express' ? 'DOOM EXPRESS' : t('label')}</span>
            </p>
            <p className={cn(styles.rise, 'neon mt-2 font-display text-xl font-extrabold leading-tight sm:text-2xl')} style={{ '--i': 1 } as React.CSSProperties}>
              {slide.title}
            </p>
            {slide.subtitle ? (
              <p className={cn(styles.rise, 'mt-1.5 line-clamp-3 text-sm text-mist')} style={{ '--i': 2 } as React.CSSProperties}>
                {slide.subtitle}
              </p>
            ) : null}
            {price !== null ? (
              <p className="mt-2 text-sm text-mist">
                {t('from')} <span className="font-display text-lg font-bold text-white tabular-nums [unicode-bidi:isolate]">{formatBaisa(price, locale)}</span>
              </p>
            ) : null}
            {slide.external ? (
              <a href={slide.href} target="_blank" rel="noopener noreferrer" onClick={onClick} className={cn(buttonClasses({ variant: 'primary', size: 'md' }), styles.cta, 'mt-4')}>
                {cta}
                <ArrowRight size={16} aria-hidden="true" className={styles.ctaArrow} />
              </a>
            ) : (
              <Link href={slide.href} onClick={onClick} className={cn(buttonClasses({ variant: slide.theme === 'secondary' ? 'accent' : 'primary', size: 'md' }), styles.cta, 'mt-4')}>
                {cta}
                <ArrowRight size={16} aria-hidden="true" className={styles.ctaArrow} />
              </Link>
            )}
          </div>
          {showScene ? (
            <div className={cn('mx-auto', side ? 'w-40' : 'w-36 sm:w-44')}>
              <PromoScene kind={slide.sceneKind} art={slide.art} theme={slide.theme} title={slide.title} product={slide.product} priceLabel={null} play={play} />
            </div>
          ) : null}
        </div>
      </div>
      <HudCorners className="m-2.5 text-cyan/55" size={12} />
    </aside>
  );
}
