'use client';

import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ChevronLeft, ChevronRight, Pause, Play } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { buttonClasses } from '@/components/ui/Button';
import { cn } from '@/lib/cn';
import { formatBaisa } from '@/lib/money';
import type { CampaignSlide, CampaignTheme } from '@/lib/catalog/campaigns';
import { PromoScene } from './PromoScene';

const INTERVAL_MS = 6500;
const SWIPE_PX = 48;

const THEME_BG: Record<CampaignTheme, string> = {
  primary: 'bg-[linear-gradient(135deg,#10052E_0%,#0B2A6B_55%,#087BFF_135%)]',
  secondary: 'bg-[linear-gradient(135deg,#10052E_0%,#4A1E5C_50%,#FF7900_150%)]',
  premium: 'bg-gradient-premium',
};

/** Fire-and-forget server-side statistics. Impressions are counted once per tab session. */
function track(id: string, type: 'impression' | 'click') {
  try {
    if (type === 'impression') {
      const key = `doom:imp:${id}`;
      if (sessionStorage.getItem(key)) return;
      sessionStorage.setItem(key, '1');
    }
    const body = new Blob([JSON.stringify({ id, type })], { type: 'application/json' });
    if (!navigator.sendBeacon?.('/api/campaigns/track', body)) {
      void fetch('/api/campaigns/track', { method: 'POST', body, keepalive: true, headers: { 'Content-Type': 'application/json' } }).catch(() => undefined);
    }
  } catch {
    /* statistics must never break the page */
  }
}

/**
 * Premium hero carousel for the home page (SPEC → Ads): cross-fade, Ken Burns zoom,
 * CSS 3D scenes, animated text, play/pause, dots, swipe. Pauses on hover / focus / when
 * hidden; `prefers-reduced-motion` turns autoplay and every animation off.
 */
