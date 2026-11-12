/**
 * Device illustrations — decides WHAT to draw for a product that has no uploaded photo.
 *
 * Illustrations are original generic drawings (never a copy of a manufacturer's image): a recognisable
 * silhouette (camera layout per brand family), tinted with the selected variant colour. They are always
 * labelled "Illustration" next to the gallery, so nobody mistakes them for a photo of the exact product.
 * Real photos uploaded by staff always take precedence.
 */

export type DeviceKind = 'phone' | 'foldable';
export type DeviceStyle = 'apple' | 'samsung' | 'honor' | 'oppo' | 'generic';

export type DeviceArtSpec = {
  kind: DeviceKind;
  style: DeviceStyle;
  /** Rear lenses drawn (1–4). */
  cameras: 1 | 2 | 3 | 4;
  /** Body colour, `#rrggbb`. */
  hex: string;
};

export const NEUTRAL_HEX = '#c9c5de';
const HEX = /^#[0-9a-fA-F]{6}$/;

export function styleOfBrand(brand: string | null | undefined): DeviceStyle {
  const b = (brand ?? '').toLowerCase();
  if (b.includes('apple')) return 'apple';
  if (b.includes('samsung')) return 'samsung';
  if (b.includes('honor')) return 'honor';
  if (b.includes('oppo')) return 'oppo';
  return 'generic';
}

/** Lens count by brand family and model name (drawing hint only — not a claim about the product). */
export function camerasFor(style: DeviceStyle, name: string): DeviceArtSpec['cameras'] {
  const n = name.toLowerCase();
  if (style === 'apple') {
    if (/\bpro\b/.test(n)) return 3;
    if (/\bair\b/.test(n) || /\b1[0-9]e\b/.test(n)) return 1;
    return 2;
  }
  if (style === 'samsung') return /ultra/.test(n) ? 4 : /fold|flip/.test(n) ? 3 : 3;
  return /pro|ultra|magic v/.test(n) ? 3 : 2;
}

export function isFoldable(name: string): boolean {
  return /\bfold|\bflip|\bduo\b|magic\s?v\d/i.test(name);
}

/**
 * Art for a smartphone product, or `null` when the product is not a phone (accessories keep their
 * category icon). `rootCategorySlug` / `categorySlug` come from the product's category chain.
 */
export function resolveDeviceArt(input: {
  brand?: string | null;
  name: string;
  categorySlug?: string | null;
  rootCategorySlug?: string | null;
  colorHex?: string | null;
}): DeviceArtSpec | null {
  const isPhone = input.rootCategorySlug === 'smartphones' || input.categorySlug === 'smartphones' || (input.categorySlug ?? '').startsWith('smartphones-');
  if (!isPhone) return null;
  const style = styleOfBrand(input.brand);
  return {
    kind: isFoldable(input.name) ? 'foldable' : 'phone',
    style,
    cameras: camerasFor(style, input.name),
    hex: input.colorHex && HEX.test(input.colorHex) ? input.colorHex.toLowerCase() : NEUTRAL_HEX,
  };
}
