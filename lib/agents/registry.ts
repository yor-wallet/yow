import type { AgentDefinition } from './framework';
import type { AgentScope } from './facade';
import supervision from './agents/01-supervision';
import catalogue from './agents/02-catalogue';
import priceAnalysis from './agents/03-price-analysis';
import stock from './agents/04-stock';
import promotions from './agents/05-promotions';
import payments from './agents/06-payments';
import finance from './agents/07-finance';
import flex from './agents/08-flex';
import support from './agents/09-support';
import orders from './agents/10-orders';
import delivery from './agents/11-delivery';
import server from './agents/12-server';
import anomaly from './agents/13-anomaly';
import optimisation from './agents/14-optimisation';
import finalAudit from './agents/15-final-audit';

/** The 15 DOOM agents, ordered by number. */
export const AGENTS: readonly AgentDefinition<AgentScope>[] = [
  supervision,
  catalogue,
  priceAnalysis,
  stock,
  promotions,
  payments,
  finance,
  flex,
  support,
  orders,
  delivery,
  server,
  anomaly,
  optimisation,
  finalAudit,
] as unknown as readonly AgentDefinition<AgentScope>[];

export function getAgent(key: string): AgentDefinition<AgentScope> | undefined {
  return AGENTS.find((a) => a.key === key);
}

export const AGENT_KEYS = AGENTS.map((a) => a.key);
