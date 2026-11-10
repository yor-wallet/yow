import { apiHandler, json } from '@/lib/http';
import { requireApiUser } from '@/lib/auth';
import { unreadCount } from '@/lib/notifications';

/** Unread notification count for the header bell (client refresh). `Cache-Control: no-store`. */
export const GET = apiHandler(async () => {
  const session = await requireApiUser();
  return json({ ok: true, count: await unreadCount(session.user.id) });
});
