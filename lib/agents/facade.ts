import { Prisma, type PrismaClient } from '@prisma/client';

/**
 * READ-ONLY, scope-limited Prisma facade handed to agents.
 *
 * - Only models listed in the agent's `scopes` are reachable (`ctx.db.product`).
 * - Only read methods exist (findMany/findFirst/findUnique/count/aggregate/groupBy…);
 *   any other method (create/update/delete/upsert/…) throws AgentWriteError — and is
 *   absent from the TypeScript type, so it does not even compile.
 * - `$queryRaw`, `$executeRaw`, `$transaction` and other client methods are unreachable.
 * - Relations pulled through `include` / `select` / `where` / `orderBy` / `_count` must
 *   point to models that are also in scope (checked against the Prisma DMMF), so an
 *   agent cannot read an undeclared model through a relation.
 */

export const READ_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
] as const;
export type ReadMethod = (typeof READ_METHODS)[number];

/** Prisma delegate names, e.g. `product`, `productVariant`. */
export type AgentScope = Uncapitalize<Prisma.ModelName>;

export type ReadFacade<S extends AgentScope> = { readonly [K in S]: Pick<PrismaClient[K], ReadMethod & keyof PrismaClient[K]> };

export class AgentWriteError extends Error {
  constructor(what: string) {
    super(`Agents are read-only: "${what}" is not allowed`);
    this.name = 'AgentWriteError';
  }
}

export class AgentScopeError extends Error {
  constructor(model: string) {
    super(`Model "${model}" is outside the agent's declared read scopes`);
    this.name = 'AgentScopeError';
  }
}

type RelationMap = Map<string, Map<string, string>>;
let relations: RelationMap | null = null;

/** model (PascalCase) → relation field → target model (PascalCase). */
function relationMap(): RelationMap {
  if (relations) return relations;
  relations = new Map();
  for (const model of Prisma.dmmf.datamodel.models) {
    const fields = new Map<string, string>();
    for (const f of model.fields) if (f.kind === 'object') fields.set(f.name, f.type);
    relations.set(model.name, fields);
  }
  return relations;
}

const toModel = (scope: string) => scope.charAt(0).toUpperCase() + scope.slice(1);
const toScope = (model: string) => model.charAt(0).toLowerCase() + model.slice(1);

const LOGICAL = new Set(['AND', 'OR', 'NOT']);
const REL_FILTERS = new Set(['some', 'every', 'none', 'is', 'isNot']);

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date);
}

/** Validate that every relation reached by `args` targets an allowed model. Exported for tests. */
export function checkArgs(model: string, args: unknown, allowed: ReadonlySet<string>): void {
  if (!isObj(args)) return;
  const rels = relationMap().get(model);
  if (!rels) throw new AgentScopeError(model);
  const need = (target: string) => {
    if (!allowed.has(toScope(target))) throw new AgentScopeError(toScope(target));
  };

  const walkProjection = (proj: unknown) => {
    if (!isObj(proj)) return;
    for (const [field, value] of Object.entries(proj)) {
      if (field === '_count') {
        if (value === true) rels.forEach((target) => need(target));
        else if (isObj(value) && isObj(value.select)) {
          for (const [rf, rv] of Object.entries(value.select)) {
            const target = rels.get(rf);
            if (target) {
              need(target);
              if (isObj(rv)) checkArgs(target, rv, allowed);
            }
          }
        }
        continue;
      }
      const target = rels.get(field);
      if (!target) continue;
      need(target);
      if (isObj(value)) checkArgs(target, value, allowed);
    }
  };

  const walkWhere = (where: unknown, m: string) => {
    const mrels = relationMap().get(m);
    if (!mrels) return;
    if (Array.isArray(where)) {
      where.forEach((w) => walkWhere(w, m));
      return;
    }
    if (!isObj(where)) return;
    for (const [field, value] of Object.entries(where)) {
      if (LOGICAL.has(field)) {
        walkWhere(value, m);
        continue;
      }
      const target = mrels.get(field);
      if (!target) continue;
      need(target);
      if (isObj(value)) {
        const keys = Object.keys(value);
        if (keys.length > 0 && keys.every((k) => REL_FILTERS.has(k))) {
          for (const k of keys) walkWhere(value[k], target);
        } else walkWhere(value, target);
      }
    }
  };

  const walkOrder = (order: unknown, m: string) => {
    const mrels = relationMap().get(m);
    if (!mrels) return;
    if (Array.isArray(order)) {
      order.forEach((o) => walkOrder(o, m));
      return;
    }
    if (!isObj(order)) return;
    for (const [field, value] of Object.entries(order)) {
      const target = mrels.get(field);
      if (!target) continue;
      need(target);
      walkOrder(value, target);
    }
  };

  walkProjection(args.include);
  walkProjection(args.select);
  walkWhere(args.where, model);
  walkOrder(args.orderBy, model);
}

/** Build the read-only facade for `scopes` over `client`. */
export function createReadFacade<S extends AgentScope>(client: PrismaClient, scopes: readonly S[]): ReadFacade<S> {
  const allowed = new Set<string>(scopes);
  const cache = new Map<string, unknown>();
  return new Proxy({} as ReadFacade<S>, {
    get(_target, prop) {
      if (typeof prop !== 'string') return undefined;
      if (prop === 'then') return undefined; // not a thenable
      if (prop.startsWith('$')) throw new AgentWriteError(prop);
      if (!allowed.has(prop)) throw new AgentScopeError(prop);
      if (cache.has(prop)) return cache.get(prop);
      const delegate = (client as unknown as Record<string, Record<string, (a?: unknown) => Promise<unknown>>>)[prop];
      if (!delegate) throw new AgentScopeError(prop);
      const model = toModel(prop);
      const readOnly = new Proxy(
        {},
        {
          get(_t, method) {
            if (typeof method !== 'string') return undefined;
            if (method === 'then') return undefined;
            if (!(READ_METHODS as readonly string[]).includes(method)) throw new AgentWriteError(`${prop}.${method}`);
            return (args?: unknown) => {
              checkArgs(model, args, allowed);
              return delegate[method]!(args);
            };
          },
          set() {
            throw new AgentWriteError(`${prop}.<assign>`);
          },
        },
      );
      cache.set(prop, readOnly);
      return readOnly;
    },
    set(_t, prop) {
      throw new AgentWriteError(String(prop));
    },
    defineProperty(_t, prop) {
      throw new AgentWriteError(String(prop));
    },
  });
}
