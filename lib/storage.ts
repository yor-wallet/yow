import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomToken } from './crypto';

/**
 * File storage abstraction with two buckets:
 *   - `public`  : product images, campaign media. Served at `publicUrl(key)`.
 *   - `private` : KYC documents, delivery proofs, gift-card images. NEVER served
 *                 directly — only through authorised, audited route handlers.
 *                 Sensitive files must be encrypted (lib/crypto) BEFORE `put`.
 *
 * Drivers (env STORAGE_DRIVER):
 *   - `local` (default): public → `public/uploads/<key>` served by `app/media/[...path]`,
 *                        private → `storage/private/<key>` (gitignored).
 *                        NOTE: serverless hosts (Vercel) have an ephemeral FS — use a
 *                        remote driver in production.
 *   - `supabase`: Supabase Storage REST API (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 *                 SUPABASE_PUBLIC_BUCKET, SUPABASE_PRIVATE_BUCKET).
 *   - S3-compatible: implement `StorageDriver` (put/get/delete/exists/publicUrl) with
 *                 the AWS SDK and register it in `getStorage()`; nothing else changes.
 */

export type Bucket = 'public' | 'private';

export interface StorageDriver {
  readonly name: string;
  put(bucket: Bucket, key: string, data: Buffer, opts?: { contentType?: string }): Promise<{ key: string; size: number }>;
  /** Returns null when the object does not exist. */
  get(bucket: Bucket, key: string): Promise<Buffer | null>;
  delete(bucket: Bucket, key: string): Promise<void>;
  exists(bucket: Bucket, key: string): Promise<boolean>;
  /** Browser URL for a PUBLIC object. */
  publicUrl(key: string): string;
  /** Every object under `prefix` (recursive) with its last-modified time. Optional: used by the maintenance sweep only. */
  list?(bucket: Bucket, prefix: string): Promise<StoredObject[]>;
}

export type StoredObject = { key: string; updatedAt: Date };

/** Keys: lowercase segments of [a-z0-9._-] separated by `/`; no traversal, no leading slash. */
export function assertSafeKey(key: string): void {
  if (
    !key ||
    key.length > 512 ||
    key.startsWith('/') ||
    key.includes('\\') ||
    key.split('/').some((seg) => !seg || seg === '.' || seg === '..' || !/^[a-z0-9][a-z0-9._-]*$/.test(seg))
  ) {
    throw new Error(`Unsafe storage key: ${key}`);
  }
}

/** Build a unique key, e.g. `buildKey('products/abc', 'webp')` → `products/abc/2026/11/<random>.webp`. */
export function buildKey(prefix: string, ext: string): string {
  const now = new Date();
  const cleanPrefix = prefix.toLowerCase().replace(/[^a-z0-9/_-]/g, '-').replace(/^\/+|\/+$/g, '');
  const cleanExt = ext.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = `${cleanPrefix}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, '0')}/${randomBytes(16).toString('hex')}.${cleanExt}`;
  assertSafeKey(key);
  return key;
}

// ───────────── Content sniffing ─────────────

export type SniffedType =
  | 'image/png'
  | 'image/jpeg'
  | 'image/webp'
  | 'image/avif'
  | 'image/gif'
  | 'video/mp4'
  | 'video/webm'
  | 'application/pdf'
  | 'application/json';

/** Detect a file type from magic bytes (never trust the client-declared MIME). */
export function sniffMime(buf: Buffer): SniffedType | null {
  if (buf.length < 12) return buf.length > 0 && looksLikeJson(buf) ? 'application/json' : null;
  if (buf[0] === 0x89 && buf.toString('ascii', 1, 4) === 'PNG') return 'image/png';
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.toString('ascii', 0, 4) === 'RIFF' && buf.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (buf.toString('ascii', 0, 6) === 'GIF87a' || buf.toString('ascii', 0, 6) === 'GIF89a') return 'image/gif';
  if (buf.toString('ascii', 4, 8) === 'ftyp') {
    const brand = buf.toString('ascii', 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
    return 'video/mp4';
  }
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return 'video/webm';
  if (buf.toString('ascii', 0, 5) === '%PDF-') return 'application/pdf';
  if (looksLikeJson(buf)) return 'application/json';
  return null;
}

function looksLikeJson(buf: Buffer): boolean {
  const head = buf.subarray(0, 64).toString('utf8').trimStart();
  if (!head.startsWith('{') && !head.startsWith('[')) return false;
  try {
    JSON.parse(buf.toString('utf8'));
    return true;
  } catch {
    return false;
  }
}

export const EXT_BY_MIME: Record<SniffedType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'application/pdf': 'pdf',
  'application/json': 'json',
};

export const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  pdf: 'application/pdf',
  json: 'application/json',
  svg: 'image/svg+xml',
};

// ───────────── Local driver ─────────────

const ROOT = process.cwd();

export class LocalStorageDriver implements StorageDriver {
  readonly name = 'local';
  constructor(
    private readonly publicDir = path.join(ROOT, 'public', 'uploads'),
    private readonly privateDir = path.join(ROOT, 'storage', 'private'),
  ) {}

  private resolve(bucket: Bucket, key: string): string {
    assertSafeKey(key);
    const base = bucket === 'public' ? this.publicDir : this.privateDir;
    const full = path.resolve(base, key);
    if (!full.startsWith(path.resolve(base) + path.sep)) throw new Error('Path traversal blocked');
    return full;
  }

