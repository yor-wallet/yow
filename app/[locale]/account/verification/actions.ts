'use server';

import { revalidatePath } from 'next/cache';
import { ZodError } from 'zod';
import type { KycDocumentType } from '@prisma/client';
import { getSession } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { getRequestMeta } from '@/lib/request';
import { sha256Hex } from '@/lib/crypto';
import { IdempotencyError, withIdempotency } from '@/lib/idempotency';
import { idempotencyKeySchema } from '@/lib/validation';
import { KYC_DOCUMENT_TYPES, KYC_MAX_BYTES, KycError, submitKyc, type KycErrorCode } from '@/lib/kyc';

export type KycSubmitResult =
  | { ok: true }
  | { ok: false; error: KycErrorCode | 'consent_required' | 'name_too_short' | 'rate_limited' | 'unauthenticated' | 'generic'; field?: KycDocumentType };

/**
 * Upload verification documents (multipart FormData: fullName, consent, idempotencyKey,
 * ID_FRONT / ID_BACK / SELFIE files). Validation, encryption and storage happen in lib/kyc.
 */
export async function submitKycAction(fd: FormData): Promise<KycSubmitResult> {
  const session = await getSession();
  if (!session) return { ok: false, error: 'unauthenticated' };
  if (fd.get('consent') !== 'true') return { ok: false, error: 'consent_required' };
  const key = idempotencyKeySchema.safeParse(fd.get('idempotencyKey'));
  if (!key.success) return { ok: false, error: 'generic' };

  const files: Partial<Record<KycDocumentType, Buffer>> = {};
  for (const type of KYC_DOCUMENT_TYPES) {
    const f = fd.get(type);
    if (f instanceof File && f.size > 0) {
      if (f.size > KYC_MAX_BYTES) return { ok: false, error: 'too_large', field: type };
      files[type] = Buffer.from(await f.arrayBuffer());
    }
  }
  const fullName = String(fd.get('fullName') ?? '');

  const rl = await rateLimit(`kyc:submit:${session.user.id}`, 8, 60 * 60 * 1000);
  if (!rl.ok) return { ok: false, error: 'rate_limited' };

  try {
    const meta = await getRequestMeta();
    await withIdempotency(
      {
        scope: 'kyc.submit',
        key: key.data,
        userId: session.user.id,
        request: { fullName, docs: Object.fromEntries(Object.entries(files).map(([k, v]) => [k, sha256Hex(v!)])) },
      },
      async () => {
        const s = await submitKyc({ userId: session.user.id, fullName, files, meta });
        return { submissionId: s.id };
      },
    );
    revalidatePath('/[locale]/account', 'layout');
    return { ok: true };
  } catch (err) {
    if (err instanceof KycError) return { ok: false, error: err.code, field: err.field };
    if (err instanceof ZodError) return { ok: false, error: 'name_too_short' };
    if (err instanceof IdempotencyError) return { ok: false, error: err.code === 'in_progress' ? 'already_pending' : 'generic' };
    console.error('[kyc] submit failed', err);
    return { ok: false, error: 'generic' };
  }
}
