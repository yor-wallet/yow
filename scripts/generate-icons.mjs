/**
 * DOOM | دوم — brand asset pipeline.
 *
 * Source of truth: brand-src/doom-logo-official.png (the validated official logo).
 * This script NEVER redraws or recolors the logo. It only:
 *   - crops regions of the original (emblem, wordmark),
 *   - re-arranges those original crops (horizontal lock-up),
 *   - removes the dark background (color-to-alpha against the measured background),
 *   - resizes with preserved aspect ratio,
 *   - wraps rasters in SVG containers (an SVG with the embedded original raster).
 *
 * A true vector master (.ai/.svg) from the logo designer should replace the SVG
 * containers when available — see docs/BRAND.md.
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const SRC = path.join(ROOT, 'brand-src/doom-logo-official.png');
const OUT = path.join(ROOT, 'public/brand');
const ICONS = path.join(ROOT, 'public/icons');
const SIZES = [32, 64, 128, 192, 256, 512, 1024];
const BG = { r: 16, g: 5, b: 46 }; // #10052E violet nuit

// Regions measured on the 1254×1254 official file.
const EMBLEM = { left: 282, top: 20, width: 686, height: 686 };
const WORDMARK = { left: 130, top: 700, width: 1010, height: 390 };

await fs.mkdir(OUT, { recursive: true });
await fs.mkdir(ICONS, { recursive: true });

const srcMeta = await sharp(SRC).metadata();

/** Estimate the (smooth) background colour field of the original logo. */
async function backgroundField() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const cell = 32;
  const gw = Math.ceil(info.width / cell);
  const gh = Math.ceil(info.height / cell);
  const grid = Buffer.alloc(gw * gh * 3);
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const samples = [];
      for (let y = gy * cell; y < Math.min(info.height, (gy + 1) * cell); y += 2) {
        for (let x = gx * cell; x < Math.min(info.width, (gx + 1) * cell); x += 2) {
          const i = (y * info.width + x) * 3;
          samples.push([data[i], data[i + 1], data[i + 2], data[i] + data[i + 1] + data[i + 2]]);
        }
      }
      samples.sort((a, b) => a[3] - b[3]);
      const s = samples[Math.floor(samples.length * 0.1)];
      const o = (gy * gw + gx) * 3;
      grid[o] = s[0]; grid[o + 1] = s[1]; grid[o + 2] = s[2];
    }
  }
  // Smooth (median-ish via blur) and upscale to full size.
  return sharp(grid, { raw: { width: gw, height: gh, channels: 3 } })
    .blur(1.2)
    .resize(info.width, info.height, { kernel: 'cubic' })
    .raw()
    .toBuffer();
}

