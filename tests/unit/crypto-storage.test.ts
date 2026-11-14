import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
import {
  decryptBuffer,
  decryptString,
  encryptBuffer,
  encryptString,
  fingerprint,
  parseKey,
  randomNumericCode,
  randomToken,
  sha256Hex,
} from '@/lib/crypto';
import { LocalStorageDriver, SupabaseStorageDriver, assertSafeKey, buildKey, sniffMime, supabaseAuthHeaders } from '@/lib/storage';

describe('AES-256-GCM', () => {
  it('round-trips buffers and strings', () => {
    const plain = Buffer.from('ID card scan bytes \u0000ÿ', 'utf8');
    const blob = encryptBuffer(plain, 'doc_1');
    expect(blob.ciphertext.equals(plain)).toBe(false);
    expect(decryptBuffer(blob, 'doc_1').equals(plain)).toBe(true);
    const token = encryptString('GIFT-CARD-1234-5678');
    expect(token.startsWith('v1.')).toBe(true);
    expect(decryptString(token)).toBe('GIFT-CARD-1234-5678');
  });

  it('uses a fresh IV every time', () => {
    const a = encryptString('same');
    const b = encryptString('same');
    expect(a).not.toBe(b);
  });

  it('detects tampering and wrong AAD', () => {
    const blob = encryptBuffer(Buffer.from('secret'), 'doc_1');
    expect(() => decryptBuffer(blob, 'doc_2')).toThrow();
    const tampered = { ...blob, ciphertext: Buffer.from(blob.ciphertext) };
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 0xff;
    expect(() => decryptBuffer(tampered, 'doc_1')).toThrow();
  });

  it('validates the key format', () => {
    expect(() => parseKey(undefined)).toThrow();
    expect(() => parseKey('too-short')).toThrow();
    expect(parseKey('a'.repeat(64)).length).toBe(32);
  });

  it('fingerprints are stable, keyed and normalised', () => {
    expect(fingerprint(' abcd-1234 ')).toBe(fingerprint('ABCD-1234'));
    expect(fingerprint('ABCD-1234')).not.toBe(sha256Hex('ABCD-1234'));
  });

  it('random helpers', () => {
    expect(randomToken().length).toBeGreaterThanOrEqual(43);
    expect(randomNumericCode(6)).toMatch(/^\d{6}$/);
  });
});

describe('storage', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'doom-storage-'));
  const driver = new LocalStorageDriver(path.join(dir, 'public'), path.join(dir, 'private'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('rejects unsafe keys', () => {
    for (const bad of ['../x', '/abs', 'a//b', 'a/../b', 'A/B', 'a\\b', '']) {
      expect(() => assertSafeKey(bad), bad).toThrow();
    }
    expect(() => assertSafeKey('kyc/2026/11/abc.bin')).not.toThrow();
  });

  it('buildKey creates safe unique keys', () => {
    const a = buildKey('products/Phone 1', 'WEBP');
    expect(a).toMatch(/^products\/phone-1\/\d{4}\/\d{2}\/[a-f0-9]{32}\.webp$/);
    expect(buildKey('x', 'png')).not.toBe(buildKey('x', 'png'));
  });

  it('local driver put/get/exists/delete in both buckets', async () => {
    const key = buildKey('kyc/test', 'bin');
    await driver.put('private', key, Buffer.from('hello'));
    expect(await driver.exists('private', key)).toBe(true);
    expect(await driver.exists('public', key)).toBe(false);
    expect((await driver.get('private', key))?.toString()).toBe('hello');
    await driver.delete('private', key);
    expect(await driver.get('private', key)).toBeNull();
    expect(driver.publicUrl('products/a.webp')).toBe('/media/products/a.webp');
  });

  it('sniffs file types from magic bytes', () => {
    expect(sniffMime(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]))).toBe('image/png');
    expect(sniffMime(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg');
    expect(sniffMime(Buffer.from('RIFF0000WEBPVP8 ', 'ascii'))).toBe('image/webp');
    expect(sniffMime(Buffer.from('0000ftypavif0000', 'ascii'))).toBe('image/avif');
    expect(sniffMime(Buffer.from('0000ftypisom0000', 'ascii'))).toBe('video/mp4');
    expect(sniffMime(Buffer.from('{"v":"5.7","layers":[]}'))).toBe('application/json');
    expect(sniffMime(Buffer.from('<svg onload=alert(1)>'))).toBeNull();
  });
});

describe('supabase storage driver', () => {
  const env = (key: string) =>
    ({ SUPABASE_URL: 'https://example.supabase.co/', SUPABASE_SERVICE_ROLE_KEY: key, SUPABASE_PRIVATE_BUCKET: 'private' }) as unknown as NodeJS.ProcessEnv;
  const calls: { url: string; init: RequestInit }[] = [];
  const stub = (...responses: Response[]) => {
    calls.length = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init: RequestInit = {}) => {
        calls.push({ url, init });
        return responses.shift() ?? new Response('', { status: 500 });
      }),
    );
  };
  afterEach(() => vi.unstubAllGlobals());

  it('sends a new secret key on the apikey header only, a legacy JWT key on both', () => {
    expect(supabaseAuthHeaders('sb_secret_abc')).toEqual({ apikey: 'sb_secret_abc' });
    expect(supabaseAuthHeaders('eyJhbGciOi.x.y')).toEqual({ Authorization: 'Bearer eyJhbGciOi.x.y', apikey: 'eyJhbGciOi.x.y' });
  });

  it('uploads to the private bucket with the key on the apikey header', async () => {
    stub(new Response('{}', { status: 200 }));
    await new SupabaseStorageDriver(env('sb_secret_abc')).put('private', 'kyc/u1/a.bin', Buffer.from('x'), { contentType: 'application/octet-stream' });
    expect(calls[0]!.url).toBe('https://example.supabase.co/storage/v1/object/private/kyc/u1/a.bin');
    const h = calls[0]!.init.headers as Record<string, string>;
    expect(h.apikey).toBe('sb_secret_abc');
    expect(h.Authorization).toBeUndefined();
    expect(h['x-upsert']).toBe('true');
  });

  it('a missing file reads as null, but a rejected call is an error, never "missing"', async () => {
    const d = new SupabaseStorageDriver(env('sb_secret_abc'));
    stub(new Response(JSON.stringify({ statusCode: '404', error: 'not_found', message: 'Object not found' }), { status: 400 }));
    expect(await d.get('private', 'kyc/a.bin')).toBeNull();
    stub(new Response('', { status: 404 }));
    expect(await d.get('private', 'kyc/a.bin')).toBeNull();
    stub(new Response(JSON.stringify({ statusCode: '403', error: 'Unauthorized', message: 'Invalid JWT' }), { status: 400 }));
    await expect(d.get('private', 'kyc/a.bin')).rejects.toThrow(/download failed \(400\)/);
    stub(new Response(JSON.stringify({ statusCode: '403', error: 'Unauthorized' }), { status: 400 }));
    await expect(d.delete('private', 'kyc/a.bin')).rejects.toThrow(/delete failed/);
    stub(new Response(JSON.stringify({ statusCode: '404', error: 'not_found' }), { status: 400 }));
    await expect(d.delete('private', 'kyc/a.bin')).resolves.toBeUndefined();
  });
});
