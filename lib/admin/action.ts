import 'server-only';
import { revalidatePath } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { getSession } from '@/lib/auth';
import { isStaff } from '@/lib/rbac';
import { IdempotencyError, withIdempotency } from '@/lib/idempotency';
import { idempotencyKeySchema, type FieldErrors } from '@/lib/validation';
import { AdminError, type Actor } from './actor';

/** State returned by every admin server action (consumed by `<AdminForm>`). */
export type ActionState = {
  status: 'idle' | 'success' | 'error';
  /** i18n key under `admin.errors` (error) or `admin.toast` (success). */
  code?: string;
  fieldErrors?: FieldErrors;
  /** Small JSON payload for the client (e.g. created id). */
  data?: Record<string, unknown>;
  /** Client redirect target (locale-less admin path) after success. */
  redirectTo?: string;
  /** Changes on every result so the client can react to repeated identical states. */
  at?: number;
};

export const IDLE: ActionState = { status: 'idle' };

/** The current staff actor, or null. */
export async function currentActor(): Promise<Actor | null> {
  const session = await getSession();
  if (!session || !isStaff(session.user.role)) return null;
  return { id: session.user.id, role: session.user.role };
}

export function errorState(err: unknown): ActionState {
  unstable_rethrow(err);
  if (err instanceof AdminError) return { status: 'error', code: err.code, fieldErrors: err.fieldErrors, at: Date.now() };
  if (err instanceof IdempotencyError) return { status: 'error', code: err.code === 'in_progress' ? 'in_progress' : 'duplicate', at: Date.now() };
  // Domain errors of other modules (MoneyError, KycError, DeliveryError, OrderError) carry a stable code.
  if (err instanceof Error && /^(Money|Kyc|Delivery|Order)Error$/.test(err.name) && typeof (err as { code?: unknown }).code === 'string') {
    return { status: 'error', code: `ext.${(err as unknown as { code: string }).code}`, at: Date.now() };
  }
  console.error('[admin] action failed', err);
  const code = err instanceof Error && /constraint|violates|check/i.test(err.message) ? 'constraint' : 'generic';
  return { status: 'error', code, at: Date.now() };
}

type RunOpts<R> = {
  /** Success toast key under `admin.toast` (default `saved`). */
  successCode?: string;
  /** Wrap in withIdempotency using the form's `idempotencyKey` field. */
  idempotent?: boolean;
  idempotencyKey?: unknown;
  /** Build a client redirect from the result. */
  redirectTo?: (result: R) => string | undefined;
  data?: (result: R) => Record<string, unknown> | undefined;
};

/**
 * Execute an admin mutation for the signed-in staff member and map the outcome to an
 * ActionState. Revalidates every page so lists and the storefront refresh.
 */
type AdminFn<R> = ((actor: Actor | null, input: unknown) => Promise<R>) & { mutationName?: string };

export async function runAdminAction<R>(mutation: AdminFn<R>, input: unknown, opts: RunOpts<R> & { scope?: string } = {}): Promise<ActionState> {
  try {
    const actor = await currentActor();
    let result: R;
    if (opts.idempotent) {
      const key = idempotencyKeySchema.safeParse(opts.idempotencyKey);
      if (!key.success) return { status: 'error', code: 'idempotency', at: Date.now() };
      const res = await withIdempotency(
        { scope: `admin.${opts.scope ?? mutation.mutationName ?? 'action'}`, key: key.data, userId: actor?.id ?? null, request: input },
        () => mutation(actor, input),
      );
      result = res.result;
    } else {
      result = await mutation(actor, input);
    }
    revalidatePath('/', 'layout');
    return {
      status: 'success',
      code: opts.successCode ?? 'saved',
      data: opts.data?.(result),
      redirectTo: opts.redirectTo?.(result),
      at: Date.now(),
    };
  } catch (err) {
    return errorState(err);
  }
}
