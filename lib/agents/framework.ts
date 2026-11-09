import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Prisma, PrismaClient, ProposalSeverity } from '@prisma/client';
import { prisma as defaultClient } from '@/lib/db';
import { sha256Hex } from '@/lib/crypto';
import { getSettings, type SettingsMap } from '@/lib/admin/settings';
import { createReadFacade, type AgentScope, type ReadFacade } from './facade';

export type { AgentScope, ReadFacade } from './facade';
import type { ActionType } from './action-types';

/**
 * Agent framework. An agent is a deterministic analysis over the database that can
 * only READ (scope-limited facade) and PROPOSE. It never mutates business data:
 * proposals carrying an `action` are applied only after a human with the right
 * permission approves them in the admin centre (lib/agents/proposals.ts → applyProposal).
 *
 *   export default defineAgent({
 *     key: 'stock', number: 4, nameKey: 'stock', scopes: ['productVariant'] as const,
 *     schedule: { everyMinutes: 60 },
 *     async run(ctx) { ... ctx.propose({ severity: 'HIGH', titleKey: 'stock.outOfStock', ... }) },
 *   });
 */

export type ProposalAction = { type: ActionType; params: Record<string, unknown> };

export type ProposalInput = {
  severity: ProposalSeverity;
  /** i18n key under `agents.proposals.*` (title shown in admin). */
  titleKey: string;
  /** ICU params for the title. */
  params?: Record<string, string | number>;
  /** English fallback title stored in AgentProposal.title. */
  title: string;
  /** Structured evidence shown in the inbox (items, metrics, ids). */
  details?: Record<string, unknown>;
  /** Whitelisted action applied only after human approval. */
  action?: ProposalAction;
  /** Stable identity: an OPEN proposal with the same fingerprint is refreshed instead of duplicated. */
  fingerprint: string;
};

export type AgentProbes = {
  /** Round-trip time of `SELECT 1` in ms. */
  dbLatencyMs: () => Promise<number>;
  /** Bytes used by the local private storage directory (null for remote drivers). */
  privateStorageBytes: () => Promise<number | null>;
};

export type AgentServices = {
  /** Ledger reconciliation report (money module), when available. */
  reconcile?: () => Promise<unknown>;
};

export type AgentContext<S extends AgentScope> = {
  readonly db: ReadFacade<S>;
  readonly now: Date;
  readonly settings: SettingsMap;
  readonly probes: AgentProbes;
  readonly services: AgentServices;
  propose: (p: ProposalInput) => void;
  /** Record a numeric/text metric in the run summary. */
  metric: (name: string, value: number | string | boolean | null) => void;
  /** Orchestrator only (supervision): run other agents and get their results. */
  runAgents?: () => Promise<AgentRunResult[]>;
};

export type AgentSchedule = { everyMinutes: number };

export type AgentDefinition<S extends AgentScope = AgentScope> = {
  key: string;
  number: number;
  /** i18n key under `agents.list.*`. */
  nameKey: string;
  scopes: readonly S[];
  schedule: AgentSchedule;
  /** Whether this agent orchestrates the others (supervision). */
  orchestrates?: boolean;
  run: (ctx: AgentContext<S>) => Promise<void>;
};

export function defineAgent<const S extends AgentScope>(def: AgentDefinition<S>): AgentDefinition<S> {
  if (!/^[a-z][a-z0-9-]*$/.test(def.key)) throw new Error(`Invalid agent key ${def.key}`);
  return Object.freeze({ ...def, scopes: Object.freeze([...def.scopes]) as readonly S[] });
}

export type AgentRunResult = {
  agentKey: string;
  runId: string;
  status: 'SUCCEEDED' | 'FAILED';
  proposals: { created: number; refreshed: number; total: number };
  error?: string;
  durationMs: number;
};

export type RunOptions = {
  trigger?: 'cron' | 'manual' | 'cli' | 'test';
  client?: PrismaClient;
  services?: AgentServices;
  /** For the orchestrator. */
  runAgents?: AgentContext<AgentScope>['runAgents'];
  timeoutMs?: number;
  now?: Date;
};

