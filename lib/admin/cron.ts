import { timingSafeEqualString } from '@/lib/crypto';
import { HttpError } from '@/lib/http';

/**
 * Cron routes authenticate with `Authorization: Bearer ${CRON_SECRET}` (Vercel Cron sends
 * it automatically). Missing secret configuration ⇒ every call is refused.
 */
export function assertCronAuth(req: Request): void {
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16) throw new HttpError(503, 'cron_not_configured');
  const header = req.headers.get('authorization') ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (!token || !timingSafeEqualString(token, secret)) throw new HttpError(401, 'unauthorized');
}
