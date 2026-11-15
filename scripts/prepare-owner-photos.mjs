/**
 * DOOM | دوم — owner photo pipeline.
 *
 *   npm run catalogue:photos:prepare                       # builds every missing WebP of the pack
 *   npm run catalogue:photos:prepare -- --force <finish>   # rebuilds one finish from its original
 *   npm run catalogue:photos:prepare -- --pack <key>       # another pack (default doom-photos-2026-11)
 *
 * Then `npm run catalogue:photos:build` writes the copies served by the site (public/photos).
 *
 * Source of truth: data/catalogue/<pack>/originals/<finish id>.jpg — the files supplied by the owner,
 * kept untouched. For each finish listed in catalogue.json the script writes
 * images/webp/<model id>/<finish id>.webp:
 *   - cropped on the product, centred on a square white canvas with a margin;
 *   - the photo's own background (plain or lightly graded, connected to the edges) is brought to white;
 *     pixels of the product are not modified, soft shadows are kept. When the product cannot be told
 *     from its backdrop pixel by pixel (white on off-white), the backdrop is kept and only fades to
 *     white along the edges of the photo;
 *   - never enlarged; at most 960 px.
 * The product itself is never redrawn, recoloured or sharpened.
 */
import sharp from 'sharp';
import fs from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const args = process.argv.slice(2);
const opt = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const PACK = opt('--pack') ?? 'doom-photos-2026-11';
const FORCE = opt('--force');
const DIR = path.join(ROOT, 'data', 'catalogue', PACK);

const INSET = 2; // edge rows/columns ignored (screenshots often carry a 1 px line there)
const T_LOW = 6; // closer than this to the background: background
const T_HIGH = 20; // farther than this: product (or a real shadow), left as it is
const T_BOX = 7; // what counts as product when measuring its bounding box (low: white products on white)
const MARGIN = 1.1; // canvas side = longest side of the product × MARGIN
const MAX_SIDE = 960;
const CELL = 32; // grid of the local background estimate
const SOFT_RATIO = 0.08; // share of unclear backdrop pixels above which the backdrop is kept (see `soft`)
const FEATHER = 28; // px over which a kept backdrop fades to white along the edges of the photo

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const median = (values) => {
  const s = Uint8Array.from(values).sort();
  return s[s.length >> 1];
};

