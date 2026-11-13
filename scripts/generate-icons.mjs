/**
 * DOOM | دوم — brand asset pipeline.
 *
 * Source of truth: brand-src/doom-logo-official.png — the approved yellow & navy logo (shopping-bag
 * "D" mark, "DOoM" wordmark, tagline «متجرك الإلكتروني للتقنية»), owner's specification of
 * November 2026. Earlier logos remain in the Git history.
 *
 * This script NEVER redraws or recolours the logo. It only:
 *   - crops regions of the original (mark, wordmark, full lock-up),
 *   - removes the off-white background (soft matte, original colours kept),
 *   - places the unaltered logo on a plate where the surface needs one (dark surfaces),
 *   - resizes with preserved aspect ratio and wraps rasters in SVG containers.
 *
 * A true vector master (.ai/.svg) from the logo designer should replace the SVG containers when
 * available.
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'brand-src/doom-logo-official.png');
const OUT = path.join(ROOT, 'public/brand');
const ICONS = path.join(ROOT, 'public/icons');
const SIZES = [32, 64, 128, 192, 256, 512, 1024];

const YELLOW = { r: 254, g: 226, b: 37 }; // #FEE225 — the mark's own ground
const CREAM = { r: 253, g: 250, b: 246 }; // #FDFAF6 — store background
const NAVY = { r: 10, g: 25, b: 55 }; // #0A1937

// Regions measured on the 1536×1024 official file (everything that is not background).
const MARK = { left: 103, top: 352, width: 340, height: 377 }; // yellow rounded square with the bag "D"
const LOCKUP = { left: 103, top: 352, width: 1331, height: 397 }; // mark + wordmark + tagline
const COMPACT = { left: 103, top: 352, width: 1331, height: 377 }; // mark + wordmark (tagline rows cleared)
const TAGLINE_FROM = { x: 455 - 103, y: 640 - 352 }; // inside COMPACT: rows below the wordmark, right of the mark

await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(ICONS, { recursive: true });
const srcMeta = await sharp(SRC).metadata();

/** Off-white background → transparent. Soft edge, original colours untouched. */
async function transparentOriginal() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = [data[0], data[1], data[2]]; // top-left pixel = background
  const out = Buffer.alloc(info.width * info.height * 4);
  const lo = 10;
  const hi = 46;
  for (let p = 0; p < info.width * info.height; p++) {
    const i = p * 3;
    const d = Math.max(Math.abs(data[i] - bg[0]), Math.abs(data[i + 1] - bg[1]), Math.abs(data[i + 2] - bg[2]));
    let a = d <= lo ? 0 : d >= hi ? 1 : (d - lo) / (hi - lo);
    a = a * a * (3 - 2 * a);
    const o = p * 4;
    out[o] = data[i];
    out[o + 1] = data[i + 1];
    out[o + 2] = data[i + 2];
    out[o + 3] = Math.round(a * 255);
  }
  return sharp(out, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

async function svgContainer(pngBuffer, file, title) {
  const meta = await sharp(pngBuffer).metadata();
  const webp = await sharp(pngBuffer).webp({ quality: 92, alphaQuality: 100 }).toBuffer();
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${meta.width} ${meta.height}" width="${meta.width}" height="${meta.height}" role="img" aria-label="${title}"><title>${title}</title><image width="${meta.width}" height="${meta.height}" preserveAspectRatio="xMidYMid meet" href="data:image/webp;base64,${webp.toString('base64')}"/></svg>\n`;
  await fs.writeFile(path.join(OUT, file), svg);
}

async function writeVariants(name, buffer, { widths = [], title }) {
  await fs.writeFile(path.join(OUT, `${name}.png`), await sharp(buffer).png({ compressionLevel: 9 }).toBuffer());
  await fs.writeFile(path.join(OUT, `${name}.webp`), await sharp(buffer).webp({ quality: 92, alphaQuality: 100 }).toBuffer());
  for (const w of widths) {
    await sharp(buffer).resize({ width: w, withoutEnlargement: true }).webp({ quality: 90, alphaQuality: 100 }).toFile(path.join(OUT, `${name}-${w}.webp`));
    await sharp(buffer).resize({ width: w, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}-${w}.png`));
  }
  await svgContainer(buffer, `${name}.svg`, title);
}

/** The unaltered logo on a rounded plate (for surfaces where the navy wordmark would not read). */
async function onPlate(input, pad, radius, colour) {
  const m = await sharp(input).metadata();
  const w = m.width + pad * 2;
  const h = m.height + pad * 2;
  const plate = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="${w}" height="${h}" rx="${radius}" fill="rgb(${colour.r},${colour.g},${colour.b})"/></svg>`);
  return sharp(plate).composite([{ input, left: pad, top: pad }]).png().toBuffer();
}

const transparent = await transparentOriginal();

// 1. Official file (byte copy) and the full lock-up (mark + wordmark + tagline).
await fs.copyFile(SRC, path.join(OUT, 'doom-logo-official.png'));
const lockup = await sharp(transparent).extract(LOCKUP).png().toBuffer();
await writeVariants('doom-logo-vertical-transparent', lockup, { widths: [256, 512, 1024], title: 'DOOM | دوم' });
const lockupOnCream = await onPlate(lockup, 80, 0, CREAM);
await writeVariants('doom-logo-vertical-light', lockupOnCream, { widths: [512], title: 'DOOM | دوم' });
// Square share image (Open Graph): the full lock-up centred on the store background.
const og = await sharp({ create: { width: 1024, height: 1024, channels: 3, background: CREAM } })
  .composite([{ input: await sharp(lockup).resize({ width: 840 }).png().toBuffer(), gravity: 'centre' }])
  .png()
  .toBuffer();
await writeVariants('doom-logo-vertical', og, { widths: [512, 1024], title: 'DOOM | دوم' });

// 2. Mark (the yellow rounded square with the bag "D"), on a square canvas.
const markRaw = await sharp(transparent).extract(MARK).png().toBuffer();
const side = Math.max(MARK.width, MARK.height);
const mark = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: markRaw, gravity: 'centre' }])
  .png()
  .toBuffer();
