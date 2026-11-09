import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
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
import { LocalStorageDriver, assertSafeKey, buildKey, sniffMime } from '@/lib/storage';

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
