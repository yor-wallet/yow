import { useId } from 'react';
import { cn } from '@/lib/cn';
import type { DeviceArtSpec } from '@/lib/devices/art';

/**
 * Original SVG illustration of a smartphone (rear view tinted with the variant colour, front view
 * with a screen), or of an open foldable. Pure markup: server- and client-safe, no images to load,
 * no layout shift (fixed viewBox). `title` becomes the accessible name — pass an "Illustration — …" text.
 */

const INK = '#12101c';
const RING = '#2b2a38';

/** Darker / lighter variants of the body colour (for edges and highlights). */
const edge = (hex: string) => `color-mix(in srgb, ${hex} 72%, #000)`;

function Lens({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g>
      <circle cx={cx} cy={cy} r={r + 1.6} fill={RING} />
      <circle cx={cx} cy={cy} r={r} fill={INK} />
      <circle cx={cx} cy={cy} r={r * 0.55} fill="#1d2a52" />
      <circle cx={cx - r * 0.3} cy={cy - r * 0.32} r={r * 0.18} fill="#fff" fillOpacity="0.75" />
    </g>
  );
}

/** Camera module, placed in the rear phone whose top-left corner is (x, y), width w. */
function Cameras({ spec, x, y, w }: { spec: DeviceArtSpec; x: number; y: number; w: number }) {
  const n = spec.cameras;
  if (spec.style === 'apple') {
    const side = n === 1 ? 26 : n === 2 ? 34 : 42;
    const h = n === 1 ? 26 : n === 2 ? 36 : 42;
    const mx = x + 7;
    const my = y + 7;
    const pts: [number, number][] = n === 1 ? [[mx + 13, my + 13]] : n === 2 ? [[mx + 11, my + 11], [mx + 11, my + 26]] : [[mx + 11, my + 11], [mx + 11, my + 31], [mx + 30, my + 21]];
    return (
      <g>
        <rect x={mx} y={my} width={side} height={h} rx={9} fill={`color-mix(in srgb, ${spec.hex} 80%, #000)`} />
        <rect x={mx} y={my} width={side} height={h} rx={9} fill="#fff" fillOpacity="0.1" />
        {pts.map(([cx, cy], i) => (
          <Lens key={i} cx={cx} cy={cy} r={n === 1 ? 7.5 : 6.4} />
        ))}
        {n > 1 ? <circle cx={mx + side - 6} cy={my + 6} r={2.2} fill="#f4f2d8" /> : null}
      </g>
    );
  }
  if (spec.style === 'samsung') {
    const ys = Array.from({ length: n }, (_, i) => y + 16 + i * 17);
    return (
      <g>
        {ys.map((cy, i) => (
          <Lens key={i} cx={x + 17} cy={cy} r={5.4} />
        ))}
        <circle cx={x + 33} cy={y + 14} r={2} fill="#f4f2d8" />
      </g>
    );
  }
  if (spec.style === 'honor' || spec.style === 'oppo') {
    const cx = spec.style === 'oppo' ? x + w / 2 : x + 27;
    const cy = y + 30;
    return (
      <g>
        <circle cx={cx} cy={cy} r={22} fill={`color-mix(in srgb, ${spec.hex} 70%, #000)`} />
        <circle cx={cx} cy={cy} r={22} fill="none" stroke="#fff" strokeOpacity="0.28" strokeWidth="1.4" />
        {(n === 3 ? [[cx - 8, cy - 7], [cx + 8, cy - 7], [cx, cy + 9]] : [[cx - 8, cy - 4], [cx + 8, cy + 6]]).map(([lx, ly], i) => (
          <Lens key={i} cx={lx!} cy={ly!} r={6} />
        ))}
      </g>
    );
  }
  return (
    <g>
      <rect x={x + 8} y={y + 8} width={w - 16} height={26} rx={13} fill={`color-mix(in srgb, ${spec.hex} 75%, #000)`} />
      {Array.from({ length: n }, (_, i) => (
        <Lens key={i} cx={x + 22 + i * 18} cy={y + 21} r={6} />
      ))}
    </g>
  );
}

