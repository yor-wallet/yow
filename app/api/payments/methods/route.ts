import { z } from 'zod';
import { getSession } from '@/lib/auth';
import { apiHandler, HttpError, json } from '@/lib/http';
import { listPaymentMethods } from '@/lib/payments/registry';

/** GET /api/payments/methods?purpose=ORDER|TOPUP|INSTALLMENT&amountBaisa=… — availability for the current user. */
export const dynamic = 'force-dynamic';

const query = z.object({
  purpose: z.enum(['ORDER', 'TOPUP', 'INSTALLMENT']).default('ORDER'),
  amountBaisa: z.coerce.number().int().min(0).max(1_000_000_000).default(0),
});

export const GET = apiHandler(async (req) => {
  const url = new URL(req.url);
  const parsed = query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) throw new HttpError(422, 'validation_failed');
  const session = await getSession();
  const methods = await listPaymentMethods({ ...parsed.data, userId: session?.user.id ?? null });
  return json({ ok: true, methods });
});
