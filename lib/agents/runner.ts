import type { PrismaClient } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db';
import { reconcile } from '@/lib/wallet/reconcile';
import { runAgent, type AgentRunResult, type AgentServices } from './framework';
import { AGENTS, getAgent } from './registry';

/**
 * Entry points used by the cron route, the CLI and the admin "Run now" button.
 * The supervision agent orchestrates: it runs the (due) agents, then analyses health.
 */

export type RunTrigger = 'cron' | 'manual' | 'cli' | 'test';

function defaultServices(client: PrismaClient): AgentServices {
  // Read-only ledger reconciliation provided by the money module.
  return { reconcile: () => reconcile({ sampleSize: 10 }, client) };
}

/** Agents whose last successful run is older than their interval (or never ran). */
export async function dueAgentKeys(client: PrismaClient = defaultClient, now = new Date()): Promise<string[]> {
  const last = await client.agentRun.groupBy({ by: ['agentKey'], where: { status: 'SUCCEEDED' }, _max: { startedAt: true } });
  const at = new Map(last.map((l) => [l.agentKey, l._max.startedAt]));
  return AGENTS.filter((a) => !a.orchestrates)
    .filter((a) => {
      const t = at.get(a.key);
      // 5-minute grace so an hourly cron does not skip an agent that ran 59 minutes ago.
      return !t || now.getTime() - t.getTime() >= (a.schedule.everyMinutes - 5) * 60_000;
    })
    .map((a) => a.key);
}

/**
 * Run every agent (or only the due ones) through the supervision agent.
 * Returns the supervision result first, followed by each child result.
 */
export async function runAllAgents(
  opts: { trigger?: RunTrigger; onlyDue?: boolean; client?: PrismaClient; services?: AgentServices } = {},
): Promise<AgentRunResult[]> {
  const client = opts.client ?? defaultClient;
  const services = opts.services ?? defaultServices(client);
  const trigger = opts.trigger ?? 'manual';
  const children: AgentRunResult[] = [];
  const supervision = AGENTS.find((a) => a.orchestrates)!;
  const sup = await runAgent(supervision, {
    trigger,
    client,
    services,
    // The trigger decides: cron runs only due agents, "Run now" runs everything.
    runAgents: async () => {
      const keys = opts.onlyDue ? await dueAgentKeys(client) : AGENTS.filter((a) => !a.orchestrates).map((a) => a.key);
      for (const key of keys) {
        const def = getAgent(key);
        if (def) children.push(await runAgent(def, { trigger, client, services }));
      }
      return children;
    },
  });
  return [sup, ...children];
}

/** Run a single agent by key (the supervision key runs everything). */
export async function runAgentByKey(
  key: string,
  opts: { trigger?: RunTrigger; client?: PrismaClient; services?: AgentServices } = {},
): Promise<AgentRunResult[]> {
  const def = getAgent(key);
  if (!def) throw new Error(`Unknown agent "${key}"`);
  if (def.orchestrates) return runAllAgents({ ...opts, onlyDue: false });
  const client = opts.client ?? defaultClient;
  return [await runAgent(def, { trigger: opts.trigger ?? 'manual', client, services: opts.services ?? defaultServices(client) })];
}
