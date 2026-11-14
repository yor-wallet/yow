/**
 * Builds public/photos from the catalogue packs: for every finish, the main WebP (≤ 960 px), its AVIF and
 * the 480 px WebP/AVIF siblings that <ShopImage> asks for. Product photos then ship with the application and
 * are served from the site's own domain (see lib/bundled-photo.ts). Source photos are only cropped / resized.
 *
 *   node scripts/build-bundled-photos.mjs
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const PACKS = ['iphone-visuals-2026', 'doom-photos-2026-11'];
const out = path.resolve('public/photos');
let count = 0;

for (const pack of PACKS) {
  const root = path.resolve('data/catalogue', pack);
  const doc = JSON.parse((await fs.readFile(path.join(root, 'catalogue.json'), 'utf8')).replace(/^﻿/, ''));
  for (const model of doc.models) {
    const dir = path.join(out, pack, model.id);
    await fs.mkdir(dir, { recursive: true });
    for (const v of model.variants) {
      const src = path.join(root, v.webp);
      const meta = await sharp(src).metadata();
      const main = Math.min(960, meta.width);
      const resized = (w) => sharp(src).rotate().resize({ width: w, withoutEnlargement: true });
      await resized(main).webp({ quality: 82 }).toFile(path.join(dir, `${v.id}.webp`));
      await resized(main).avif({ quality: 55 }).toFile(path.join(dir, `${v.id}.avif`));
      if (480 < main) {
        await resized(480).webp({ quality: 80 }).toFile(path.join(dir, `${v.id}-480.webp`));
        await resized(480).avif({ quality: 52 }).toFile(path.join(dir, `${v.id}-480.avif`));
      }
      count++;
    }
  }
}
console.log(`[photos] ${count} photos → ${path.relative(process.cwd(), out)}`);
