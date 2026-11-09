import type { Role } from '@prisma/client';
import { can, type Permission } from '@/lib/rbac';
import type { FieldErrors } from '@/lib/validation';

/**
 * The staff member performing an admin mutation. Built from the session in server
 * actions / route handlers, or directly in tests and scripts.
 */
export type Actor = { id: string; role: Role };

/** Typed admin failure: `code` is an i18n key under `admin.errors`. */
export class AdminError extends Error {
  constructor(
    public readonly code: string,
    message?: string,
    public readonly fieldErrors?: FieldErrors,
  ) {
    super(message ?? code);
    this.name = 'AdminError';
  }
}

export class ForbiddenError extends AdminError {
  constructor(public readonly permission?: string) {
    super('forbidden', permission ? `Missing permission ${permission}` : 'Forbidden');
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AdminError {
  constructor(entity = 'record') {
    super('not_found', `${entity} not found`);
    this.name = 'NotFoundError';
  }
}

export class ValidationError extends AdminError {
  constructor(fieldErrors: FieldErrors) {
    super('validation', 'Validation failed', fieldErrors);
    this.name = 'ValidationError';
  }
}

/** Throws ForbiddenError unless `actor` holds every permission (and `admin:access`). */
export function assertCan(actor: Actor | null | undefined, permission: Permission | readonly Permission[]): asserts actor is Actor {
  if (!actor) throw new ForbiddenError('admin:access');
  if (!can(actor.role, 'admin:access')) throw new ForbiddenError('admin:access');
  const list = (Array.isArray(permission) ? permission : [permission]) as readonly Permission[];
  for (const p of list) if (!can(actor.role, p)) throw new ForbiddenError(p);
}
