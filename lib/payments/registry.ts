import { prisma, type Db } from '@/lib/db';
import { getWalletLimits } from '@/lib/wallet/limits';
import { getSettings } from '@/lib/admin/settings';
import { methodPolicyReason } from './policy';
import { thawaniAdapter } from './adapters/thawani';
import { omantelAdapter, ooredooAdapter } from './adapters/carrier';
import { cryptoAdapter } from './adapters/crypto';
import {
  type ExternalProviderId,
  type PaymentContext,
  type PaymentMethodId,
  type PaymentMethodOption,
  type PaymentPurposeKey,
  type ProviderAdapter,
  type UnavailableReason,
} from './types';

/**
 * Payment method registry: which methods exist for a purpose and whether each one is
 * usable right now. Providers that need contracts/credentials are real adapters reading
 * env config; when unconfigured they are returned with `available: false` and a reason
 * (the UI shows them disabled with an explanation) — never simulated.
 */

export const ADAPTERS: Record<ExternalProviderId, ProviderAdapter> = {
  CARD: thawaniAdapter,
  OOREDOO: ooredooAdapter,
  OMANTEL: omantelAdapter,
  CRYPTO: cryptoAdapter,
};

export function getAdapter(id: ExternalProviderId): ProviderAdapter {
  return ADAPTERS[id];
}

export function getAdapterBySlug(slug: string): ProviderAdapter | null {
  return Object.values(ADAPTERS).find((a) => a.slug === slug) ?? null;
}

/** Methods offered per purpose, in display order. */
export const METHODS_BY_PURPOSE: Record<PaymentPurposeKey, readonly PaymentMethodId[]> = {
  TOPUP: ['CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO', 'GIFT_CARD'],
  ORDER: ['WALLET', 'CARD', 'OOREDOO', 'OMANTEL', 'CRYPTO', 'FLEX', 'GIFT_CARD'],
  INSTALLMENT: ['WALLET'],
};

function option(id: PaymentMethodId, available: boolean, reason?: UnavailableReason, minAmountBaisa?: number): PaymentMethodOption {
  return {
    id,
    available,
    ...(available ? {} : { reason }),
    labelKey: `methods.${id}.label`,
    descriptionKey: `methods.${id}.description`,
    ...(minAmountBaisa ? { minAmountBaisa } : {}),
  };
}

/**
 * Methods for `purpose` (default ORDER) and amount, with availability for this user.
 * `[{ id, available, reason?, labelKey, descriptionKey }]`.
 */
export async function listPaymentMethods(context: PaymentContext, db: Db = prisma): Promise<PaymentMethodOption[]> {
  const purpose = context.purpose ?? 'ORDER';
  const amount = context.amountBaisa;
  const limits = purpose === 'TOPUP' ? await getWalletLimits(db) : null;
  let wallet: { status: string; balanceBaisa: number } | null = null;
  if (context.userId && METHODS_BY_PURPOSE[purpose].includes('WALLET')) {
    const w = await db.wallet.findUnique({
      where: { userId: context.userId },
      select: { status: true, ledgerAccount: { select: { balanceBaisa: true } } },
    });
    wallet = w ? { status: w.status, balanceBaisa: w.ledgerAccount.balanceBaisa } : { status: 'ACTIVE', balanceBaisa: 0 };
  }

  // Business rules from Admin > Settings > Payments (switches, KYC, bounds) for the methods they govern.
  const settings = await getSettings(db);
  const policy: Partial<Record<'CRYPTO' | 'GIFT_CARD', UnavailableReason | null>> = {};
  for (const m of ['CRYPTO', 'GIFT_CARD'] as const) {
    if (METHODS_BY_PURPOSE[purpose].includes(m)) policy[m] = await methodPolicyReason(m, { purpose, amountBaisa: amount, userId: context.userId }, db, settings);
  }

  return METHODS_BY_PURPOSE[purpose].map((id) => {
    switch (id) {
      case 'WALLET': {
        if (!context.userId) return option(id, false, 'login_required');
        if (wallet && wallet.status !== 'ACTIVE') return option(id, false, 'wallet_frozen');
        if (!wallet || wallet.balanceBaisa < amount) return option(id, false, 'insufficient_balance');
        return option(id, true);
      }
      case 'GIFT_CARD':
        // Gift cards are verified by finance staff and credited to the wallet; orders are
        // then paid from the wallet balance.
        if (purpose !== 'TOPUP') return option(id, false, 'gift_card_via_wallet');
        if (!context.userId) return option(id, false, 'login_required');
        if (policy.GIFT_CARD) return option(id, false, policy.GIFT_CARD);
        return option(id, true);
      case 'FLEX':
        return option(id, false, 'flex_apply_from_product');
      default: {
        const adapter = ADAPTERS[id as ExternalProviderId];
        if (!adapter.isConfigured()) return option(id, false, adapter.unavailableReason, adapter.minAmountBaisa);
        if (id === 'CRYPTO' && policy.CRYPTO) return option(id, false, policy.CRYPTO, adapter.minAmountBaisa);
        if (purpose === 'TOPUP' && limits) {
          if (amount > 0 && amount < limits.minTopUpBaisa) return option(id, false, 'amount_below_minimum', adapter.minAmountBaisa);
          if (amount > limits.maxTopUpBaisa) return option(id, false, 'amount_above_maximum', adapter.minAmountBaisa);
        }
        if (adapter.minAmountBaisa && amount > 0 && amount < adapter.minAmountBaisa) {
          return option(id, false, 'amount_below_minimum', adapter.minAmountBaisa);
        }
        return option(id, true, undefined, adapter.minAmountBaisa);
      }
    }
  });
}
