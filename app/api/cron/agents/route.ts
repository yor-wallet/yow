import { apiHandler, HttpError, json } from '@/lib/http';
import { assertCronAuth } from '@/lib/admin/cron';
import { getAgent } from '@/lib/agents/registry';
import { runAgentByKey, runAllAgents } from '@/lib/agents/runner';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * Agents cron. `GET|POST /api/cron/agents` (Bearer CRON_SECRET) runs the agents whose
 * interval has elapsed through the supervision agent; `?all=1` runs every agent,
 * `?agent=<key>` runs one. Agents only read and propose.
 */
async function handle(req: Request) {
  assertCronAuth(req);
  const url = new URL(req.url);
  const key = url.searchParams.get('agent');
  if (key && !getAgent(key)) throw new HttpError(404, 'unknown_agent');
  const results = key
    ? await runAgentByKey(key, { trigger: 'cron' })
    : await runAllAgents({ trigger: 'cron', onlyDue: url.searchParams.get('all') !== '1' });
  return json({
    ok: results.every((r) => r.status === 'SUCCEEDED'),
    results: results.map((r) => ({ agent: r.agentKey, status: r.status, proposals: r.proposals, durationMs: r.durationMs, error: r.error ?? null })),
  });
}

export const GET = apiHandler(handle);
export const POST = apiHandler(handle);
