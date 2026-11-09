import type { Prisma } from '@prisma/client';
import type { z } from 'zod';
import { prisma, serializable } from '@/lib/db';
import { logAudit, type AuditEntry } from '@/lib/audit';
import type { Permission } from '@/lib/rbac';
import { fieldErrorsOf } from '@/lib/validation';
import { assertCan, ValidationError, type Actor } from './actor';

/**
 * Admin mutations: RBAC + zod validation + transaction + audit in one place.
 *
 *   export const updateBrand = defineMutation({
 *     name: 'brand.update',
 *     permission: 'catalog:write',
 *     schema: brandSchema,
 *     async run({ tx, input, audit }) {
 *       const before = await tx.brand.findUniqueOrThrow({ where: { id: input.id } });
 *       const after = await tx.brand.update({ ... });
 *       await audit({ action: 'brand.update', entity: 'Brand', entityId: after.id, before, after });
 *       return { id: after.id };
 *     },
 *   });
 *
 *   await updateBrand(actor, rawInput); // throws ForbiddenError / ValidationError / AdminError
 *
 * The audit row is written with the same transaction client, so it commits or rolls
 * back atomically with the change it describes. Server actions call mutations via
 * `runAdminAction` (lib/admin/action.ts); tests call them directly with a fake actor.
 */

export type AuditInput = Omit<AuditEntry, 'actorId' | 'actorRole'>;

export type MutationContext<I> = {
  tx: Prisma.TransactionClient;
  actor: Actor;
  input: I;
  /** Append an audit row inside the transaction (actor filled in). */
  audit: (entry: AuditInput) => Promise<void>;
};

export type Mutation<I, R> = ((actor: Actor | null | undefined, input: unknown) => Promise<R>) & {
  readonly mutationName: string;
  readonly permission: readonly Permission[];
  /** Input type marker (never set at runtime). */
  readonly __input?: I;
};

export type MutationDef<S extends z.ZodTypeAny, R> = {
  name: string;
  permission: Permission | readonly Permission[];
  schema: S;
  /** `serializable` for stock/money writes (retried on serialization failures). */
  isolation?: 'default' | 'serializable';
  run: (ctx: MutationContext<z.output<S>>) => Promise<R>;
};

export function defineMutation<S extends z.ZodTypeAny, R>(def: MutationDef<S, R>): Mutation<z.input<S>, R> {
  const permission = (Array.isArray(def.permission) ? def.permission : [def.permission]) as readonly Permission[];
  const fn = async (actor: Actor | null | undefined, raw: unknown): Promise<R> => {
    assertCan(actor, permission);
    const parsed = def.schema.safeParse(raw);
    if (!parsed.success) throw new ValidationError(fieldErrorsOf(parsed.error));
    const input = parsed.data as z.output<S>;
    const body = async (tx: Prisma.TransactionClient) =>
      def.run({
        tx,
        actor,
        input,
        audit: async (entry) => {
          await logAudit({ ...entry, actorId: actor.id, actorRole: actor.role }, tx);
        },
      });
    if (def.isolation === 'serializable') return serializable(body);
    return prisma.$transaction(body, { timeout: 20_000, maxWait: 5_000 });
  };
  return Object.assign(fn, { mutationName: def.name, permission });
}

/** Shallow diff helper for audit before/after: keeps only keys whose JSON value changed. */
export function changedFields<T extends Record<string, unknown>>(before: T, after: Partial<T>): { before: Partial<T>; after: Partial<T> } {
  const b: Partial<T> = {};
  const a: Partial<T> = {};
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key] ?? null) !== JSON.stringify(after[key] ?? null)) {
      b[key] = before[key];
      a[key] = after[key];
    }
  }
  return { before: b, after: a };
}