  async put(bucket: Bucket, key: string, data: Buffer) {
    const full = this.resolve(bucket, key);
    await fs.mkdir(path.dirname(full), { recursive: true });
    const tmp = `${full}.${randomToken(6)}.tmp`;
    await fs.writeFile(tmp, data, { mode: bucket === 'private' ? 0o600 : 0o644 });
    await fs.rename(tmp, full);
    return { key, size: data.length };
  }

  async get(bucket: Bucket, key: string) {
    try {
      return await fs.readFile(this.resolve(bucket, key));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  async delete(bucket: Bucket, key: string) {
    await fs.rm(this.resolve(bucket, key), { force: true });
  }

  async exists(bucket: Bucket, key: string) {
    try {
      await fs.access(this.resolve(bucket, key));
      return true;
    } catch {
      return false;
    }
  }

  publicUrl(key: string) {
    assertSafeKey(key);
    return `/media/${key}`;
  }

  async list(bucket: Bucket, prefix: string): Promise<StoredObject[]> {
    const base = path.resolve(bucket === 'public' ? this.publicDir : this.privateDir);
    const root = path.resolve(base, prefix);
    if (root !== base && !root.startsWith(base + path.sep)) throw new Error('Path traversal blocked');
    const out: StoredObject[] = [];
    const walk = async (dir: string) => {
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT') return;
        throw e;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.isFile() && !e.name.endsWith('.tmp')) out.push({ key: path.relative(base, full).split(path.sep).join('/'), updatedAt: (await fs.stat(full)).mtime });
      }
    };
    await walk(root);
    return out;
  }
}

// ───────────── Supabase driver ─────────────

export class SupabaseStorageDriver implements StorageDriver {
  readonly name = 'supabase';
  private readonly url: string;
  private readonly serviceKey: string;
  private readonly buckets: Record<Bucket, string>;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('STORAGE_DRIVER=supabase requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
    }
    this.url = env.SUPABASE_URL.replace(/\/+$/, '');
    this.serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
    this.buckets = { public: env.SUPABASE_PUBLIC_BUCKET || 'public', private: env.SUPABASE_PRIVATE_BUCKET || 'private' };
  }

  private objectUrl(bucket: Bucket, key: string) {
    assertSafeKey(key);
    return `${this.url}/storage/v1/object/${encodeURIComponent(this.buckets[bucket])}/${key}`;
  }

  private headers(extra: Record<string, string> = {}) {
    return { Authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  async put(bucket: Bucket, key: string, data: Buffer, opts?: { contentType?: string }) {
    const res = await fetch(this.objectUrl(bucket, key), {
      method: 'POST',
      headers: this.headers({ 'Content-Type': opts?.contentType ?? 'application/octet-stream', 'x-upsert': 'true' }),
      body: new Uint8Array(data),
    });
    if (!res.ok) throw new Error(`Supabase upload failed (${res.status}): ${await res.text()}`);
    return { key, size: data.length };
  }

  async get(bucket: Bucket, key: string) {
    const res = await fetch(this.objectUrl(bucket, key), { headers: this.headers(), cache: 'no-store' });
    if (res.status === 404 || res.status === 400) return null;
    if (!res.ok) throw new Error(`Supabase download failed (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(bucket: Bucket, key: string) {
    const res = await fetch(this.objectUrl(bucket, key), { method: 'DELETE', headers: this.headers() });
    if (!res.ok && res.status !== 404 && res.status !== 400) throw new Error(`Supabase delete failed (${res.status})`);
  }

  async exists(bucket: Bucket, key: string) {
    return (await this.get(bucket, key)) !== null;
  }

  publicUrl(key: string) {
    assertSafeKey(key);
    return `${this.url}/storage/v1/object/public/${encodeURIComponent(this.buckets.public)}/${key}`;
  }

  /** Recursive listing through the Storage list endpoint (one folder level per call, paged by 100). */
  async list(bucket: Bucket, prefix: string): Promise<StoredObject[]> {
    const out: StoredObject[] = [];
    const folder = async (dir: string) => {
      for (let offset = 0; ; offset += 100) {
        const res = await fetch(`${this.url}/storage/v1/object/list/${encodeURIComponent(this.buckets[bucket])}`, {
          method: 'POST',
          headers: this.headers({ 'Content-Type': 'application/json' }),
          body: JSON.stringify({ prefix: dir, limit: 100, offset, sortBy: { column: 'name', order: 'asc' } }),
        });
        if (!res.ok) throw new Error(`Supabase list failed (${res.status})`);
        const rows = (await res.json()) as { name: string; id: string | null; updated_at?: string; created_at?: string }[];
        for (const r of rows) {
          const key = dir ? `${dir.replace(/\/+$/, '')}/${r.name}` : r.name;
          if (r.id === null) await folder(key);
          else out.push({ key, updatedAt: new Date(r.updated_at ?? r.created_at ?? Date.now()) });
        }
        if (rows.length < 100) break;
      }
    };
    await folder(prefix.replace(/\/+$/, ''));
    return out;
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const kind = (process.env.STORAGE_DRIVER || 'local').toLowerCase();
  if (kind === 'local') driver = new LocalStorageDriver();
  else if (kind === 'supabase') driver = new SupabaseStorageDriver();
  else throw new Error(`Unknown STORAGE_DRIVER "${kind}" (expected local | supabase)`);
  return driver;
}

/** Test hook. */
export function __setStorageDriverForTests(d: StorageDriver | null) {
  driver = d;
}

/** Convenience: public URL for a stored key, or null. */
export function mediaUrl(key: string | null | undefined): string | null {
  return key ? getStorage().publicUrl(key) : null;
}
