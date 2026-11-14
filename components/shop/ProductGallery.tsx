'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ImageOff, ZoomIn } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Modal } from '@/components/ui/Modal';
import { useHistoryModal } from '@/components/ui/useHistoryModal';
import { cn } from '@/lib/cn';
import type { ImageView } from '@/lib/catalog/queries';
import { ShopImage } from './ShopImage';

/**
 * Product gallery: swipeable scroll-snap viewport (touch), previous/next buttons, thumbnails and a
 * zoom dialog (click/tap the image; Back closes it). `activeId` lets the parent jump to the image
 * of the selected variant. All images keep their intrinsic ratio box, so nothing shifts on load.
 */
export function ProductGallery({ images, activeId, name }: { images: ImageView[]; activeId?: string | null; name: string }) {
  const t = useTranslations('product.gallery');
  const [index, setIndex] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const zoomModal = useHistoryModal('product-zoom');
  const count = images.length;

  const scrollTo = (i: number, smooth = true) => {
    const el = viewport.current;
    if (!el) return;
    const rtl = getComputedStyle(el).direction === 'rtl';
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: (rtl ? -1 : 1) * i * el.clientWidth, behavior: smooth && !reduce ? 'smooth' : 'auto' });
  };

  // Follow the selected variant's image.
  useEffect(() => {
    if (!activeId) return;
    const i = images.findIndex((img) => img.id === activeId);
    if (i >= 0) {
      setIndex(i);
      scrollTo(i);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const onScroll = () => {
    const el = viewport.current;
    if (!el || !el.clientWidth) return;
    const i = Math.round(Math.abs(el.scrollLeft) / el.clientWidth);
    if (i !== index && i >= 0 && i < count) setIndex(i);
  };

  if (count === 0) {
    return (
      <div className="grid aspect-square w-full place-items-center rounded-card border border-border bg-surface-2 text-muted" data-testid="gallery-empty">
        <div className="flex flex-col items-center gap-2">
          <ImageOff size={40} aria-hidden="true" />
          <p className="text-sm">{t('empty')}</p>
        </div>
      </div>
    );
  }

  const current = images[Math.min(index, count - 1)]!;
  return (
    <div className="flex flex-col gap-3" data-testid="product-gallery" role="group" aria-roledescription="carousel" aria-label={t('label')}>
      <div className="relative overflow-hidden rounded-card border border-border bg-surface">
        <div
          ref={viewport}
          onScroll={onScroll}
          data-scroll-x
          className="scrollbar-none flex snap-x snap-mandatory overflow-x-auto [overscroll-behavior-x:contain]"
        >
          {images.map((img, i) => (
            <button
              key={img.id}
              type="button"
              onClick={zoomModal.open}
              aria-label={`${img.alt} — ${t('counter', { current: i + 1, total: count })}`}
              className="relative grid aspect-square w-full shrink-0 cursor-zoom-in snap-center place-items-center focus-visible:outline-2 focus-visible:outline-offset-[-4px] focus-visible:outline-ring"
            >
              <ShopImage src={img.src} width={img.width} height={img.height} alt={img.alt} sizes="(min-width: 1024px) 45vw, 100vw" priority={i === 0} className="size-full object-contain p-4" />
            </button>
          ))}
        </div>
        {count > 1 ? (
          <>
            <button
              type="button"
              onClick={() => scrollTo(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label={t('previous')}
              className="absolute start-2 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-bg/85 backdrop-blur transition-opacity disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-ring sm:grid"
            >
              <ChevronLeft size={22} aria-hidden="true" className="flip-rtl" />
            </button>
            <button
              type="button"
              onClick={() => scrollTo(Math.min(count - 1, index + 1))}
              disabled={index === count - 1}
              aria-label={t('next')}
              className="absolute end-2 top-1/2 hidden size-11 -translate-y-1/2 place-items-center rounded-full border border-border-strong bg-bg/85 backdrop-blur transition-opacity disabled:opacity-0 focus-visible:outline-2 focus-visible:outline-ring sm:grid"
            >
              <ChevronRight size={22} aria-hidden="true" className="flip-rtl" />
            </button>
            <p dir="ltr" className="pointer-events-none absolute bottom-2 end-3 rounded-pill bg-bg/80 px-2.5 py-0.5 text-xs font-medium tabular-nums backdrop-blur" aria-live="polite">
              {t('counter', { current: index + 1, total: count })}
            </p>
          </>
        ) : null}
        <span aria-hidden="true" className="pointer-events-none absolute start-3 top-3 grid size-9 place-items-center rounded-full bg-bg/80 text-muted backdrop-blur">
          <ZoomIn size={18} />
        </span>
      </div>

      {count > 1 ? (
        <div className="flex justify-center gap-2 lg:hidden" aria-hidden="true" data-testid="gallery-dots">
          {images.map((img, i) => (
            <span key={img.id} className={cn('size-2 rounded-full transition-colors', i === index ? 'bg-blue' : 'bg-border-strong')} />
          ))}
        </div>
      ) : null}

      {count > 1 ? (
        <ul className="scrollbar-none hidden gap-2 overflow-x-auto pb-1 lg:flex" data-scroll-x aria-label={t('label')}>
          {images.map((img, i) => (
            <li key={img.id} className="shrink-0">
              <button
                type="button"
                onClick={() => {
                  setIndex(i);
                  scrollTo(i);
                }}
                aria-label={t('thumb', { index: i + 1 })}
                aria-current={i === index ? 'true' : undefined}
                className={cn(
                  'grid size-16 place-items-center overflow-hidden rounded-xl border bg-surface transition-[border-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:size-20',
                  i === index ? 'border-blue shadow-glow-blue' : 'border-border hover:border-border-strong',
                )}
              >
                <ShopImage src={img.src} width={img.width} height={img.height} alt="" sizes="80px" className="size-full object-contain p-1" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <Modal
        {...zoomModal.props}
        title={name}
        hideTitle
        className="max-w-5xl"
      >
        <button
          type="button"
          onClick={() => setZoomed((z) => !z)}
          aria-label={current.alt}
          className={cn('block max-h-[78dvh] w-full overflow-auto rounded-xl bg-surface-2', zoomed ? 'cursor-zoom-out' : 'cursor-zoom-in')}
        >
          <ShopImage
            src={current.src}
            width={current.width}
            height={current.height}
            alt={current.alt}
            sizes="100vw"
            className={cn('mx-auto transition-[width] duration-(--dur-nav)', zoomed ? 'max-w-none' : 'max-h-[74dvh] w-auto max-w-full object-contain')}
          />
        </button>
        {count > 1 ? (
          <div className="mt-3 flex items-center justify-between gap-3">
            <button type="button" onClick={() => setIndex((i) => (i - 1 + count) % count)} aria-label={t('previous')} className="grid size-11 place-items-center rounded-full border border-border-strong hover:bg-surface-2">
              <ChevronLeft size={22} aria-hidden="true" className="flip-rtl" />
            </button>
            <p dir="ltr" className="text-sm tabular-nums text-muted">{t('counter', { current: index + 1, total: count })}</p>
            <button type="button" onClick={() => setIndex((i) => (i + 1) % count)} aria-label={t('next')} className="grid size-11 place-items-center rounded-full border border-border-strong hover:bg-surface-2">
              <ChevronRight size={22} aria-hidden="true" className="flip-rtl" />
            </button>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