await writeVariants('doom-emblem-transparent', mark, { widths: [128, 256, 512], title: 'DOOM' });
await writeVariants('doom-emblem', await sharp(mark).flatten({ background: YELLOW }).png().toBuffer(), { widths: [256, 512], title: 'DOOM' });

// 3. Compact horizontal logo for headers: mark + wordmark exactly as placed in the original,
//    with the tagline rows cleared (the tagline is unreadable at header sizes).
const compactRaw = await sharp(transparent).extract(COMPACT).raw().toBuffer({ resolveWithObject: true });
for (let y = TAGLINE_FROM.y; y < compactRaw.info.height; y++) {
  for (let x = TAGLINE_FROM.x; x < compactRaw.info.width; x++) compactRaw.data[(y * compactRaw.info.width + x) * 4 + 3] = 0;
}
const compactFull = await sharp(compactRaw.data, { raw: { width: compactRaw.info.width, height: compactRaw.info.height, channels: 4 } }).png().toBuffer();
const wordmark = await sharp(compactFull).extract({ left: 469 - 103, top: 373 - 352, width: 1433 - 469 + 1, height: 625 - 373 + 1 }).png().toBuffer();
await writeVariants('doom-wordmark-transparent', wordmark, { widths: [512], title: 'DOOM | دوم' });
const horizontal = compactFull;
await writeVariants('doom-logo-horizontal-transparent', horizontal, { widths: [320, 640], title: 'DOOM | دوم' });
// Light surfaces: the same logo flattened on white (documents, PDF receipts).
await writeVariants('doom-logo-horizontal-light', await sharp(await onPlate(horizontal, 24, 0, { r: 255, g: 255, b: 255 })).png().toBuffer(), { widths: [640], title: 'DOOM | دوم' });
// Dark surfaces: the unaltered logo on an off-white plate (the navy wordmark needs a light ground).
await writeVariants('doom-logo-horizontal-dark', await onPlate(horizontal, 44, 56, CREAM), { widths: [640], title: 'DOOM | دوم' });