export async function prepare(srcFile) {
  const { data, info } = await sharp(srcFile).rotate().flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width;
  const H = info.height;
  const at = (x, y) => (y * W + x) * 3;
  const inFrame = (x, y) => x < INSET || y < INSET || x >= W - INSET || y >= H - INSET;

  // 1. Background colour: median of a thin frame just inside the ignored edge.
  const frame = [[], [], []];
  for (let y = INSET; y < H - INSET; y++) {
    for (let x = INSET; x < W - INSET; x++) {
      if (x >= INSET + 4 && x < W - INSET - 4 && y >= INSET + 4 && y < H - INSET - 4) {
        x = W - INSET - 5; // jump over the inside of the picture
        continue;
      }
      const i = at(x, y);
      frame[0].push(data[i]);
      frame[1].push(data[i + 1]);
      frame[2].push(data[i + 2]);
    }
  }
  const bg = frame.map(median);
  const distTo = (i, c) => Math.max(Math.abs(data[i] - c[0]), Math.abs(data[i + 1] - c[1]), Math.abs(data[i + 2] - c[2]));

  // 2. Background region: pixels close to the background colour AND connected to the edges.
  const connected = new Uint8Array(W * H);
  const queue = new Int32Array(W * H);
  let head = 0;
  let tail = 0;
  const push = (x, y) => {
    const p = y * W + x;
    if (connected[p] || distTo(p * 3, bg) > T_HIGH) return;
    connected[p] = 1;
    queue[tail++] = p;
  };
  for (let x = INSET; x < W - INSET; x++) {
    push(x, INSET);
    push(x, H - INSET - 1);
  }
  for (let y = INSET; y < H - INSET; y++) {
    push(INSET, y);
    push(W - INSET - 1, y);
  }
  while (head < tail) {
    const p = queue[head++];
    const x = p % W;
    const y = (p - x) / W;
    if (x > INSET) push(x - 1, y);
    if (x < W - INSET - 1) push(x + 1, y);
    if (y > INSET) push(x, y - 1);
    if (y < H - INSET - 1) push(x, y + 1);
  }

  // 3. Local background (handles a lightly graded backdrop): mean of the background pixels per cell,
  //    empty cells filled from their neighbours, then read with bilinear interpolation.
  const gw = Math.ceil(W / CELL);
  const gh = Math.ceil(H / CELL);
  const grid = new Float64Array(gw * gh * 3);
  const count = new Float64Array(gw * gh);
  for (let y = INSET; y < H - INSET; y++) {
    for (let x = INSET; x < W - INSET; x++) {
      const p = y * W + x;
      if (!connected[p] || distTo(p * 3, bg) > 12) continue;
      const g = Math.floor(y / CELL) * gw + Math.floor(x / CELL);
      grid[g * 3] += data[p * 3];
      grid[g * 3 + 1] += data[p * 3 + 1];
      grid[g * 3 + 2] += data[p * 3 + 2];
      count[g]++;
    }
  }
  const known = new Uint8Array(gw * gh);
  for (let g = 0; g < gw * gh; g++) {
    if (count[g] >= CELL) {
      for (let c = 0; c < 3; c++) grid[g * 3 + c] /= count[g];
      known[g] = 1;
    }
  }
  for (let pass = 0; pass < gw + gh && known.includes(0); pass++) {
    const next = known.slice();
    for (let gy = 0; gy < gh; gy++) {
      for (let gx = 0; gx < gw; gx++) {
        const g = gy * gw + gx;
        if (known[g]) continue;
        const sum = [0, 0, 0];
        let n = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = gx + dx;
          const ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= gw || ny >= gh || !known[ny * gw + nx]) continue;
          for (let c = 0; c < 3; c++) sum[c] += grid[(ny * gw + nx) * 3 + c];
          n++;
        }
        if (n) {
          for (let c = 0; c < 3; c++) grid[g * 3 + c] = sum[c] / n;
          next[g] = 1;
        }
      }
    }
    known.set(next);
  }
  if (!known.includes(1)) for (let g = 0; g < gw * gh; g++) for (let c = 0; c < 3; c++) grid[g * 3 + c] = bg[c];
  const localBg = (x, y) => {
    const fx = Math.min(gw - 1, Math.max(0, (x + 0.5) / CELL - 0.5));
    const fy = Math.min(gh - 1, Math.max(0, (y + 0.5) / CELL - 0.5));
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const x1 = Math.min(gw - 1, x0 + 1);
    const y1 = Math.min(gh - 1, y0 + 1);
    const tx = fx - x0;
    const ty = fy - y0;
    const out = [0, 0, 0];
    for (let c = 0; c < 3; c++) {
      const top = grid[(y0 * gw + x0) * 3 + c] * (1 - tx) + grid[(y0 * gw + x1) * 3 + c] * tx;
      const bottom = grid[(y1 * gw + x0) * 3 + c] * (1 - tx) + grid[(y1 * gw + x1) * 3 + c] * tx;
      out[c] = top * (1 - ty) + bottom * ty;
    }
    return out;
  };

  // 4. How far each pixel is from the background behind it, and how clean the separation is.
  const dist = new Uint8Array(W * H);
  let backdrop = 0;
  let unclear = 0;
  for (let y = INSET; y < H - INSET; y++) {
    for (let x = INSET; x < W - INSET; x++) {
      const p = y * W + x;
      const d = Math.min(255, Math.round(distTo(p * 3, localBg(x, y))));
      dist[p] = d;
      if (connected[p]) {
        backdrop++;
        if (d > T_LOW) unclear++;
      }
    }
  }
  // A white product on an off-white backdrop (or one resting on a wide soft shadow) cannot be told from
  // its background pixel by pixel: whitening would eat into the product. Such a photo keeps its backdrop
  // and only fades to white along its own edges, so that it joins the white canvas without a seam.
  const soft = backdrop > 0 && unclear / backdrop > SOFT_RATIO;

  // 5. Bring the background to white (product pixels untouched) and measure the product.
  const out = Buffer.from(data);
  const rows = new Int32Array(H);
  const cols = new Int32Array(W);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = at(x, y);
      if (inFrame(x, y)) {
        out[i] = out[i + 1] = out[i + 2] = 255;
        continue;
      }
      const p = y * W + x;
      const d = dist[p];
      let lift = 0;
      if (soft) {
        const toEdge = Math.min(x - INSET, y - INSET, W - 1 - INSET - x, H - 1 - INSET - y);
        lift = (1 - smooth(0, FEATHER, toEdge)) * (1 - smooth(T_HIGH, 2 * T_HIGH, d));
      } else if (connected[p]) {
        lift = 1 - smooth(T_LOW, T_HIGH, d);
      }
      if (lift > 0) {
        const local = localBg(x, y);
        for (let c = 0; c < 3; c++) out[i + c] = Math.min(255, Math.round(data[i + c] + (255 - local[c]) * lift));
      }
      if (d > T_BOX) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  // A row / column belongs to the product when it and its neighbour both hold a few product pixels (ignores specks).
  const hit = (a, i) => a[i] >= 3 && (a[i + 1] ?? 0) >= 3;
  const first = (a) => a.findIndex((_, i) => hit(a, i));
  const last = (a) => {
    for (let i = a.length - 1; i > 0; i--) if (a[i] >= 3 && a[i - 1] >= 3) return i;
    return -1;
  };
  const box = { x0: first(cols), x1: last(cols), y0: first(rows), y1: last(rows) };
  if (box.x0 < 0 || box.y0 < 0) throw new Error(`No product found in ${srcFile}`);

  // 6. Square white canvas centred on the product, native pixels, at most MAX_SIDE.
  const bw = box.x1 - box.x0 + 1;
  const bh = box.y1 - box.y0 + 1;
  const side = Math.round(Math.max(bw, bh) * MARGIN);
  const left = Math.round((box.x0 + box.x1 + 1) / 2 - side / 2);
  const top = Math.round((box.y0 + box.y1 + 1) / 2 - side / 2);
  const canvas = Buffer.alloc(side * side * 3, 255);
  for (let y = Math.max(0, top); y < Math.min(H, top + side); y++) {
    const from = at(Math.max(0, left), y);
    const to = at(Math.min(W, left + side), y);
    out.copy(canvas, ((y - top) * side + (Math.max(0, left) - left)) * 3, from, to);
  }
  let image = sharp(canvas, { raw: { width: side, height: side, channels: 3 } });
  if (side > MAX_SIDE) image = image.resize(MAX_SIDE, MAX_SIDE, { kernel: 'lanczos3' });
  return {
    buffer: await image.webp({ quality: 90, effort: 6 }).toBuffer(),
    side: Math.min(side, MAX_SIDE),
    background: bg,
    soft,
    product: { width: bw, height: bh },
    touchesEdge: box.x0 <= INSET + 1 || box.y0 <= INSET + 1 || box.x1 >= W - INSET - 2 || box.y1 >= H - INSET - 2,
  };
}

async function main() {
  const pack = JSON.parse(await fs.readFile(path.join(DIR, 'catalogue.json'), 'utf8'));
  let built = 0;
  for (const model of pack.models) {
    for (const finish of model.variants) {
      const target = path.join(DIR, finish.webp);
      const exists = await fs.access(target).then(() => true, () => false);
      if (exists && FORCE !== finish.id) continue;
      const source = path.join(DIR, 'originals', `${finish.id}.jpg`);
      const res = await prepare(source);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, res.buffer);
      built++;
      console.log(`${finish.id}: ${res.side}×${res.side} px, ${Math.round(res.buffer.length / 1024)} KB, background rgb(${res.background.join(', ')})${res.soft ? ' — backdrop kept (soft edges)' : ''}${res.touchesEdge ? ' — the product touches the edge of the original' : ''}`);
    }
  }
  console.log(built ? `${built} image(s) written.` : 'Nothing to do: every finish already has its WebP.');
}

if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) await main();
