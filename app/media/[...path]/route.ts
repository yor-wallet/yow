import { promises as fs } from 'node:fs';
import path from 'node:path';
import { assertSafeKey, MIME_BY_EXT } from '@/lib/storage';

/**
 * Serves PUBLIC uploads of the local storage driver (`public/uploads/<key>`) at
 * `/media/<key>`. Needed because `next start` only serves files that existed in
 * /public at build time. Private files are never reachable here.
 */
const ROOT = path.join(process.cwd(), 'public', 'uploads');

export async function GET(_req: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path: parts } = await ctx.params;
  const key = parts.join('/');
  try {
    assertSafeKey(key);
  } catch {
    return new Response('Not found', { status: 404 });
  }
  const ext = key.split('.').pop() ?? '';
  const type = MIME_BY_EXT[ext];
  // SVG is not served from user uploads (script injection risk).
  if (!type || ext === 'svg') return new Response('Not found', { status: 404 });
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
  try {
    const data = await fs.readFile(full);
    return new Response(new Uint8Array(data), {
      headers: {
        'Content-Type': type,
        'Content-Length': String(data.length),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'",
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
}
