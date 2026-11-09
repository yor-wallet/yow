/**
 * Run interval (minutes) of every agent. The cron endpoint runs hourly; an agent is
 * "due" when it has no successful run within its interval. Kept separate from the
 * registry so the supervision agent can read it without circular imports.
 */
export const AGENT_INTERVALS = {
  supervision: 60,
  catalogue: 360,
  'price-analysis': 360,
  stock: 60,
  promotions: 360,
  payments: 60,
  finance: 1440,
  flex: 720,
  support: 60,
  orders: 60,
  delivery: 60,
  server: 60,
  anomaly: 60,
  optimisation: 1440,
  'final-audit': 1440,
} as const;

export type AgentKey = keyof typeof AGENT_INTERVALS;
