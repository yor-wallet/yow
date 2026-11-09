import { z } from 'zod';
import { prisma, type Db } from '@/lib/db';

/**
 * Wallet policy limits (integer baisa). Defaults below; an admin can override them with
 * the `Setting` row `wallet.limits` = `{ minTopUpBaisa, maxTopUpBaisa, maxBalanceBaisa }`.
 * Stored-value limits must follow the Central Bank of Oman rules applicable to the
 * licence DOOM operates under (see docs/PAYMENTS.md).
 */
export type WalletLimits = { minTopUpBaisa: number; maxTopUpBaisa: number; maxBalanceBaisa: number };

export const DEFAULT_WALLET_LIMITS: WalletLimits = {
  minTopUpBaisa: 1_000, // 1.000 OMR
  maxTopUpBaisa: 500_000, // 500.000 OMR per top-up
  maxBalanceBaisa: 2_000_000, // 2,000.000 OMR stored value cap
};

export const WALLET_LIMITS_SETTING = 'wallet.limits';

const limitsSchema = z
  .object({
    minTopUpBaisa: z.number().int().positive(),
    maxTopUpBaisa: z.number().int().positive(),
    maxBalanceBaisa: z.number().int().positive(),
  })
  .partial();

export async function getWalletLimits(db: Db = prisma): Promise<WalletLimits> {
  const row = await db.setting.findUnique({ where: { key: WALLET_LIMITS_SETTING } }).catch(() => null);
  const parsed = row ? limitsSchema.safeParse(row.value) : null;
  const merged = { ...DEFAULT_WALLET_LIMITS, ...(parsed?.success ? parsed.data : {}) };
  if (merged.minTopUpBaisa > merged.maxTopUpBaisa) return DEFAULT_WALLET_LIMITS;
  return merged;
}
