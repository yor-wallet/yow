import { prisma, type Db } from '@/lib/db';
import { getSettings, type SettingsMap } from '@/lib/admin/settings';
import { MoneyError } from '@/lib/wallet/errors';
import type { PaymentPurposeKey, UnavailableReason } from './types';

/**
 * Business rules an administrator controls (Admin > Settings > Payments), applied on top of the
 * provider's own availability. One function decides, so the checkout (what is shown) and the server
 * (what is accepted) can never disagree.
 */
export type PolicyInput = { purpose: PaymentPurposeKey; amountBaisa: number; userId?: string | null };

async function kycVerified(userId: string, db: Db): Promise<boolean> {
  const u = await db.user.findUnique({ where: { id: userId }, select: { kycStatus: true } });
  return u?.kycStatus === 'VERIFIED';
}

/** Why `method` cannot be used right now according to the settings (null = allowed). */
export async function methodPolicyReason(
  method: 'CRYPTO' | 'GIFT_CARD',
  input: PolicyInput,
  db: Db = prisma,
  settings?: SettingsMap,
): Promise<UnavailableReason | null> {
  const s = settings ?? (await getSettings(db));
  if (method === 'GIFT_CARD') {
    if (!s['giftcard.enabled']) return 'disabled_by_admin';
    if (s['giftcard.requireKyc']) {
      if (!input.userId) return 'login_required';
      if (!(await kycVerified(input.userId, db))) return 'kyc_required';
    }
    return null;
  }
  if (!s['crypto.enabled']) return 'disabled_by_admin';
  if (input.purpose === 'ORDER' && !s['crypto.forOrders']) return 'disabled_by_admin';
  if (input.purpose === 'TOPUP' && !s['crypto.forTopup']) return 'disabled_by_admin';
  if (s['crypto.requireKyc']) {
    if (!input.userId) return 'login_required';
    if (!(await kycVerified(input.userId, db))) return 'kyc_required';
  }
  const min = s['crypto.minPaymentBaisa'];
  const max = s['crypto.maxPaymentBaisa'];
  if (input.amountBaisa > 0 && min !== null && input.amountBaisa < min) return 'amount_below_minimum';
  if (max !== null && input.amountBaisa > max) return 'amount_above_maximum';
  return null;
}

/** Server-side enforcement: throws the matching money error when the settings forbid the method. */
export async function assertMethodAllowed(method: 'CRYPTO' | 'GIFT_CARD', input: PolicyInput, db: Db = prisma): Promise<void> {
  const reason = await methodPolicyReason(method, input, db);
  if (!reason) return;
  if (reason === 'kyc_required') throw new MoneyError('kyc_required');
  if (reason === 'amount_below_minimum' || reason === 'amount_above_maximum') throw new MoneyError(reason);
  throw new MoneyError('method_unavailable', `${method}: ${reason}`);
}

/** Exchange commission on a verified gift card: rounded to the nearest baisa, never the whole value. */
export function giftCardCommissionBaisa(valueBaisa: number, feeBps: number): number {
  if (!Number.isSafeInteger(valueBaisa) || valueBaisa <= 0 || feeBps <= 0) return 0;
  return Math.max(0, Math.min(Math.round((valueBaisa * feeBps) / 10_000), valueBaisa - 1));
}
