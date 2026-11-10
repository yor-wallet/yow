'use client';

/**
 * Client-side photo preparation: decode, downscale (≤ maxDimension) and re-encode as
 * JPEG. Re-encoding strips EXIF metadata (incl. GPS). HEIC/HEIF is rejected up front
 * (most browsers cannot decode it).
 */
export type PreparedImage = { blob: Blob; url: string; width: number; height: number };
export type PrepareError = 'heic_unsupported' | 'unsupported_type' | 'too_large' | 'image_unreadable' | 'empty';

export function isHeicFile(file: File): boolean {
  return /hei[cf]/i.test(file.type) || /\.(heic|heif)$/i.test(file.name);
}

export async function prepareImage(
  file: File,
  opts: { maxDimension?: number; maxInputBytes?: number; maxOutputBytes?: number; quality?: number } = {},
): Promise<PreparedImage> {
  const { maxDimension = 2000, maxInputBytes = 25 * 1024 * 1024, maxOutputBytes = 8 * 1024 * 1024, quality = 0.85 } = opts;
  if (file.size === 0) throw new Error('empty' satisfies PrepareError);
  if (isHeicFile(file)) throw new Error('heic_unsupported' satisfies PrepareError);
  if (file.type && !/^image\/(jpeg|png|webp)$/i.test(file.type)) throw new Error('unsupported_type' satisfies PrepareError);
  if (file.size > maxInputBytes) throw new Error('too_large' satisfies PrepareError);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('image_unreadable' satisfies PrepareError);
  }
  const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('image_unreadable' satisfies PrepareError);
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('image_unreadable' satisfies PrepareError);
  if (blob.size > maxOutputBytes) throw new Error('too_large' satisfies PrepareError);
  return { blob, url: URL.createObjectURL(blob), width, height };
}
