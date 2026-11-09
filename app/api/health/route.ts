import { prisma } from '@/lib/db';
import { json } from '@/lib/http';

export const dynamic = 'force-dynamic';

/** Liveness/readiness probe (server monitoring agent, uptime checks). No sensitive data. */
export async function GET() {
  const started = Date.now();
  let db = false;
  try {
    await prisma.$queryRaw`SELECT 1`;
    db = true;
  } catch {
    db = false;
  }
  return json({ ok: db, db, latencyMs: Date.now() - started, time: new Date().toISOString() }, { status: db ? 200 : 503 });
}
