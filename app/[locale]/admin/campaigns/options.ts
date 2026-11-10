import type { Campaign } from '@prisma/client';
import { CAMPAIGN_PLACEMENTS, CAMPAIGN_THEMES, MEDIA_TYPES, SCENE_KINDS } from '@/lib/admin/campaigns';
import type { CampaignFormValues } from '@/components/admin/CampaignForm';
import type { PickedProduct } from '@/components/admin/ProductPicker';

type T = (key: string) => string;

/** Select options of the campaign form, translated on the server. */
export function campaignOptions(t: T) {
  return {
    mediaTypes: MEDIA_TYPES.map((m) => ({ value: m, label: t(`campaigns.mediaTypes.${m}`) })),
    scenes: SCENE_KINDS.map((s) => ({ value: s, label: t(`campaigns.scenes.${s}`) })),
    themes: CAMPAIGN_THEMES.map((s) => ({ value: s, label: t(`campaigns.themes.${s}`) })),
    placements: CAMPAIGN_PLACEMENTS.map((p) => ({ value: p, label: t(`campaigns.placements.${p}`) })),
  };
}

const loc = (v: unknown): Record<'ar' | 'en' | 'fr', string> => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { ar: typeof o.ar === 'string' ? o.ar : '', en: typeof o.en === 'string' ? o.en : '', fr: typeof o.fr === 'string' ? o.fr : '' };
};

/** `datetime-local` value in Muscat wall time (UTC+4). */
export const muscatInput = (d: Date | null) => (d ? new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 16) : '');

export function campaignValues(c: Campaign | null, products: PickedProduct[]): CampaignFormValues {
  if (!c) {
    return {
      slug: '',
      internalName: '',
      title: loc(null),
      subtitle: loc(null),
      cta: loc(null),
      mediaType: 'IMAGE',
      sceneKind: 'NONE',
      theme: 'premium',
      placements: ['home_hero'],
      products: [],
      linkUrl: '',
      priority: '0',
      startsAt: '',
      endsAt: '',
      isActive: false,
      hasMedia: false,
    };
  }
  return {
    id: c.id,
    slug: c.slug,
    internalName: c.internalName,
    title: loc(c.title),
    subtitle: loc(c.subtitle),
    cta: loc(c.cta),
    mediaType: c.mediaType,
    sceneKind: c.sceneKind,
    theme: c.theme ?? 'premium',
    placements: c.placements,
    products,
    linkUrl: c.linkUrl ?? '',
    priority: String(c.priority),
    startsAt: muscatInput(c.startsAt),
    endsAt: muscatInput(c.endsAt),
    isActive: c.isActive,
    hasMedia: !!(c.mediaKey || c.mediaKeyMobile || c.posterKey),
  };
}