export function HeroCarousel({ slides }: { slides: CampaignSlide[] }) {
  const t = useTranslations('home.carousel');
  const locale = useLocale();
  const [index, setIndex] = useState(0);
  const [userPaused, setUserPaused] = useState(false);
  const [held, setHeld] = useState(false);
  const [reduced, setReduced] = useState(false);
  const [onScreen, setOnScreen] = useState(true);
  const root = useRef<HTMLDivElement>(null);
  const swipeStart = useRef<number | null>(null);
  const count = slides.length;

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setReduced(mq.matches);
    apply();
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, []);

  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const io = new IntersectionObserver(([entry]) => setOnScreen(!!entry?.isIntersecting), { threshold: 0.25 });
    io.observe(el);
    const vis = () => setOnScreen((prev) => (document.hidden ? false : prev));
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  const go = useCallback((delta: number) => setIndex((i) => (i + delta + count) % count), [count]);
  const playing = !userPaused && !held && !reduced && onScreen && count > 1;

  useEffect(() => {
    if (!playing) return;
    const id = window.setTimeout(() => go(1), INTERVAL_MS);
    return () => window.clearTimeout(id);
  }, [playing, index, go]);

  const current = slides[index];
  useEffect(() => {
    if (current && onScreen) track(current.id, 'impression');
  }, [current, onScreen]);

  if (count === 0) return null;

  const onPointerDown = (e: ReactPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    swipeStart.current = e.clientX;
  };
  const onPointerUp = (e: ReactPointerEvent) => {
    const start = swipeStart.current;
    swipeStart.current = null;
    if (start === null) return;
    const dx = e.clientX - start;
    if (Math.abs(dx) < SWIPE_PX) return;
    const rtl = getComputedStyle(e.currentTarget as HTMLElement).direction === 'rtl';
    go((dx < 0 ? 1 : -1) * (rtl ? -1 : 1));
  };

  return (
    <div
      ref={root}
      role="region"
      aria-roledescription="carousel"
      aria-label={t('label')}
      data-testid="hero-carousel"
      data-theme="dark"
      className="relative overflow-hidden rounded-[28px] border border-border text-white shadow-float [touch-action:pan-y]"
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocusCapture={() => setHeld(true)}
      onBlurCapture={() => setHeld(false)}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerCancel={() => (swipeStart.current = null)}
    >
      <div className="grid" aria-live={playing ? 'off' : 'polite'}>
        {slides.map((s, i) => (
          <Slide key={s.id} slide={s} active={i === index} position={i + 1} total={count} reduced={reduced} locale={locale} />
        ))}
      </div>

      {count > 1 ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-4 pb-4 sm:px-8">
          <div className="pointer-events-auto flex items-center gap-1">
            <button
              type="button"
              onClick={() => setUserPaused((p) => !p)}
              aria-label={userPaused ? t('play') : t('pause')}
              aria-pressed={userPaused}
              data-testid="carousel-toggle"
              className="grid size-11 place-items-center rounded-full bg-night/60 text-white backdrop-blur transition-colors hover:bg-night/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              {userPaused ? <Play size={18} aria-hidden="true" /> : <Pause size={18} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={() => go(-1)}
              aria-label={t('previous')}
              className="hidden size-11 place-items-center rounded-full bg-night/60 text-white backdrop-blur transition-colors hover:bg-night/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:grid"
            >
              <ChevronLeft size={20} aria-hidden="true" className="flip-rtl" />
            </button>
            <button
              type="button"
              onClick={() => go(1)}
              aria-label={t('next')}
              className="hidden size-11 place-items-center rounded-full bg-night/60 text-white backdrop-blur transition-colors hover:bg-night/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:grid"
            >
              <ChevronRight size={20} aria-hidden="true" className="flip-rtl" />
            </button>
          </div>
          <ol className="pointer-events-auto flex items-center">
            {slides.map((s, i) => (
              <li key={s.id}>
                <button
                  type="button"
                  onClick={() => setIndex(i)}
                  aria-label={t('goTo', { index: i + 1, title: s.title })}
                  aria-current={i === index ? 'true' : undefined}
                  className="grid size-11 place-items-center focus-visible:outline-2 focus-visible:outline-offset-[-6px] focus-visible:outline-ring"
                >
                  <span
                    className={cn(
                      'block h-2 rounded-full transition-[width,background-color] duration-(--dur-nav) ease-premium',
                      i === index ? 'w-7 bg-cyan' : 'w-2 bg-white/45',
                    )}
                  />
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
  active,
  position,
  total,
  reduced,
  locale,
}: {
  slide: CampaignSlide;
  active: boolean;
  position: number;
  total: number;
  reduced: boolean;
  locale: string;
}) {
  const t = useTranslations('home.carousel');
  const videoRef = useRef<HTMLVideoElement>(null);
  const isVideo = slide.mediaType === 'VIDEO' && !!slide.media;
  const isImage = slide.mediaType === 'IMAGE' && !!slide.media;

  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (active && !reduced) void v.play().catch(() => undefined);
    else v.pause();
  }, [active, reduced]);

  const cta = slide.cta ?? t('buyNow');
  const linkProps = { 'data-testid': 'hero-cta', onClick: () => track(slide.id, 'click'), className: buttonClasses({ variant: slide.theme === 'secondary' ? 'accent' : 'primary', size: 'lg' }) };

  return (
    <div
      role="group"
      aria-roledescription="slide"
      aria-label={t('slide', { current: position, total })}
      aria-hidden={!active}
      inert={!active}
      data-active={active}
      data-testid="hero-slide"
      className={cn(
        'relative col-start-1 row-start-1 min-h-[34rem] overflow-hidden transition-opacity duration-(--dur-banner) ease-premium sm:min-h-[30rem] lg:min-h-[32rem]',
        THEME_BG[slide.theme],
        active ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
    >
      {isImage && slide.media ? (
        <picture>
          {slide.media.mobileSrc ? <source media="(max-width: 767px)" srcSet={slide.media.mobileSrc} /> : null}
          <img
            src={slide.media.src}
            alt=""
            loading={position === 1 ? 'eager' : 'lazy'}
            fetchPriority={position === 1 ? 'high' : 'auto'}
            decoding="async"
            className={cn('absolute inset-0 size-full object-cover', active && !reduced && 'motion-safe:animate-kenburns')}
          />
        </picture>
      ) : null}
      {isVideo && slide.media ? (
        <video ref={videoRef} src={slide.media.src} poster={slide.media.poster ?? undefined} muted loop playsInline preload="metadata" aria-hidden="true" className="absolute inset-0 size-full object-cover" />
      ) : null}
      {isImage || isVideo ? <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,rgb(16_5_46/0.88)_0%,rgb(16_5_46/0.45)_55%,transparent_100%)] rtl:bg-[linear-gradient(270deg,rgb(16_5_46/0.88)_0%,rgb(16_5_46/0.45)_55%,transparent_100%)]" /> : null}
      {!isImage && !isVideo ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute -end-24 -top-24 size-80 rounded-full opacity-60 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(0 217 255 / 0.5), transparent 65%)' }} />
          <div aria-hidden="true" className="pointer-events-none absolute -bottom-28 -start-20 size-72 rounded-full opacity-50 blur-3xl" style={{ background: 'radial-gradient(circle, rgb(255 121 0 / 0.45), transparent 65%)' }} />
        </>
      ) : null}

      <div className="relative grid h-full items-center gap-6 px-5 pb-20 pt-8 sm:px-10 md:grid-cols-[1.1fr_0.9fr] lg:px-14">
        <div className={cn('min-w-0 max-w-xl', active && !reduced && 'motion-safe:animate-slide-up')}>
          {slide.art === 'flex' ? <p className="text-sm font-semibold text-cyan">DOOM FLEX</p> : null}
          {slide.art === 'express' ? <p className="text-sm font-semibold text-cyan">DOOM EXPRESS</p> : null}
          <h2 className="mt-2 text-[clamp(1.7rem,4.6vw,3.1rem)] font-extrabold leading-[1.1]">{slide.title}</h2>
          {slide.subtitle ? <p className="mt-3 max-w-lg text-base text-mist sm:text-lg">{slide.subtitle}</p> : null}

          {slide.product ? (
            <div className="mt-4 space-y-3">
              {slide.product.specs.length > 0 ? (
                <ul aria-label={t('specs')} className="flex flex-wrap gap-2">
                  {slide.product.specs.map((spec) => (
                    <li key={spec} className="rounded-pill border border-white/25 bg-white/10 px-3 py-1 text-xs font-medium backdrop-blur">
                      {spec}
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                {slide.product.priceBaisa !== null ? (
                  <p className="text-sm text-mist">
                    {t('from')}{' '}
                    <span className="text-xl font-bold text-white tabular-nums [unicode-bidi:isolate]">{formatBaisa(slide.product.priceBaisa, locale)}</span>
                  </p>
                ) : null}
                {slide.product.colors.length > 0 ? (
                  <ul aria-label={t('colours')} className="flex items-center gap-1.5">
                    {slide.product.colors.map((c) => (
                      <li key={c.hex} title={c.name} className="size-4 rounded-full border border-white/50" style={{ backgroundColor: c.hex }}>
                        <span className="sr-only">{c.name}</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </div>
          ) : null}

          <div className="mt-6 flex flex-wrap gap-3">
            {slide.external ? (
              <a href={slide.href} target="_blank" rel="noopener noreferrer" {...linkProps}>
                {cta}
              </a>
            ) : (
              <Link href={slide.href} {...linkProps}>
                {cta}
              </Link>
            )}
          </div>
        </div>

        {!isImage && !isVideo ? (
          <div className="w-[min(58vw,13rem)] justify-self-center md:w-full md:max-w-[22rem]">
            <PromoScene kind={slide.sceneKind} theme={slide.theme} />
          </div>
        ) : null}
      </div>
    </div>
  );
}
