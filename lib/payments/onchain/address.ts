import { createHash } from 'node:crypto';

/**
 * Address helpers for the on-chain payment adapter (no dependency): Keccak-256 (EVM checksums), EIP-55
 * validation and Tron base58check. They protect against the worst configuration mistake of all — funds
 * sent to a mistyped address: an address that fails its checksum is never used.
 */

// ---- Keccak-256 (the original Keccak padding used by Ethereum, NOT NIST SHA3-256) ----
const MASK = (1n << 64n) - 1n;
const RC: bigint[] = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n, 0x000000000000808bn, 0x0000000080000001n,
  0x8000000080008081n, 0x8000000000008009n, 0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n, 0x8000000000008002n, 0x8000000000000080n,
  0x000000000000800an, 0x800000008000000an, 0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
];
const ROT: number[] = [1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44];
const PI: number[] = [10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1];
const rotl = (x: bigint, n: number) => ((x << BigInt(n)) | (x >> BigInt(64 - n))) & MASK;

function keccakF(s: bigint[]): void {
  const c = new Array<bigint>(5);
  for (let round = 0; round < 24; round++) {
    for (let x = 0; x < 5; x++) c[x] = s[x]! ^ s[x + 5]! ^ s[x + 10]! ^ s[x + 15]! ^ s[x + 20]!;
    for (let x = 0; x < 5; x++) {
      const d = c[(x + 4) % 5]! ^ rotl(c[(x + 1) % 5]!, 1);
      for (let y = 0; y < 25; y += 5) s[y + x] = s[y + x]! ^ d;
    }
    let t = s[1]!;
    for (let i = 0; i < 24; i++) {
      const j = PI[i]!;
      const next = s[j]!;
      s[j] = rotl(t, ROT[i]!);
      t = next;
    }
    for (let y = 0; y < 25; y += 5) {
      for (let x = 0; x < 5; x++) c[x] = s[y + x]!;
      for (let x = 0; x < 5; x++) s[y + x] = c[x]! ^ (~c[(x + 1) % 5]! & MASK & c[(x + 2) % 5]!);
    }
    s[0] = s[0]! ^ RC[round]!;
  }
}

export function keccak256(input: Uint8Array | string): Uint8Array {
  const data = typeof input === 'string' ? new TextEncoder().encode(input) : input;
  const rate = 136;
  const padded = new Uint8Array(Math.ceil((data.length + 1) / rate) * rate);
  padded.set(data);
  padded[data.length] = (padded[data.length] ?? 0) ^ 0x01;
  padded[padded.length - 1] = (padded[padded.length - 1] ?? 0) ^ 0x80;
  const state = new Array<bigint>(25).fill(0n);
  for (let off = 0; off < padded.length; off += rate) {
    for (let i = 0; i < rate / 8; i++) {
      let lane = 0n;
      for (let b = 7; b >= 0; b--) lane = (lane << 8n) | BigInt(padded[off + i * 8 + b]!);
      state[i] = state[i]! ^ lane;
    }
    keccakF(state);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 4; i++) for (let b = 0; b < 8; b++) out[i * 8 + b] = Number((state[i]! >> BigInt(8 * b)) & 0xffn);
  return out;
}

const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

// ---- EVM (BNB Smart Chain, Ethereum) ----
const EVM_RE = /^0x[0-9a-fA-F]{40}$/;

/** EIP-55 mixed-case form of a 20-byte address. */
export function toChecksumAddress(address: string): string {
  const lower = address.toLowerCase().replace(/^0x/, '');
  const h = hex(keccak256(lower));
  let out = '0x';
  for (let i = 0; i < 40; i++) out += parseInt(h[i]!, 16) >= 8 ? lower[i]!.toUpperCase() : lower[i]!;
  return out;
}

/**
 * Valid EVM address. All-lowercase / all-uppercase is accepted only when `allowUnchecked` (lookups of
 * addresses found on chain); a configured payout address MUST carry a correct EIP-55 checksum.
 */
export function isValidEvmAddress(address: string, allowUnchecked = false): boolean {
  if (!EVM_RE.test(address)) return false;
  const body = address.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return allowUnchecked;
  return toChecksumAddress(address) === address;
}

/** Lowercase 40-hex form (no 0x) used to compare with log topics. */
export const evmHex = (address: string): string => address.toLowerCase().replace(/^0x/, '');

// ---- Tron (base58check) ----
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function base58Decode(s: string): Uint8Array | null {
  let n = 0n;
  for (const ch of s) {
    const v = B58.indexOf(ch);
    if (v < 0) return null;
    n = n * 58n + BigInt(v);
  }
  const bytes: number[] = [];
  while (n > 0n) {
    bytes.unshift(Number(n & 0xffn));
    n >>= 8n;
  }
  let zeros = 0;
  while (zeros < s.length && s[zeros] === '1') zeros++;
  return Uint8Array.from([...new Array<number>(zeros).fill(0), ...bytes]);
}

const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();

/** 20-byte account hex (lowercase) of a valid Tron address (`T…`, 34 chars, base58check, version 0x41); else null. */
export function tronHex(address: string): string | null {
  if (!/^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(address)) return null;
  const raw = base58Decode(address);
  if (!raw || raw.length !== 25 || raw[0] !== 0x41) return null;
  const payload = raw.subarray(0, 21);
  const check = sha256(sha256(payload)).subarray(0, 4);
  for (let i = 0; i < 4; i++) if (raw[21 + i] !== check[i]) return null;
  return hex(raw.subarray(1, 21));
}

export const isValidTronAddress = (address: string): boolean => tronHex(address) !== null;
