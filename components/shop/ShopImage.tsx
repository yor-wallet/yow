import { cn } from '@/lib/cn';

type ShopImageProps = {
  /** Public URL of the main WebP produced by `storeOptimisedImage`. */
  src: string;
  /** Intrinsic dimensions of `src` (reserves the space: no layout shift). */
  width: number;
  height: number;
  alt: string;
  /** `sizes` attribute (defaults to a full-width image). */
  sizes?: string;
  /** LCP image: eager + high fetch priority. */
  priority?: boolean;
  className?: string;
};

/** Responsive widths written next to the main file when it is wider than them. */
const SIBLING_WIDTHS = [480, 960] as const;

/**
 * Renders an image stored by `lib/admin/media.ts#storeOptimisedImage`: the main WebP plus
 * AVIF and smaller `-480` / `-960` siblings (only the ones narrower than the main file exist).
 * Anything else (external URL, other extension) falls back to a plain `<img>`.
 */
export function ShopImage({ src, width, height, alt, sizes = '100vw', priority = false, className }: ShopImageProps) {
  const img = (
    <img
      src={src}
      width={width}
      height={height}
      alt={alt}
      loading={priority ? 'eager' : 'lazy'}
      decoding="async"
      fetchPriority={priority ? 'high' : 'auto'}
      className={cn('h-auto max-w-full', className)}
    />
  );
  if (!/\.webp$/i.test(src) || src.includes('?')) return img;
  const base = src.replace(/\.webp$/i, '');
  const narrower = SIBLING_WIDTHS.filter((w) => w < width);
  const webp = [...narrower.map((w) => `${base}-${w}.webp ${w}w`), `${src} ${width}w`].join(', ');
  const avif = [...narrower.map((w) => `${base}-${w}.avif ${w}w`), `${base}.avif ${width}w`].join(', ');
  return (
    <picture>
      <source type="image/avif" srcSet={avif} sizes={sizes} />
      <source type="image/webp" srcSet={webp} sizes={sizes} />
      {img}
    </picture>
  );
}
