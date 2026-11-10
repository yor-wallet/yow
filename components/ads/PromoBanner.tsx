import { unstable_rethrow } from 'next/navigation';
import { getCachedCampaigns } from '@/lib/catalog/cache';
import type { Placement } from '@/lib/catalog/campaigns';
import { PromoBannerView } from './PromoBannerView';

/**
 * Server loader for a secondary ad placement. Renders the highest-priority live campaign of
 * `placement`, or nothing at all when none is live (never a placeholder ad).
 */
export async function PromoBanner({ placement, locale, layout = 'wide', className }: { placement: Placement; locale: string; layout?: 'wide' | 'side'; className?: string }) {
  let slide;
  try {
    slide = (await getCachedCampaigns(placement, locale))[0];
  } catch (err) {
    unstable_rethrow(err);
    console.error(`[ads] ${placement} unavailable`, err);
    return null;
  }
  if (!slide) return null;
  return (
    <div className={className}>
      <PromoBannerView slide={slide} layout={layout} placement={placement} />
    </div>
  );
}
