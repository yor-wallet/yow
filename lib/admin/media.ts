import { buildKey, getStorage, sniffMime, type SniffedType } from '@/lib/storage';

/**
 * Upload validation + optimisation for admin media (product images, campaign media).
 * Never trusts the client MIME or extension: the type comes from magic bytes
 * (`sniffMime`), Lottie files must parse as JSON with the Bodymovin structure.
 */

export type MediaKind = 'image' | 'video' | 'lottie';

export const MEDIA_RULES: Record<MediaKind, { mimes: readonly SniffedType[]; maxBytes: number }> = {
  image: { mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/avif'], maxBytes: 8 * 1024 * 1024 },
  video: { mimes: ['video/mp4', 'video/webm'], maxBytes: 10 * 1024 * 1024 },
  lottie: { mimes: ['application/json'], maxBytes: 2 * 1024 * 1024 },
};

export type MediaCheck = { ok: true; mime: SniffedType } | { ok: false; code: 'empty' | 'too_large' | 'bad_type' | 'bad_lottie' | 'bad_image' };

/** Minimal Bodymovin/Lottie structure: version, frame rate, in/out points, size and layers. */
export function isLottieJson(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  const num = (k: string) => typeof v[k] === 'number' && Number.isFinite(v[k] as number);
  return (
    typeof v.v === 'string' &&
    num('fr') &&
    (v.fr as number) > 0 &&
    num('ip') &&
    num('op') &&
    (v.op as number) > (v.ip as number) &&
    num('w') &&
    num('h') &&
    (v.w as number) > 0 &&
    (v.h as number) > 0 &&
    Array.isArray(v.layers)
  );
}

/** Validate size + real type of an upload for the given kind. */
export function validateMedia(buf: Buffer, kind: MediaKind): MediaCheck {
  if (!buf || buf.length === 0) return { ok: false, code: 'empty' };
  const rules = MEDIA_RULES[kind];
  if (buf.length > rules.maxBytes) return { ok: false, code: 'too_large' };
  const mime = sniffMime(buf);
  if (!mime || !rules.mimes.includes(mime)) return { ok: false, code: 'bad_type' };
  if (kind === 'video' && mime === 'video/mp4') {
    // `ftyp` box with a video brand (sniffMime already excluded AVIF image brands).
    const brand = buf.toString('ascii', 8, 12);
    if (!/^(isom|iso\d|mp4\d|avc1|M4V |mmp4|dash|msnv|f4v |qt  )$/.test(brand)) return { ok: false, code: 'bad_type' };
  }
  if (kind === 'lottie') {
    try {
      if (!isLottieJson(JSON.parse(buf.toString('utf8')))) return { ok: false, code: 'bad_lottie' };
    } catch {
      return { ok: false, code: 'bad_lottie' };
    }
  }
  return { ok: true, mime };
}

/** Read a File from FormData into a Buffer (null when absent/empty). */
export async function fileToBuffer(file: FormDataEntryValue | null | undefined): Promise<Buffer | null> {
  if (!file || typeof file === 'string' || file.size === 0) return null;
  return Buffer.from(await file.arrayBuffer());
}

export type StoredImage = { key: string; width: number; height: number; keys: string[] };

/** Sibling key for a responsive size, e.g. `a/b/x.webp` → `a/b/x-480.avif`. */
export function sizedKey(key: string, width: number | null, ext: 'webp' | 'avif'): string {
  const base = key.replace(/\.[a-z0-9]+$/, '');
  return width ? `${base}-${width}.${ext}` : `${base}.${ext}`;
}

/**
 * Optimise an image with sharp and store it in the PUBLIC bucket:
 *   <key>.webp (main, ≤ maxWidth) + <key>.avif + <key>-<w>.webp/.avif for each smaller width.
 * Returns the main WebP key (stored in DB) and its dimensions. EXIF orientation applied,
 * metadata stripped.
 */
export async function storeOptimisedImage(
  buf: Buffer,
  prefix: string,
  opts: { maxWidth?: number; widths?: readonly number[] } = {},
): Promise<StoredImage> {
  const { default: sharp } = await import('sharp');
  const maxWidth = opts.maxWidth ?? 1600;
  let meta;
  try {
    meta = await sharp(buf, { limitInputPixels: 50_000_000 }).rotate().metadata();
  } catch {
    throw Object.assign(new Error('bad_image'), { code: 'bad_image' });
  }
  if (!meta.width || !meta.height) throw Object.assign(new Error('bad_image'), { code: 'bad_image' });
  // Orientation 5–8 swaps width/height after rotate().
  const swap = (meta.orientation ?? 1) >= 5;
  const srcW = swap ? meta.height : meta.width;
  const srcH = swap ? meta.width : meta.height;
  const mainW = Math.min(maxWidth, srcW);
  const mainH = Math.round((srcH * mainW) / srcW);

  const storage = getStorage();
  const key = buildKey(prefix, 'webp');
  const keys: string[] = [];
  const pipeline = (w: number) => sharp(buf, { limitInputPixels: 50_000_000 }).rotate().resize({ width: w, withoutEnlargement: true });

  const put = async (k: string, data: Buffer, type: string) => {
    await storage.put('public', k, data, { contentType: type });
    keys.push(k);
  };
  await put(key, await pipeline(mainW).webp({ quality: 82 }).toBuffer(), 'image/webp');
  await put(sizedKey(key, null, 'avif'), await pipeline(mainW).avif({ quality: 55 }).toBuffer(), 'image/avif');
  for (const w of opts.widths ?? [480, 960]) {
    if (w >= mainW) continue;
    await put(sizedKey(key, w, 'webp'), await pipeline(w).webp({ quality: 80 }).toBuffer(), 'image/webp');
    await put(sizedKey(key, w, 'avif'), await pipeline(w).avif({ quality: 52 }).toBuffer(), 'image/avif');
  }
  return { key, width: mainW, height: mainH, keys };
}

/** Store a validated video / Lottie file as-is in the public bucket. */
export async function storeRawMedia(buf: Buffer, prefix: string, mime: SniffedType): Promise<string> {
  const ext = mime === 'video/webm' ? 'webm' : mime === 'video/mp4' ? 'mp4' : 'json';
  const key = buildKey(prefix, ext);
  await getStorage().put('public', key, buf, { contentType: mime });
  return key;
}

/** Best-effort removal of an optimised image and its responsive siblings. */
export async function deleteImageFamily(key: string): Promise<void> {
  const storage = getStorage();
  const keys = new Set<string>([key, sizedKey(key, null, 'avif')]);
  for (const w of [480, 828, 960, 1280]) {
    keys.add(sizedKey(key, w, 'webp'));
    keys.add(sizedKey(key, w, 'avif'));
  }
  await Promise.all([...keys].map((k) => storage.delete('public', k).catch(() => undefined)));
}
