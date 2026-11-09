import type { Prisma, Role } from '@prisma/client';
import { prisma, type Db } from './db';
import { getRequestMeta } from './request';

/** Keys whose values must never be written to the audit log. */
const SENSITIVE_KEYS = new Set([
  'password',
  'passwordHash',
  'tokenHash',
  'token',
  'otp',
  'otpHash',
  'codeEncrypted',
  'code',
  'idNumberEncrypted',
  'iv',
  'authTag',
  'secret',
  'apiKey',
]);

/** Deep-copy a value replacing sensitive fields with "[redacted]". Dates become ISO strings. */
export function redact(value: unknown, depth = 0): Prisma.InputJsonValue | null {
  if (value === null || value === undefined) return null;
  if (depth > 8) return '[depth]';
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1)) as Prisma.InputJsonValue;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'object') {
    const out: Record<string, Prisma.InputJsonValue | null> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.has(k) ? '[redacted]' : redact(v, depth + 1);
    }
    return out as Prisma.InputJsonValue;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  return String(value);
}

export type AuditEntry = {
  actorId?: string | null;
  actorRole?: Role | null;
  /** Dotted verb, e.g. `product.update`, `wallet.adjust`, `kyc.document.view`. */
  action: string;
  /** Model/entity name, e.g. `Product`. */
  entity: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  /** Defaults to the current request's IP / UA when called inside a request. */
  ip?: string | null;
  userAgent?: string | null;
};

/**
 * Append an audit record. Pass the interactive transaction client as `db` so the
 * audit row commits/rolls back atomically with the change it describes.
 * Every sensitive admin change MUST call this.
 */
export async function logAudit(entry: AuditEntry, db: Db = prisma) {
  let { ip, userAgent } = entry;
  if (ip === undefined || userAgent === undefined) {
    const meta = await getRequestMeta();
    ip = ip === undefined ? meta.ip : ip;
    userAgent = userAgent === undefined ? meta.userAgent : userAgent;
  }
  const before = redact(entry.before);
  const after = redact(entry.after);
  return db.auditLog.create({
    data: {
      actorId: entry.actorId ?? null,
      actorRole: entry.actorRole ?? null,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      ...(before !== null ? { before } : {}),
      ...(after !== null ? { after } : {}),
      ip: ip ?? null,
      userAgent: userAgent ?? null,
    },
  });
}