export function proposalFingerprint(agentKey: string, fingerprint: string): string {
  return sha256Hex(`${agentKey}:${fingerprint}`).slice(0, 32);
}

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  let entries: import('node:fs').Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) total += await dirSize(full);
    else if (e.isFile()) total += (await fs.stat(full)).size;
  }
  return total;
}

function probesFor(client: PrismaClient): AgentProbes {
  return {
    async dbLatencyMs() {
      const t = performance.now();
      await client.$queryRaw`SELECT 1`;
      return Math.round((performance.now() - t) * 10) / 10;
    },
    async privateStorageBytes() {
      if ((process.env.STORAGE_DRIVER || 'local').toLowerCase() !== 'local') return null;
      return dirSize(path.join(process.cwd(), 'storage', 'private'));
    },
  };
}

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms} ms`)), ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

/**
 * Execute one agent: records an AgentRun (RUNNING → SUCCEEDED/FAILED) and persists its
 * proposals. The FRAMEWORK writes AgentRun/AgentProposal rows; the agent itself only
 * receives the read-only facade.
 */
export async function runAgent(def: AgentDefinition, opts: RunOptions = {}): Promise<AgentRunResult> {
  const client = opts.client ?? defaultClient;
  const started = Date.now();
  const run = await client.agentRun.create({ data: { agentKey: def.key, trigger: opts.trigger ?? 'manual', status: 'RUNNING' } });
  const proposals: ProposalInput[] = [];
  const metrics: Record<string, number | string | boolean | null> = {};
  try {
    const settings = await getSettings(client);
    const ctx: AgentContext<AgentScope> = {
      db: createReadFacade(client, def.scopes),
      now: opts.now ?? new Date(),
      settings,
      probes: probesFor(client),
      services: opts.services ?? {},
      propose: (p) => {
        proposals.push(p);
      },
      metric: (name, value) => {
        metrics[name] = value;
      },
      runAgents: def.orchestrates ? opts.runAgents : undefined,
    };
    await withTimeout(def.run(ctx), opts.timeoutMs ?? 120_000, `agent ${def.key}`);

    let created = 0;
    let refreshed = 0;
    const seen = new Set<string>();
    for (const p of proposals) {
      const fp = proposalFingerprint(def.key, p.fingerprint);
      if (seen.has(fp)) continue;
      seen.add(fp);
      const details = {
        ...(p.details ?? {}),
        fp,
        titleKey: p.titleKey,
        params: p.params ?? {},
        ...(p.action ? { action: p.action } : {}),
      } as Prisma.InputJsonValue;
      const existing = await client.agentProposal.findFirst({
        where: { agentKey: def.key, status: 'OPEN', details: { path: ['fp'], equals: fp } },
        select: { id: true },
      });
      if (existing) {
        await client.agentProposal.update({
          where: { id: existing.id },
          data: { runId: run.id, severity: p.severity, title: p.title.slice(0, 300), details },
        });
        refreshed++;
      } else {
        await client.agentProposal.create({
          data: { runId: run.id, agentKey: def.key, severity: p.severity, title: p.title.slice(0, 300), details },
        });
        created++;
      }
    }
    const summary = { proposals: { created, refreshed, total: seen.size }, metrics };
    await client.agentRun.update({
      where: { id: run.id },
      data: { status: 'SUCCEEDED', finishedAt: new Date(), summary: summary as Prisma.InputJsonValue },
    });
    return { agentKey: def.key, runId: run.id, status: 'SUCCEEDED', proposals: summary.proposals, durationMs: Date.now() - started };
  } catch (err) {
    const message = (err instanceof Error ? `${err.name}: ${err.message}` : String(err)).slice(0, 2000);
    await client.agentRun
      .update({
        where: { id: run.id },
        data: { status: 'FAILED', finishedAt: new Date(), error: message, summary: { metrics } as Prisma.InputJsonValue },
      })
      .catch(() => undefined);
    return {
      agentKey: def.key,
      runId: run.id,
      status: 'FAILED',
      proposals: { created: 0, refreshed: 0, total: 0 },
      error: message,
      durationMs: Date.now() - started,
    };
  }
}
