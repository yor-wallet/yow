import { fingerprint, timingSafeEqualString } from '../crypto';

/**
 * Handover OTP (6 digits) shown to the customer when the shipment is OUT_FOR_DELIVERY
 * and entered by the courier on delivery.
 *
 * Storage: only a keyed hash is stored (`Shipment.otpHash` = HMAC-SHA256 with a key
 * derived from KYC_ENCRYPTION_KEY) — not brute-forceable from a DB dump.
 * Display: the code is NOT stored in clear anywhere; it is re-derived on demand for the
 * owner (`deriveHandoverOtp(shipmentId, otpExpiresAt)` = HMAC of the shipment id and the
 * issue nonce, reduced to 6 digits), so the tracking page and notification centre can
 * show it without persisting it.
 */

export const OTP_LENGTH = 6;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_TTL_HOURS = 24;

/** The 6-digit code for a shipment issuance (nonce = `otpExpiresAt`, ms precision). */
export function deriveHandoverOtp(shipmentId: string, otpExpiresAt: Date): string {
  const hex = fingerprint(`${shipmentId}:${otpExpiresAt.getTime()}`, 'delivery-otp');
  const n = Number.parseInt(hex.slice(0, 13), 16) % 10 ** OTP_LENGTH;
  return String(n).padStart(OTP_LENGTH, '0');
}

export function hashHandoverOtp(shipmentId: string, otp: string): string {
  return fingerprint(`${shipmentId}:${otp}`, 'delivery-otp-hash');
}

/** Constant-time comparison of a submitted code with the stored hash. */
export function checkHandoverOtp(shipmentId: string, submitted: string, storedHash: string): boolean {
  const normalized = submitted.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return false;
  return timingSafeEqualString(hashHandoverOtp(shipmentId, normalized), storedHash);
}

/** New issuance: expiry (= nonce), code and hash. */
export function issueHandoverOtp(shipmentId: string, now = new Date()): { otp: string; otpHash: string; otpExpiresAt: Date } {
  const otpExpiresAt = new Date(now.getTime() + OTP_TTL_HOURS * 3600 * 1000 + Math.floor(Math.random() * 1000));
  const otp = deriveHandoverOtp(shipmentId, otpExpiresAt);
  return { otp, otpHash: hashHandoverOtp(shipmentId, otp), otpExpiresAt };
}
