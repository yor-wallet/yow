import { sniffMime } from '../storage';

/**
 * Image validation shared by KYC documents and delivery proofs.
 * Magic bytes only (never the client MIME). JPEG, PNG and WebP accepted; HEIC/HEIF is
 * detected explicitly and rejected with a dedicated code (browsers cannot display it
 * and the client converts camera captures to JPEG).
 */

export const IMAGE_MAX_BYTES = 8 * 1024 * 1024;
export const ALLOWED_IMAGE_MIME = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type AllowedImageMime = (typeof ALLOWED_IMAGE_MIME)[number];

export type ImageValidationError = 'empty' | 'too_large' | 'heic_unsupported' | 'unsupported_type';

const HEIC_BRANDS = new Set(['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1', 'avci']);

/** ISO-BMFF container with a HEIF/HEIC brand. */
export function isHeic(buf: Buffer): boolean {
  if (buf.length < 12 || buf.toString('ascii', 4, 8) !== 'ftyp') return false;
  const major = buf.toString('ascii', 8, 12);
  if (HEIC_BRANDS.has(major)) return true;
  // Compatible brands list (after minor version) — some files use a generic major brand.
  const boxSize = buf.readUInt32BE(0);
  const end = Math.min(boxSize, buf.length, 64);
  for (let i = 16; i + 4 <= end; i += 4) {
    const brand = buf.toString('ascii', i, i + 4);
    if (brand === 'heic' || brand === 'heix' || brand === 'hevc') return true;
  }
  return false;
}

export function validateImage(
  buf: Buffer,
  maxBytes = IMAGE_MAX_BYTES,
): { ok: true; mime: AllowedImageMime } | { ok: false; code: ImageValidationError } {
  if (!buf || buf.length === 0) return { ok: false, code: 'empty' };
  if (buf.length > maxBytes) return { ok: false, code: 'too_large' };
  if (isHeic(buf)) return { ok: false, code: 'heic_unsupported' };
  const mime = sniffMime(buf);
  if (mime === 'image/jpeg' || mime === 'image/png' || mime === 'image/webp') return { ok: true, mime };
  return { ok: false, code: 'unsupported_type' };
}
