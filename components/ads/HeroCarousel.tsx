'use client';

import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/Button';
import { HudCorners } from '@/components/ui/HudCorners';
import { cn } from '@/lib/cn';
import { formatBaisa } from '@/lib/money';
import { productPath } from '@/lib/catalog/paths';
import type { CampaignSlide, CampaignTheme } from '@/lib/catalog/campaigns';
import { PromoScene } from './PromoScene';
import { SlideMedia } from './SlideMedia';
import { trackCampaign, useMotionPrefs, useVisibleRatio } from './tracking';
import styles from './carousel.module.css';

export const HERO_INTERVAL_MS = 7000;
const SWIPE_PX = 48;

const THEME_BG: Record<CampaignTheme, string> = {
  primary: 'bg-[linear-gradient(135deg,#0a1937_0%,#12254d_55%,#27407a_140%)]',
  secondary: 'bg-[linear-gradient(135deg,#0a1937_0%,#12254d_52%,#27407a_165%)]',
  premium: 'bg-[linear-gradient(160deg,#0a1937_0%,#12254d_55%,#27407a_150%)]',
};

/**
 * Home hero ad carousel (SPEC → Ads), driven by `Campaign` rows (placement `home_hero`).
 * Cinematic cross-fade/slide, Ken Burns on media, pointer parallax depth layers, a light sheen
 * sweep, staggered text, CSS-3D scenes. Autoplay with a visible pause/play button; pauses on
 * hover, focus, hidden tab and when scrolled away. Dots + prev/next (RTL-aware), swipe, arrow
 * keys. `prefers-reduced-motion`: starts paused and every slide is static (still navigable).
 * Impressions (≥ 50 % visible, once per session) and clicks are recorded server-side.
 */
