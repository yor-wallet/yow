import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * AES-256-GCM encryption for data at rest (KYC documents, gift-card codes,
 * ID numbers). Key: `KYC_ENCRYPTION_KEY` — 32 bytes as base64 (44 chars) or hex (64 chars).
 * Each call uses a fresh random 96-bit IV. Optional AAD binds ciphertext to a context
 * (e.g. the KycDocument id) so blobs cannot be swapped between records.
 */

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;

let cachedKey: Buffer | null = null;

export function parseKey(raw: string | undefined): Buffer {
  if (!raw) throw new Error('KYC_ENCRYPTION_KEY is not set');
  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) key = Buffer.from(trimmed, 'hex');
  else key = Buffer.from(trimmed, 'base64');
  if (key.length !== 32) throw new Error('KYC_ENCRYPTION_KEY must decode to exactly 32 bytes (base64 or hex)');
  return key;
}

function masterKey(): Buffer {
  if (!cachedKey) cachedKey = parseKey(process.env.KYC_ENCRYPTION_KEY);
  return cachedKey;
}

/** Derive an independent sub-key for a purpose (HKDF-SHA256). */
function subKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync('sha256', masterKey(), Buffer.alloc(0), `doom:${purpose}:v1`, 32));
}

export type EncryptedBlob = {
  ciphertext: Buffer;
  /** base64 */
  iv: string;
  /** base64 */
  authTag: string;
};

export function encryptBuffer(plain: Buffer, aad?: string): EncryptedBlob {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, masterKey(), iv);
  if (aad) cipher.setAAD(Buffer.from(aad, 'utf8'));
  const ciphertext = Buffer.concat([cipher.update(plain), cipher.final()]);
  return { ciphertext, iv: iv.toString('base64'), authTag: cipher.getAuthTag().toString('base64') };
}

/** Throws if the key, IV, tag or AAD do not match (tamper detection). */
export function decryptBuffer(blob: EncryptedBlob, aad?: string): Buffer {
  const decipher = createDecipheriv(ALGO, masterKey(), Buffer.from(blob.iv, 'base64'));
  if (aad) decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(Buffer.from(blob.authTag, 'base64'));
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

/** Encrypt a short string into a compact token `v1.<iv>.<tag>.<ciphertext>` (base64url). */
export function encryptString(plain: string, aad?: string): string {
  const { ciphertext, iv, authTag } = encryptBuffer(Buffer.from(plain, 'utf8'), aad);
  const b64u = (b64: string) => Buffer.from(b64, 'base64').toString('base64url');
  return `v1.${b64u(iv)}.${b64u(authTag)}.${ciphertext.toString('base64url')}`;
}

export function decryptString(token: string, aad?: string): string {
  const [version, iv, tag, ct] = token.split('.');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Malformed encrypted token');
  const toB64 = (s: string) => Buffer.from(s, 'base64url').toString('base64');
  return decryptBuffer({ ciphertext: Buffer.from(ct, 'base64url'), iv: toB64(iv), authTag: toB64(tag) }, aad).toString('utf8');
}

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

/**
 * Keyed fingerprint (HMAC-SHA256 with a derived key) for duplicate detection of
 * secrets without storing them in clear, e.g. gift-card codes. Not reversible
 * and not brute-forceable without the key.
 */
export function fingerprint(value: string, purpose = 'fingerprint'): string {
  return createHmac('sha256', subKey(purpose)).update(value.normalize('NFKC').trim().toUpperCase()).digest('hex');
}

/** URL-safe random token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

/** Numeric one-time code (e.g. delivery handover OTP), uniformly distributed. */
export function randomNumericCode(length = 6): string {
  let out = '';
  while (out.length < length) {
    const byte = randomBytes(1)[0]!;
    if (byte < 250) out += String(byte % 10);
  }
  return out;
}

export function timingSafeEqualString(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** Test hook: forget the cached key (after changing the env in tests). */
export function __resetKeyCacheForTests() {
  cachedKey = null;
}
