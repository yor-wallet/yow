/**
 * Which photos belong to the selected variant (owner's specification §4, "product photos"):
 *   - a photo attached to a variant shows one FINISH; it serves every capacity of that colour;
 *   - a photo attached to no variant is general (the whole range, the box…) and suits any selection;
 *   - a photo of another colour is never shown for the selected one: when the selected colour has no
 *     photo of its own and there is no general photo, the storefront says "image not available".
 */

export type ColouredImage = {
  /** Variant the photo is attached to; null = general photo. */
  variantId: string | null;
  /** Colour of that variant (null for a general photo, or a variant without a colour). */
  color: string | null;
};

const norm = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

export function imagesForVariant<T extends ColouredImage>(
  images: readonly T[],
  selected: { id: string; color: string | null } | null | undefined,
): { images: T[]; missingForColour: boolean } {
  const colour = norm(selected?.color);
  // Nothing selected, or a variant without a colour: every photo applies.
  if (!selected || !colour) return { images: [...images], missingForColour: false };

  const own: T[] = [];
  const general: T[] = [];
  for (const img of images) {
    if (img.variantId === null) general.push(img);
    else if (img.variantId === selected.id || norm(img.color) === colour) own.push(img);
  }
  const matching = [...own, ...general];
  return { images: matching, missingForColour: matching.length === 0 && images.length > 0 };
}

/** The one photo for a variant in a small slot (cart line, order line): its colour first, else a general photo, else none. */
export function thumbnailForVariant<T extends ColouredImage>(images: readonly T[], variant: { id: string; color: string | null }): T | null {
  return imagesForVariant(images, variant).images[0] ?? null;
}
