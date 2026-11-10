'use client';

import { useEffect, useRef, useState } from 'react';
import { getImageProps } from 'next/image';
import type { CampaignMediaType } from '@prisma/client';
import { cn } from '@/lib/cn';
import styles from './carousel.module.css';

type Media = { src: string; mobileSrc: string | null; poster: string | null };

/**
 * Campaign media layer.
 *  IMAGE  → next/image (AVIF/WebP), art-directed mobile source, `priority` on the first slide only (LCP).
 *  VIDEO  → muted, inline, poster, loaded only once its slide is shown and played only while active
 *           and on screen; LITE mode (reduced motion / Save-Data / ≤ 4 cores) shows the poster only.
 *  LOTTIE → `lottie-web` light player, imported lazily the first time such a slide is shown;
 *           reduced motion renders the first frame, LITE mode the poster.
 */
export function SlideMedia({
  type,
  media,
  priority,
  active,
  play,
  visible,
  lite,
  reduced,
}: {
  type: CampaignMediaType;
  media: Media;
  priority: boolean;
  active: boolean;
  /** Entrance animations allowed (active + motion). */
  play: boolean;
  /** Carousel on screen and tab visible. */
  visible: boolean;
  lite: boolean;
  reduced: boolean;
}) {
  if (type === 'VIDEO') {
    return lite ? <Poster media={media} priority={priority} /> : <VideoLayer media={media} active={active} visible={visible} />;
  }
  if (type === 'LOTTIE') {
    return lite && !reduced && media.poster ? (
      <Poster media={media} priority={priority} />
    ) : (
      <LottieLayer src={media.src} active={active} visible={visible} still={reduced || lite} />
    );
  }
  return <ArtDirectedImage src={media.src} mobileSrc={media.mobileSrc} priority={priority} kenBurns={play} />;
}

function ArtDirectedImage({ src, mobileSrc, priority, kenBurns }: { src: string; mobileSrc: string | null; priority: boolean; kenBurns: boolean }) {
  const common = { alt: '', fill: true, quality: 82, priority, sizes: '(min-width: 1600px) 1520px, 100vw' } as const;
  const { props: desktop } = getImageProps({ ...common, src });
  const { props: mobile } = getImageProps({ ...common, src: mobileSrc ?? src, sizes: '100vw' });
  const { srcSet: _m, ...imgProps } = mobile;
  return (
    <picture className={styles.media}>
      <source media="(min-width: 768px)" srcSet={desktop.srcSet} sizes={desktop.sizes} />
      {/* eslint-disable-next-line jsx-a11y/alt-text -- decorative, alt="" from getImageProps */}
      <img {...imgProps} srcSet={mobile.srcSet} className={cn(styles.kenburns)} data-kenburns={kenBurns ? 'on' : 'off'} draggable={false} />
    </picture>
  );
}

function Poster({ media, priority }: { media: Media; priority: boolean }) {
  if (!media.poster) return null;
  return <ArtDirectedImage src={media.poster} mobileSrc={null} priority={priority} kenBurns={false} />;
}

function VideoLayer({ media, active, visible }: { media: Media; active: boolean; visible: boolean }) {
  const ref = useRef<HTMLVideoElement>(null);
  // Never download a video before its slide has been shown once.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (active && visible) setArmed(true);
  }, [active, visible]);
  useEffect(() => {
    const v = ref.current;
    if (!v || !armed) return;
    if (active && visible) void v.play().catch(() => undefined);
    else v.pause();
  }, [active, visible, armed]);
  return (
    <div className={styles.media}>
      <video
        ref={ref}
        src={armed ? media.src : undefined}
        poster={media.poster ?? undefined}
        muted
        loop
        playsInline
        preload="none"
        aria-hidden="true"
        tabIndex={-1}
        disablePictureInPicture
        data-testid="hero-video"
      />
    </div>
  );
}

type LottieInstance = { play(): void; pause(): void; goToAndStop(v: number, isFrame?: boolean): void; destroy(): void };

function LottieLayer({ src, active, visible, still }: { src: string; active: boolean; visible: boolean; still: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const anim = useRef<LottieInstance | null>(null);
  const [armed, setArmed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (active && visible) setArmed(true);
  }, [active, visible]);

  useEffect(() => {
    if (!armed || !host.current) return;
    let cancelled = false;
    void import('lottie-web/build/player/lottie_light').then((mod) => {
      if (cancelled || !host.current) return;
      const lottie = (mod as unknown as { default: { loadAnimation: (o: Record<string, unknown>) => LottieInstance } }).default;
      anim.current = lottie.loadAnimation({
        container: host.current,
        renderer: 'svg',
        loop: true,
        autoplay: false,
        path: src,
        rendererSettings: { preserveAspectRatio: 'xMidYMid slice', progressiveLoad: true },
      });
      if (still) anim.current.goToAndStop(0, true);
      setLoaded(true);
    });
    return () => {
      cancelled = true;
      anim.current?.destroy();
      anim.current = null;
      setLoaded(false);
    };
  }, [armed, src, still]);

  useEffect(() => {
    const a = anim.current;
    if (!a || still) return;
    if (active && visible) a.play();
    else a.pause();
  }, [active, visible, still, loaded]);

  return <div ref={host} className={styles.media} aria-hidden="true" data-testid="hero-lottie" />;
}
