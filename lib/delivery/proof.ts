import { decryptBuffer, encryptBuffer } from '../crypto';
import { buildKey, getStorage, sniffMime } from '../storage';

/**
 * Proof-of-delivery photos: encrypted (AES-256-GCM, AAD = `proof:<shipmentId>`) and
 * stored in the PRIVATE bucket as one self-contained blob:
 *   "DPF1" (4 bytes) | iv (12) | authTag (16) | ciphertext
 * so `Shipment.proofPhotoKey` is the only column needed.
 */

const MAGIC = Buffer.from('DPF1', 'ascii');

export function packProof(plain: Buffer, shipmentId: string): Buffer {
  const { ciphertext, iv, authTag } = encryptBuffer(plain, `proof:${shipmentId}`);
  return Buffer.concat([MAGIC, Buffer.from(iv, 'base64'), Buffer.from(authTag, 'base64'), ciphertext]);
}

export function unpackProof(blob: Buffer, shipmentId: string): Buffer {
  if (blob.length < 33 || !blob.subarray(0, 4).equals(MAGIC)) throw new Error('Malformed proof blob');
  const iv = blob.subarray(4, 16).toString('base64');
  const authTag = blob.subarray(16, 32).toString('base64');
  return decryptBuffer({ ciphertext: blob.subarray(32), iv, authTag }, `proof:${shipmentId}`);
}

export async function storeProofPhoto(shipmentId: string, photo: Buffer): Promise<string> {
  const key = buildKey(`delivery-proofs/${shipmentId.toLowerCase()}`, 'bin');
  await getStorage().put('private', key, packProof(photo, shipmentId), { contentType: 'application/octet-stream' });
  return key;
}

export async function readProofPhoto(shipmentId: string, key: string): Promise<{ bytes: Buffer; mime: string } | null> {
  const blob = await getStorage().get('private', key);
  if (!blob) return null;
  const bytes = unpackProof(blob, shipmentId);
  return { bytes, mime: sniffMime(bytes) ?? 'application/octet-stream' };
}