export function DeviceArt({ art, title, className }: { art: DeviceArtSpec; title: string; className?: string }) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const g = (n: string) => `${n}${uid}`;

  const defs = (
    <defs>
      <linearGradient id={g('sheen')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#fff" stopOpacity="0.38" />
        <stop offset="0.45" stopColor="#fff" stopOpacity="0" />
        <stop offset="1" stopColor="#000" stopOpacity="0.22" />
      </linearGradient>
      <linearGradient id={g('screen')} x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#0a1937" />
        <stop offset="0.55" stopColor="#12254d" />
        <stop offset="1" stopColor="#27407a" stopOpacity="0.85" />
      </linearGradient>
      <radialGradient id={g('glow')} cx="0.5" cy="0.62" r="0.55">
        <stop offset="0" stopColor="#fee225" stopOpacity="0.55" />
        <stop offset="1" stopColor="#fee225" stopOpacity="0" />
      </radialGradient>
      <radialGradient id={g('shadow')} cx="0.5" cy="0.5" r="0.5">
        <stop offset="0" stopColor="#000" stopOpacity="0.28" />
        <stop offset="1" stopColor="#000" stopOpacity="0" />
      </radialGradient>
    </defs>
  );

  if (art.kind === 'foldable') {
    const px = 28;
    const py = 50;
    const pw = 144;
    const ph = 130;
    return (
      <svg viewBox="0 0 200 240" role="img" aria-label={title} className={cn('block h-full w-full', className)} data-device-art="foldable">
        <title>{title}</title>
        {defs}
        <ellipse cx="100" cy="206" rx="70" ry="9" fill={`url(#${g('shadow')})`} />
        {/* open: body in the variant colour, big inner screen */}
        <rect x={px - 4} y={py - 4} width={pw + 8} height={ph + 8} rx={14} style={{ fill: art.hex, stroke: edge(art.hex) }} strokeWidth="1.2" />
        <rect x={px - 4} y={py - 4} width={pw + 8} height={ph + 8} rx={14} fill={`url(#${g('sheen')})`} />
        <rect x={px + 2} y={py + 2} width={pw - 4} height={ph - 4} rx={10} fill={`url(#${g('screen')})`} />
        <ellipse cx={px + pw / 2} cy={py + ph * 0.68} rx={pw * 0.34} ry={ph * 0.24} fill={`url(#${g('glow')})`} />
        <rect x={px + pw / 2 - 1.1} y={py + 2} width={2.2} height={ph - 4} fill="#000" fillOpacity="0.45" />
        <rect x={px + pw / 2 - 0.4} y={py + 2} width={0.8} height={ph - 4} fill="#fff" fillOpacity="0.16" />
        <circle cx={px + pw - 14} cy={py + 12} r={2.6} fill={INK} />
        {/* the same device closed, rear view, in front */}
        <g transform="translate(112 112)">
          <rect x={0} y={0} width={64} height={94} rx={12} style={{ fill: art.hex, stroke: edge(art.hex) }} strokeWidth="1.2" />
          <rect x={0} y={0} width={64} height={94} rx={12} fill={`url(#${g('sheen')})`} />
          <Cameras spec={art} x={0} y={0} w={64} />
        </g>
      </svg>
    );
  }

  // Rear phone (left) behind a front phone (right).
  const bx = 24;
  const by = 22;
  const bw = 88;
  const bh = 176;
  const fx = 84;
  const fy = 40;
  return (
    <svg viewBox="0 0 200 240" role="img" aria-label={title} className={cn('block h-full w-full', className)} data-device-art="phone">
      <title>{title}</title>
      {defs}
      <ellipse cx="100" cy="214" rx="74" ry="9" fill={`url(#${g('shadow')})`} />
      <rect x={bx} y={by} width={bw} height={bh} rx={17} style={{ fill: art.hex, stroke: edge(art.hex) }} strokeWidth="1.2" />
      <rect x={bx} y={by} width={bw} height={bh} rx={17} fill={`url(#${g('sheen')})`} />
      <Cameras spec={art} x={bx} y={by} w={bw} />
      <g>
        <rect x={fx} y={fy} width={bw} height={bh} rx={17} style={{ fill: art.hex, stroke: edge(art.hex) }} strokeWidth="1.2" />
        <rect x={fx + 3.5} y={fy + 3.5} width={bw - 7} height={bh - 7} rx={13.5} fill={INK} />
        <rect x={fx + 6} y={fy + 6} width={bw - 12} height={bh - 12} rx={11.5} fill={`url(#${g('screen')})`} />
        <ellipse cx={fx + bw / 2} cy={fy + bh * 0.66} rx={bw * 0.34} ry={bh * 0.2} fill={`url(#${g('glow')})`} />
        {art.style === 'apple' ? (
          <rect x={fx + bw / 2 - 11} y={fy + 11} width={22} height={6.5} rx={3.25} fill={INK} />
        ) : (
          <circle cx={fx + bw / 2} cy={fy + 13} r={2.6} fill={INK} />
        )}
        <rect x={fx + bw / 2 - 14} y={fy + bh - 13} width={28} height={2.4} rx={1.2} fill="#fff" fillOpacity="0.55" />
        <rect x={fx} y={fy} width={bw} height={bh} rx={17} fill={`url(#${g('sheen')})`} fillOpacity="0.5" />
      </g>
    </svg>
  );
}