// 4. App / PWA / Android icons: the mark, full-bleed on its own yellow.
// The mark's soft outer edge blends towards the off-white page; on a yellow ground that would show as
// a faint ring, so for the icons every yellow-family pixel is set to the mark's exact yellow.
const iconRaw = await sharp(mark).raw().toBuffer({ resolveWithObject: true });
for (let i = 0; i < iconRaw.data.length; i += 4) {
  if (iconRaw.data[i] > 225 && iconRaw.data[i + 1] > 200) {
    iconRaw.data[i] = YELLOW.r;
    iconRaw.data[i + 1] = YELLOW.g;
    iconRaw.data[i + 2] = YELLOW.b;
  }
}
const iconMark = await sharp(iconRaw.data, { raw: { width: iconRaw.info.width, height: iconRaw.info.height, channels: 4 } }).png().toBuffer();
const squareIcon = async (size, { paddingRatio = 0 } = {}) => {
  const inner = Math.round(size * (1 - paddingRatio * 2));
  const art = await sharp(iconMark).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const off = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...YELLOW, alpha: 1 } } })
    .composite([{ input: art, left: off, top: off }])
    .png()
    .toBuffer();
};
for (const s of SIZES) {
  const buf = await squareIcon(s);
  await fs.writeFile(path.join(ICONS, `icon-${s}.png`), buf);
  await sharp(buf).webp({ quality: 90 }).toFile(path.join(ICONS, `icon-${s}.webp`));
  // Maskable: keep the bag within the 80% safe zone.
  await fs.writeFile(path.join(ICONS, `maskable-${s}.png`), await squareIcon(s, { paddingRatio: 0.1 }));
  await sharp(mark).resize(s, s).png().toFile(path.join(ICONS, `emblem-${s}.png`));
}
await fs.writeFile(path.join(ICONS, 'apple-touch-icon.png'), await squareIcon(180));
await fs.writeFile(
  path.join(ICONS, 'android-foreground-432.png'),
  await sharp({ create: { width: 432, height: 432, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: await sharp(mark).resize(270, 270).png().toBuffer(), left: 81, top: 81 }])
    .png()
    .toBuffer(),
);
await fs.writeFile(path.join(ICONS, 'android-background-432.png'), await sharp({ create: { width: 432, height: 432, channels: 3, background: YELLOW } }).png().toBuffer());

// Splash screen (PWA / Capacitor): the full lock-up centred on the store background.
for (const [w, h] of [[1284, 2778], [2732, 2732]]) {
  const logo = await sharp(lockup).resize({ width: Math.round(Math.min(w, h) * 0.6) }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  await sharp({ create: { width: w, height: h, channels: 3, background: CREAM } })
    .composite([{ input: logo, left: Math.round((w - lm.width) / 2), top: Math.round((h - lm.height) / 2) }])
    .png()
    .toFile(path.join(ICONS, `splash-${w}x${h}.png`));
}

// favicon.ico (PNG-encoded ICO with 32 and 64 px images).
const icoImgs = [await squareIcon(32), await squareIcon(64)];
const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); header.writeUInt16LE(1, 2); header.writeUInt16LE(icoImgs.length, 4);
let offset = 6 + 16 * icoImgs.length;
const entries = icoImgs.map((img, idx) => {
  const e = Buffer.alloc(16);
  const s = idx === 0 ? 32 : 64;
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(img.length, 8); e.writeUInt32LE(offset, 12);
  offset += img.length;
  return e;
});
await fs.writeFile(path.join(ROOT, 'public/favicon.ico'), Buffer.concat([header, ...entries, ...icoImgs]));
await fs.copyFile(path.join(ICONS, 'icon-32.png'), path.join(ROOT, 'public/favicon-32.png'));

void NAVY;
console.log(`Brand assets generated from ${srcMeta.width}×${srcMeta.height} official logo.`);
