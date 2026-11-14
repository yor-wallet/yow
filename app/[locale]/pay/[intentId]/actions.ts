'use server';

import { unstable_rethrow } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { submitCryptoTransaction } from '@/lib/payments/crypto-submit';

export type CryptoSubmitState =
  | { status: 'idle' }
  | { status: 'success'; state: 'confirmed' | 'pending' }
  | { status: 'error'; error: string; details?: { sentUsdt?: string; expectedUsdt?: string } };

/** The customer paid from their own wallet and gives the transaction id: the server checks the blockchain. */
export async function submitCryptoTxAction(_prev: CryptoSubmitState, fd: FormData): Promise<CryptoSubmitState> {
  const session = await getSession();
  if (!session) return { status: 'error', error: 'unauthenticated' };
  const intentId = String(fd.get('intentId') ?? '');
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(intentId)) return { status: 'error', error: 'invalid_input' };
  try {
    if (!(await rateLimit(`crypto-tx:user:${session.user.id}`, 30, 60 * 60_000)).ok) return { status: 'error', error: 'rate_limited' };
    const res = await submitCryptoTransaction({
      intentId,
      userId: session.user.id,
      network: String(fd.get('network') ?? ''),
      txHash: String(fd.get('txHash') ?? '').slice(0, 100),
    });
    return res.ok ? { status: 'success', state: res.state } : { status: 'error', error: res.error, ...(res.details ? { details: res.details } : {}) };
  } catch (err) {
    unstable_rethrow(err);
    console.error('[pay] crypto transaction check failed', err instanceof Error ? err.message : err);
    return { status: 'error', error: 'generic' };
  }
}