export function HeroCarousel({ slides }: { slides: CampaignSlide[] }) {
  const t = useTranslations('home.carousel');
  const count = slides.length;
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const prefs = useMotionPrefs();
  const visible = useVisibleRatio(root, 0.5);
  const motion = prefs.ready && !prefs.reduced;

  // Reduced motion: no automatic movement unless the user explicitly presses Play.
  const reducedApplied = useRef(false);
  useEffect(() => {
    if (prefs.ready && prefs.reduced && !reducedApplied.current) {
      reducedApplied.current = true;
      setUserPaused(true);
    }
  }, [prefs.ready, prefs.reduced]);

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + count) % count), [count]);
  const autoplay = !userPaused && count > 1;
  const held = hovered || focused || !visible;
  const running = autoplay && !held;

  // Timer that survives temporary holds (hover/focus/off-screen) without restarting the slide.
  const remaining = useRef(HERO_INTERVAL_MS);
  useEffect(() => {
    remaining.current = HERO_INTERVAL_MS;
  }, [index, userPaused]);
  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const id = window.setTimeout(() => go(1), remaining.current);
    return () => {
      window.clearTimeout(id);
      remaining.current = Math.max(250, remaining.current - (Date.now() - started));
    };
  }, [running, index, go]);

  // Impression of the slide actually shown (carousel ≥ 50 % visible).
  const current = slides[index];
  useEffect(() => {
    if (current && visible) trackCampaign(current.id, 'impression');
  }, [current, visible]);

  // Pointer parallax (fine pointers only, motion allowed).
  const frame = useRef(0);
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!motion || e.pointerType !== 'mouse') return;
    const el = root.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    const py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      el.style.setProperty('--px', px.toFixed(3));
      el.style.setProperty('--py', py.toFixed(3));
    });
  };
  const resetParallax = () => {
    cancelAnimationFrame(frame.current);
    root.current?.style.setProperty('--px', '0');
    root.current?.style.setProperty('--py', '0');
  };

  // Swipe (touch & pen); a swipe never turns into a click on the CTA underneath.
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const isRtl = () => (root.current ? getComputedStyle(root.current).direction === 'rtl' : false);
  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse') return;
    swipe.current = { x: e.clientX, y: e.clientY };
    swiped.current = false;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const s = swipe.current;
    swipe.current = null;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) < SWIPE_PX || Math.abs(dx) < Math.abs(dy) * 1.2) return;
    swiped.current = true;
    go((dx < 0 ? 1 : -1) * (isRtl() ? -1 : 1));
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if ((e.target as HTMLElement).closest('input,textarea,select')) return;
    e.preventDefault();
    const forward = e.key === 'ArrowRight' ? 1 : -1;
    go(forward * (isRtl() ? -1 : 1));
  };

  if (count === 0) return null;

  return (
    <div
      ref={root}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('label')}
      data-testid="hero-carousel"
      data-theme="dark"
      data-index={index}
      data-playing={autoplay ? 'true' : 'false'}
      data-held={held ? 'true' : 'false'}
      data-motion={motion ? 'full' : 'reduced'}
      style={{ '--interval': `${HERO_INTERVAL_MS}ms` } as CSSProperties}
      className={cn(styles.root, 'holo-border relative overflow-clip rounded-[28px] text-white shadow-float')}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => {
        setHovered(false);
        resetParallax();
      }}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setFocused(false);
      }}
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipe.current = null)}
      onClickCapture={(e) => {
        if (swiped.current) {
          e.preventDefault();
          e.stopPropagation();
          swiped.current = false;
        }
      }}
      onKeyDown={onKeyDown}
    >
      <div className={styles.track} aria-live={autoplay && !held ? 'off' : 'polite'}>
        {slides.map((s, i) => (
          <Slide
            key={s.id}
            slide={s}
            position={i}
            total={count}
            active={i === index}
            exit={i < index ? -1 : 1}
            play={i === index && motion}
            visible={visible}
            lite={prefs.lite}
            reduced={prefs.reduced}
          />
        ))}
      </div>

      <HudCorners className="m-3 text-cyan/60 sm:m-4" size={16} />

      {count > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 px-3 pb-1.5 sm:px-8 sm:pb-5">
          <div className="pointer-events-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setUserPaused((p) => !p)}
              aria-label={userPaused ? t('play') : t('pause')}
              aria-pressed={userPaused}
              data-testid="carousel-toggle"
              className={styles.control}
            >
              {userPaused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            </button>
            <button type="button" onClick={() => go(-1)} aria-label={t('previous')} data-testid="carousel-prev" className={cn(styles.control, 'max-sm:hidden!')}>
              <ChevronLeft size={20} aria-hidden="true" className="flip-rtl" />
            </button>
            <button type="button" onClick={() => go(1)} aria-label={t('next')} data-testid="carousel-next" className={cn(styles.control, 'max-sm:hidden!')}>
              <ChevronRight size={20} aria-hidden="true" className="flip-rtl" />
            </button>
          </div>
          <ol className="pointer-events-auto flex min-w-0 items-center max-md:absolute max-md:inset-x-[3.25rem] max-md:bottom-1.5 max-md:justify-center" data-scroll-x>
            {slides.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t('goTo', { index: i + 1, title: s.title })}
                  aria-current={i === index ? 'true' : undefined}
                  data-testid="carousel-dot"
                  className="grid h-11 min-w-6 place-items-center px-0.5 xs:min-w-10 focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-ring sm:min-w-7 sm:px-1"
                >
                  <span className={styles.dot} data-current={i === index ? 'true' : 'false'}>
                    {i === index ? <span className={styles.dotFill} /> : null}
                  </span>
                </button>
              </li>
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

function Slide({
  slide,
  position,
  total,
  active,
  exit,
  play,
  visible,
  lite,
  reduced,
}: {
  slide: CampaignSlide;
  position: number;
  total: number;
  active: boolean;
  exit: 1 | -1;
  play: boolean;
  visible: boolean;
  lite: boolean;
  reduced: boolean;
}) {
  const t = useTranslations('home.carousel');
  const locale = useLocale();
  const hasMedia = !!slide.media && slide.mediaType !== 'SCENE_3D';
  const price = slide.product?.priceBaisa ?? null;
  const priceLabel = price !== null ? formatBaisa(price, locale) : null;
  const showScene = !hasMedia && (slide.sceneKind !== 'NONE' || slide.art !== 'generic');
  const eyebrow = slide.art === 'flex' ? 'DOOM FLEX' : slide.art === 'express' ? 'DOOM EXPRESS' : t('label');
  const rise = (n: number) => ({ className: styles.rise, style: { '--i': n } as CSSProperties });
  const ctaLabel = slide.cta ?? t('buyNow');
  const onCta = () => trackCampaign(slide.id, 'click');
  const ctaClass = cn(buttonClasses({ variant: slide.theme === 'secondary' ? 'accent' : 'primary', size: 'lg' }), styles.cta, 'max-md:min-h-11 max-md:rounded-pill max-md:px-4 max-md:text-sm');

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={`${t('slide', { current: position + 1, total })} — ${slide.title}`}
      aria-hidden={!active}
      inert={!active}
      data-active={active ? 'true' : 'false'}
      data-play={play ? 'true' : 'false'}
      data-testid="hero-slide"
      data-campaign={slide.slug}
      style={{ '--exit': exit } as CSSProperties}
      className={cn(styles.slide, slide.theme === 'secondary' && styles.warm, THEME_BG[slide.theme])}
    >
      {/* depth: far (aurora), mid (grid + circuit traces) */}
      <div className={cn(styles.layer, styles.far)} aria-hidden="true">
        <span className={styles.orbA} />
        <span className={styles.orbB} />
      </div>
      <div className={cn(styles.layer, styles.mid)} aria-hidden="true">
        <span className={styles.grid} />
        <svg className={styles.circuit} viewBox="0 0 400 300" fill="none" preserveAspectRatio="xMaxYMid slice">
          <g stroke="currentColor" strokeWidth="1.2" strokeLinecap="round">
            <path d="M400 40H300l-30 30h-80" />
            <circle cx="186" cy="70" r="4" />
            <path d="M400 210h-60l-24-24v-60" />
            <circle cx="316" cy="122" r="4" />
            <path d="M260 300v-50l30-30h40" />
            <circle cx="334" cy="220" r="3.5" />
          </g>
        </svg>
      </div>

      {hasMedia && slide.media ? (
        <>
          <SlideMedia
            type={slide.mediaType}
            media={slide.media}
            priority={position === 0}
            active={active}
            play={play}
            visible={visible}
            lite={lite}
            reduced={reduced}
          />
          <div className={styles.scrim} aria-hidden="true" />
        </>
      ) : null}
      <div className={styles.sheen} aria-hidden="true" />

      <div className="relative z-[1] grid h-full grid-cols-[1.25fr_0.75fr] items-center gap-3 px-4 pb-12 pt-5 md:grid-cols-[1.05fr_0.95fr] md:gap-6 md:px-10 md:pb-20 md:pt-9 lg:px-14">
        <div className="min-w-0 max-w-xl">
          <p {...rise(0)} className={cn(styles.rise, 'max-md:hidden')}>
            <span className="hud-label">{eyebrow}</span>
          </p>
          <h2 {...rise(1)} className={cn(styles.rise, 'neon font-display text-[1.35rem] font-extrabold leading-[1.15] md:mt-3 md:text-[clamp(1.75rem,4.8vw,3.25rem)] md:leading-[1.06]')}>
            {slide.title}
          </h2>
          {slide.subtitle ? (
            <p {...rise(2)} className={cn(styles.rise, 'mt-3 hidden max-w-lg text-base text-mist sm:text-lg md:block')}>
              {slide.subtitle}
            </p>
          ) : null}

          {slide.product ? (
            <div {...rise(3)} className={cn(styles.rise, 'mt-4 space-y-3 max-md:hidden', showScene && slide.sceneKind === 'PHONE' && 'md:sr-only')}>
              {slide.product.specs.length > 0 ? (
                <ul aria-label={t('specs')} className="flex flex-wrap gap-2">
                  {slide.product.specs.map((spec) => (
                    <li key={spec} className="rounded-pill border border-cyan/35 bg-night/40 px-3 py-1 text-xs font-medium backdrop-blur">
                      {spec}
                    </li>
                  ))}
                </ul>
              ) : null}
              {priceLabel ? (
                <p className="text-sm text-mist">
                  {t('from')} <span className="font-display text-xl font-bold text-white tabular-nums [unicode-bidi:isolate]">{priceLabel}</span>
                </p>
              ) : null}
              {slide.product.colors.length > 0 ? (
                <ul aria-label={t('colours')} className="flex items-center gap-1.5">
                  {slide.product.colors.map((c) => (
                    <li key={c.hex} title={c.name} className="size-4 rounded-full border border-white/60" style={{ backgroundColor: c.hex }}>
                      <span className="sr-only">{c.name}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          <div {...rise(4)} className={cn(styles.rise, 'mt-3 flex flex-wrap gap-3 md:mt-6')}>
            {slide.external ? (
              <a href={slide.href} target="_blank" rel="noopener noreferrer" onClick={onCta} data-testid="hero-cta" className={ctaClass}>
                {ctaLabel}
                <ArrowRight size={18} aria-hidden="true" className={styles.ctaArrow} />
              </a>
            ) : (
              <Link href={slide.href} onClick={onCta} data-testid="hero-cta" className={ctaClass}>
                {ctaLabel}
                <ArrowRight size={18} aria-hidden="true" className={styles.ctaArrow} />
              </Link>
            )}
            {slide.sceneKind === 'PHONE' && slide.product && priceLabel ? (
              <Link
                href={productPath(slide.product.slug)}
                onClick={onCta}
                data-testid="hero-buy"
                className={buttonClasses({ variant: 'secondary', size: 'lg', className: 'max-md:hidden' })}
              >
                {t('buyNow')}
              </Link>
            ) : null}
          </div>
        </div>

        {showScene ? (
          <div className={cn(styles.near, 'w-full max-w-[8.5rem] justify-self-end md:mx-auto md:max-w-[25rem] md:justify-self-auto')}>
            <PromoScene
              kind={slide.sceneKind}
              art={slide.art}
              theme={slide.theme}
              title={slide.title}
              product={slide.product}
              priceLabel={slide.sceneKind === 'NONE' ? null : priceLabel}
              play={play}
            />
          </div>
        ) : null}
      </div>
    </div>
  );
}
