'use client';

import Image from 'next/image';
import { useTheme } from '@/components/layout/ThemeProvider';
import { cn } from '@/lib/cn';

/**
 * Official DOOM | دوم logo (yellow & navy, shopping-bag mark) — generated from
 * brand-src/doom-logo-official.png only. Never recolour, redraw or stretch it.
 * Light surfaces show the logo as it is; on dark surfaces the same logo sits on an off-white
 * plate (the navy wordmark needs a light ground). The `emblem` variant is the bag mark alone.
 * Fixed width/height (aspect-ratio preserved) → zero layout shift.
 */

type Variant = 'horizontal' | 'emblem';
type Surface = 'auto' | 'dark' | 'light';

const ASSETS = {
  horizontal: {
    light: { src: '/brand/doom-logo-horizontal-transparent-640.webp', w: 640, h: 181 },
    dark: { src: '/brand/doom-logo-horizontal-dark-640.webp', w: 640, h: 210 },
  },
  emblem: {
    light: { src: '/brand/doom-emblem-transparent-256.webp', w: 256, h: 256 },
    dark: { src: '/brand/doom-emblem-transparent-256.webp', w: 256, h: 256 },
  },
} as const;

export type LogoProps = {
  variant?: Variant;
  /** Which surface the logo sits on. `auto` follows the current theme. */
  surface?: Surface;
  /** Rendered height in CSS px (width derives from the asset ratio). */
  height?: number;
  priority?: boolean;
  className?: string;
};

export function Logo({ variant = 'horizontal', surface = 'auto', height = 36, priority = false, className }: LogoProps) {
  const { theme } = useTheme();
  const resolved = surface === 'auto' ? theme : surface;
  const asset = ASSETS[variant][resolved];
  const width = Math.round((asset.w / asset.h) * height);
  return (
    <Image
      src={asset.src}
      alt="DOOM | دوم"
      width={width}
      height={height}
      priority={priority}
      quality={90}
      sizes={`${width}px`}
      className={cn('block shrink-0 select-none', className)}
      style={{ width, height }}
      draggable={false}
      data-logo-surface={resolved}
    />
  );
}
