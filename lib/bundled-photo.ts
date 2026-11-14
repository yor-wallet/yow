/**
 * Photos shipped with the application itself (public/photos/<pack>/<model>/<finish>.webp, plus .avif and -480 siblings),
 * built from the catalogue packs by scripts/build-bundled-photos.mjs. Their image key is `bundled/<pack>/<model>/<finish>.webp`;
 * the site serves them from its own domain, so they need no storage bucket and no storage credentials.
 */
export const BUNDLED_PREFIX = 'bundled/';

export const bundledPhotoKey = (pack: string, model: string, finish: string): string => `${BUNDLED_PREFIX}${pack}/${model}/${finish}.webp`;

export const isBundledKey = (key: string): boolean => key.startsWith(BUNDLED_PREFIX);

/** Public path of a bundled key (root-relative). */
export const bundledPhotoPath = (key: string): string => `/photos/${key.slice(BUNDLED_PREFIX.length)}`;