/** GIMP-style colour-to-alpha against a per-pixel background field. */
async function transparentOriginal() {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const bg = await backgroundField();
  const out = Buffer.alloc(info.width * info.height * 4);
  for (let p = 0; p < info.width * info.height; p++) {
    const i = p * 3;
    let a = 0;
    for (let c = 0; c < 3; c++) {
      const v = data[i + c];
      const b = bg[i + c];
      const ac = v > b ? (v - b) / (255 - b || 1) : v < b ? (b - v) / (b || 1) : 0;
      if (ac > a) a = ac;
    }
    // Suppress compression noise of the background gradient (soft knee keeps glows).
    const lo = 0.1, hi = 0.28;
    if (a <= lo) a = 0;
    else if (a < hi) { const t = (a - lo) / (hi - lo); a = hi * t * t * (3 - 2 * t); }
    const o = p * 4;
    if (a > 0) {
      for (let c = 0; c < 3; c++) {
        const fg = (data[i + c] - (1 - a) * bg[i + c]) / a;
        out[o + c] = Math.max(0, Math.min(255, Math.round(fg)));
      }
    }
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
  await fs.writeFile(path.join(OUT, `${name}.webp`), await sharp(buffer).webp({ quality: 90, alphaQuality: 100 }).toBuffer());
  for (const w of widths) {
    await sharp(buffer).resize({ width: w, withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 100 }).toFile(path.join(OUT, `${name}-${w}.webp`));
    await sharp(buffer).resize({ width: w, withoutEnlargement: true }).png({ compressionLevel: 9 }).toFile(path.join(OUT, `${name}-${w}.png`));
  }
  await svgContainer(buffer, `${name}.svg`, title);
}

const transparent = await transparentOriginal();
const trimmedTransparent = await sharp(transparent).trim({ threshold: 1 }).png().toBuffer();

// 1. Official (vertical, original background) — byte copy + derived formats.
await fs.copyFile(SRC, path.join(OUT, 'doom-logo-official.png'));
await writeVariants('doom-logo-vertical', await sharp(SRC).png().toBuffer(), { widths: [512, 1024], title: 'DOOM | دوم' });

// 2. Vertical, transparent background.
await writeVariants('doom-logo-vertical-transparent', trimmedTransparent, { widths: [256, 512, 1024], title: 'DOOM | دوم' });

// 3. Emblem (square icon), original background and transparent.
const emblemDark = await sharp(SRC).extract(EMBLEM).png().toBuffer();
const emblemTransparent = await sharp(transparent).extract(EMBLEM).png().toBuffer();
await writeVariants('doom-emblem', emblemDark, { widths: [256, 512], title: 'DOOM' });
await writeVariants('doom-emblem-transparent', emblemTransparent, { widths: [128, 256, 512], title: 'DOOM' });

// 4. Wordmark (DOOM + دوم + tagline), transparent.
const wordmark = await sharp(transparent).extract(WORDMARK).trim({ threshold: 1 }).png().toBuffer();
await writeVariants('doom-wordmark-transparent', wordmark, { widths: [512], title: 'DOOM | دوم' });

// 5. Horizontal lock-up: original emblem crop + original wordmark crop, side by side.
const H = 400;
const emb = await sharp(emblemTransparent).resize({ height: H }).png().toBuffer();
const wmResized = await sharp(wordmark).resize({ height: Math.round(H * 0.62) }).png().toBuffer();
const wmMeta = await sharp(wmResized).metadata();
const gap = 36;
const horizontal = await sharp({
  create: { width: H + gap + wmMeta.width, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
})
  .composite([
    { input: emb, left: 0, top: 0 },
    { input: wmResized, left: H + gap, top: Math.round((H - wmMeta.height) / 2) },
  ])
  .png()
  .toBuffer();
await writeVariants('doom-logo-horizontal-transparent', horizontal, { widths: [320, 640], title: 'DOOM | دوم' });

// 6. Dark version = transparent lock-up on violet nuit. Light version = the same
//    unaltered lock-up inside a violet-nuit badge (the white wordmark of the official
//    logo must not be recoloured, so on light surfaces it sits on its brand plate).
async function onPlate(input, pad, radius) {
  const m = await sharp(input).metadata();
  const w = m.width + pad * 2;
  const h = m.height + pad * 2;
  const plate = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#10052E"/><stop offset="1" stop-color="#190B45"/></linearGradient></defs><rect width="${w}" height="${h}" rx="${radius}" fill="url(#g)"/></svg>`,
  );
  return sharp(plate).composite([{ input, left: pad, top: pad }]).png().toBuffer();
}
await writeVariants('doom-logo-horizontal-dark', await sharp(horizontal).flatten({ background: BG }).png().toBuffer(), { widths: [640], title: 'DOOM | دوم' });
await writeVariants('doom-logo-horizontal-light', await onPlate(horizontal, 28, 36), { widths: [640], title: 'DOOM | دوم' });
await writeVariants('doom-logo-vertical-light', await onPlate(await sharp(trimmedTransparent).resize({ width: 900 }).png().toBuffer(), 60, 72), { widths: [512], title: 'DOOM | دوم' });

// 7. App / PWA / Android icons from the emblem (square, original background).
const squareIcon = async (size, { paddingRatio = 0 } = {}) => {
  const inner = Math.round(size * (1 - paddingRatio * 2));
  const art = await sharp(emblemTransparent).resize(inner, inner, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();
  const off = Math.round((size - inner) / 2);
  return sharp({ create: { width: size, height: size, channels: 4, background: { ...BG, alpha: 1 } } })
    .composite([{ input: art, left: off, top: off }])
    .png()
    .toBuffer();
};
for (const s of SIZES) {
  const buf = await squareIcon(s, { paddingRatio: 0.04 });
  await fs.writeFile(path.join(ICONS, `icon-${s}.png`), buf);
  await sharp(buf).webp({ quality: 90 }).toFile(path.join(ICONS, `icon-${s}.webp`));
  // Maskable: keep the emblem within the 80% safe zone.
  const mask = await squareIcon(s, { paddingRatio: 0.14 });
  await fs.writeFile(path.join(ICONS, `maskable-${s}.png`), mask);
  // Transparent emblem icon.
  await sharp(emblemTransparent).resize(s, s).png().toFile(path.join(ICONS, `emblem-${s}.png`));
}
await fs.writeFile(path.join(ICONS, 'apple-touch-icon.png'), await squareIcon(180, { paddingRatio: 0.06 }));
// Android adaptive icon layers (foreground within 66% safe zone, solid background).
await fs.writeFile(path.join(ICONS, 'android-foreground-432.png'), await sharp({ create: { width: 432, height: 432, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite([{ input: await sharp(emblemTransparent).resize(270, 270).png().toBuffer(), left: 81, top: 81 }]).png().toBuffer());
await fs.writeFile(path.join(ICONS, 'android-background-432.png'), await sharp({ create: { width: 432, height: 432, channels: 3, background: BG } }).png().toBuffer());

// Splash screen (PWA / Capacitor): official vertical logo centred on violet nuit.
for (const [w, h] of [[1284, 2778], [2732, 2732]]) {
  const logo = await sharp(trimmedTransparent).resize({ width: Math.round(Math.min(w, h) * 0.5) }).png().toBuffer();
  const lm = await sharp(logo).metadata();
  await sharp({ create: { width: w, height: h, channels: 3, background: BG } })
    .composite([{ input: logo, left: Math.round((w - lm.width) / 2), top: Math.round((h - lm.height) / 2) }])
    .png()
    .toFile(path.join(ICONS, `splash-${w}x${h}.png`));
}

// favicon.ico (PNG-encoded ICO with 32 and 64 px images).
const icoImgs = [await squareIcon(32, { paddingRatio: 0.02 }), await squareIcon(64, { paddingRatio: 0.02 })];
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

console.log(`Brand assets generated from ${srcMeta.width}×${srcMeta.height} official logo.`);
