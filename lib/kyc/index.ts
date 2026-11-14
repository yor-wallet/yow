import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { emailConfirmationRequired } from '@/lib/auth/email-verification';
import type { KycDocumentType, KycStatus, Prisma, Role } from '@prisma/client';
import { prisma } from '../db';
import { can } from '../rbac';
import { logAudit } from '../audit';
import { decryptBuffer, encryptBuffer, sha256Hex } from '../crypto';
import { buildKey, getStorage } from '../storage';
import { signToken, verifyToken } from '../auth/tokens';
import { fullNameSchema } from '../validation';
import { notifyTemplate } from '../notifications';
import { validateImage, IMAGE_MAX_BYTES, type ImageValidationError } from '../delivery/images';
import { parseIntSetting } from '../delivery/settings';

/**
 * KYC (identity verification) — logistics & account module.
 *
 * Documents (ID front, ID back, selfie) are validated by magic bytes, encrypted with
 * AES-256-GCM (lib/crypto, AAD = KycDocument id) and stored in the PRIVATE bucket; the
 * row keeps iv, authTag, sha256 (of the plaintext), mime and size. Access for review is
 * restricted to `kyc:documents` (ADMIN/SUPERADMIN) and every access writes KycAccessLog.
 * Decisions require `kyc:decide`, are audited and notify the customer. See docs/KYC_PRIVACY.md.
 */

export const KYC_DOCUMENT_TYPES: readonly KycDocumentType[] = ['ID_FRONT', 'ID_BACK', 'SELFIE'];
export const KYC_MAX_BYTES = IMAGE_MAX_BYTES;
export const KYC_SETTING_KEYS = { retentionDays: 'kyc.retentionDays' } as const;
export const KYC_DECISIONS = ['VERIFIED', 'REJECTED', 'DOCUMENTS_REQUESTED'] as const;
export type KycDecision = (typeof KYC_DECISIONS)[number];

export type KycErrorCode =
  | ImageValidationError
  | 'missing_document'
  | 'already_verified'
  | 'already_pending'
  | 'phone_required'
  | 'address_required'
  | 'not_found'
  | 'forbidden'
  | 'not_reviewable'
  | 'notes_required'
  | 'requested_docs_required'
  | 'integrity_failed'
  | 'email_unverified';

export class KycError extends Error {
  constructor(
    public readonly code: KycErrorCode,
    public readonly field?: KycDocumentType,
  ) {
    super(field ? `${code}:${field}` : code);
    this.name = 'KycError';
  }
}

export { validateImage as validateKycImage, isHeic } from '../delivery/images';

/** Storage key prefix per user (lowercased cuid). */
function docKey(userId: string) {
  return buildKey(`kyc/${userId.toLowerCase()}`, 'bin');
}

export type KycMeta = { ip?: string | null; userAgent?: string | null };

export const kycBasicSchema = z.object({ fullName: fullNameSchema });

/**
 * Submit (or complete) a verification.
 * - UNVERIFIED / REJECTED → new submission, all 3 documents required.
 * - DOCUMENTS_REQUESTED  → the requested documents are added to the open submission
 *   (replaced documents are crypto-shredded) and it goes back to PENDING.
 */
export async function submitKyc(input: {
  userId: string;
  fullName: string;
  files: Partial<Record<KycDocumentType, Buffer>>;
  meta?: KycMeta;
}) {
  const { fullName } = kycBasicSchema.parse({ fullName: input.fullName });
  const user = await prisma.user.findUnique({
    where: { id: input.userId },
    select: { id: true, role: true, phone: true, kycStatus: true, emailVerifiedAt: true, addresses: { where: { deletedAt: null }, select: { id: true }, take: 1 } },
  });
  if (!user) throw new KycError('not_found');
  // Account confirmed by e-mail first (only enforced once e-mails can actually be sent).
  if (!user.emailVerifiedAt && emailConfirmationRequired()) throw new KycError('email_unverified');
  if (user.kycStatus === 'VERIFIED') throw new KycError('already_verified');
  if (user.kycStatus === 'PENDING') throw new KycError('already_pending');
  if (!user.phone) throw new KycError('phone_required');
  if (user.addresses.length === 0) throw new KycError('address_required');

  let openSubmission: { id: string; requestedDocs: KycDocumentType[] } | null = null;
  if (user.kycStatus === 'DOCUMENTS_REQUESTED') {
    openSubmission = await prisma.kycSubmission.findFirst({
      where: { userId: user.id, status: 'DOCUMENTS_REQUESTED' },
      orderBy: { submittedAt: 'desc' },
      select: { id: true, requestedDocs: true },
    });
  }
  const required: KycDocumentType[] = openSubmission
    ? openSubmission.requestedDocs.length
      ? openSubmission.requestedDocs
      : [...KYC_DOCUMENT_TYPES]
    : [...KYC_DOCUMENT_TYPES];

  // Validate every required file before touching storage.
  const accepted: { type: KycDocumentType; buf: Buffer; mime: string }[] = [];
  for (const type of required) {
    const buf = input.files[type];
    if (!buf || buf.length === 0) throw new KycError('missing_document', type);
    const v = validateImage(buf, KYC_MAX_BYTES);
    if (!v.ok) throw new KycError(v.code, type);
    accepted.push({ type, buf, mime: v.mime });
  }

  // Encrypt + store (ids generated up front so they can be used as AAD).
  const stored: { id: string; type: KycDocumentType; key: string; iv: string; authTag: string; mime: string; size: number; sha256: string }[] = [];
  const storage = getStorage();
  try {
    for (const doc of accepted) {
      const id = randomUUID();
      const enc = encryptBuffer(doc.buf, id);
      const key = docKey(user.id);
      await storage.put('private', key, enc.ciphertext, { contentType: 'application/octet-stream' });
      stored.push({ id, type: doc.type, key, iv: enc.iv, authTag: enc.authTag, mime: doc.mime, size: doc.buf.length, sha256: sha256Hex(doc.buf) });
    }
  } catch (err) {
    await Promise.all(stored.map((s) => storage.delete('private', s.key).catch(() => undefined)));
    throw err;
  }

  const replacedKeys: string[] = [];
  try {
    const submission = await prisma.$transaction(async (tx) => {
      let submissionId: string;
      if (openSubmission) {
        submissionId = openSubmission.id;
        const replaced = await tx.kycDocument.findMany({
          where: { submissionId, type: { in: required }, deletedAt: null },
          select: { id: true, storageKey: true },
        });
        replacedKeys.push(...replaced.map((r) => r.storageKey));
        if (replaced.length) {
          await tx.kycDocument.updateMany({ where: { id: { in: replaced.map((r) => r.id) } }, data: { deletedAt: new Date() } });
        }
        await tx.kycSubmission.update({
          where: { id: submissionId },
          data: { status: 'PENDING', fullName, requestedDocs: [], submittedAt: new Date(), reviewedAt: null, reviewedById: null },
        });
      } else {
        const created = await tx.kycSubmission.create({ data: { userId: user.id, fullName, status: 'PENDING' } });
        submissionId = created.id;
      }
      await tx.kycDocument.createMany({
        data: stored.map((s) => ({
          id: s.id,
          submissionId,
          type: s.type,
          storageKey: s.key,
          iv: s.iv,
          authTag: s.authTag,
          mime: s.mime,
          sizeBytes: s.size,
          sha256: s.sha256,
        })),
      });
      await tx.user.update({ where: { id: user.id }, data: { kycStatus: 'PENDING' } });
      await logAudit(
        {
          actorId: user.id,
          actorRole: user.role,
          action: openSubmission ? 'kyc.documents.add' : 'kyc.submit',
          entity: 'KycSubmission',
          entityId: submissionId,
          before: { kycStatus: user.kycStatus },
          after: { kycStatus: 'PENDING', documents: stored.map((s) => ({ id: s.id, type: s.type, mime: s.mime, size: s.size })) },
          ip: input.meta?.ip,
          userAgent: input.meta?.userAgent,
        },
        tx,
      );
      await notifyTemplate(user.id, 'kycSubmitted', {}, '/account/verification', tx);
      return tx.kycSubmission.findUniqueOrThrow({ where: { id: submissionId } });
    });
    // Crypto-shred replaced documents (best effort; rows already soft-deleted).
    await Promise.all(replacedKeys.map((k) => storage.delete('private', k).catch(() => undefined)));
    return submission;
  } catch (err) {
    await Promise.all(stored.map((s) => storage.delete('private', s.key).catch(() => undefined)));
    throw err;
  }
}

/** Customer view: status + latest submission (document metadata only, never bytes). */
export async function getKycOverview(userId: string) {
  const [user, submission] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { kycStatus: true, fullName: true, email: true, phone: true } }),
    prisma.kycSubmission.findFirst({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        status: true,
        fullName: true,
        requestedDocs: true,
        reviewNote: true,
        rejectionReason: true,
        submittedAt: true,
        reviewedAt: true,
        documents: { where: { deletedAt: null }, select: { id: true, type: true, mime: true, sizeBytes: true, createdAt: true } },
      },
    }),
  ]);
  return { status: user?.kycStatus ?? ('UNVERIFIED' as KycStatus), user, submission };
}

/** Admin queue (metadata only). Default: submissions awaiting review. */
export async function listKycQueue(opts: { statuses?: KycStatus[]; take?: number; cursor?: string } = {}) {
  const take = Math.min(Math.max(opts.take ?? 50, 1), 200);
  const rows = await prisma.kycSubmission.findMany({
    where: { status: { in: opts.statuses ?? ['PENDING'] } },
    orderBy: [{ submittedAt: 'asc' }, { id: 'asc' }],
    take: take + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    select: {
      id: true,
      status: true,
      fullName: true,
      requestedDocs: true,
      reviewNote: true,
      rejectionReason: true,
      submittedAt: true,
      reviewedAt: true,
      user: { select: { id: true, email: true, phone: true, fullName: true, kycStatus: true, createdAt: true } },
      documents: { where: { deletedAt: null }, select: { id: true, type: true, mime: true, sizeBytes: true, createdAt: true } },
    },
  });
  const hasMore = rows.length > take;
  const items = hasMore ? rows.slice(0, take) : rows;
  return { items, nextCursor: hasMore ? items[items.length - 1]!.id : null };
}

async function reviewerOrThrow(reviewerId: string, permission: 'kyc:documents' | 'kyc:decide') {
  const reviewer = await prisma.user.findUnique({ where: { id: reviewerId }, select: { id: true, role: true, status: true } });
  if (!reviewer || reviewer.status !== 'ACTIVE' || !can(reviewer.role, permission)) throw new KycError('forbidden');
  return reviewer;
}

/**
 * Decrypt a KYC document for an authorised reviewer (`kyc:documents`). Writes a
 * KycAccessLog row (VIEW) and an audit entry on EVERY call — successful or not.
 */
export async function getKycDocumentForReview(docId: string, reviewerId: string, meta: KycMeta = {}) {
  let reviewer: { id: string; role: Role };
  try {
    reviewer = await reviewerOrThrow(reviewerId, 'kyc:documents');
  } catch (err) {
    await logAudit({ actorId: reviewerId, action: 'kyc.document.view.denied', entity: 'KycDocument', entityId: docId, ...meta }).catch(() => undefined);
    throw err;
  }
  const doc = await prisma.kycDocument.findUnique({
    where: { id: docId },
    select: { id: true, submissionId: true, type: true, storageKey: true, iv: true, authTag: true, mime: true, sha256: true, deletedAt: true },
  });
  await prisma.kycAccessLog.create({
    data: {
      submissionId: doc?.submissionId ?? null,
      documentId: doc?.id ?? null,
      actorId: reviewer.id,
      action: doc && !doc.deletedAt ? 'VIEW' : 'VIEW_MISSING',
      ip: meta.ip ?? null,
      userAgent: meta.userAgent ?? null,
    },
  });
  if (!doc || doc.deletedAt) throw new KycError('not_found');
  await logAudit({
    actorId: reviewer.id,
    actorRole: reviewer.role,
    action: 'kyc.document.view',
    entity: 'KycDocument',
    entityId: doc.id,
    after: { submissionId: doc.submissionId, type: doc.type },
    ...meta,
  });
  const ciphertext = await getStorage().get('private', doc.storageKey);
  if (!ciphertext) throw new KycError('not_found');
  const bytes = decryptBuffer({ ciphertext, iv: doc.iv, authTag: doc.authTag }, doc.id);
  if (sha256Hex(bytes) !== doc.sha256) throw new KycError('integrity_failed');
  return { bytes, mime: doc.mime, type: doc.type, submissionId: doc.submissionId };
}

const DOC_TOKEN_PURPOSE = 'kyc-doc';
const DOC_TOKEN_TTL = '5m';

/**
 * Short-lived (5 min) link to the authorised document route, bound to the reviewer:
 * `/api/kyc/document/<id>?t=<token>`. The route still requires the reviewer's session
 * and permission; the token only narrows a leaked URL's lifetime.
 */
export async function kycDocumentUrl(docId: string, reviewerId: string): Promise<string> {
  const t = await signToken({ doc: docId, sub: reviewerId }, { purpose: DOC_TOKEN_PURPOSE, expiresIn: DOC_TOKEN_TTL });
  return `/api/kyc/document/${encodeURIComponent(docId)}?t=${encodeURIComponent(t)}`;
}

export async function verifyKycDocumentToken(token: string, docId: string, reviewerId: string): Promise<boolean> {
  try {
    const payload = (await verifyToken(token, DOC_TOKEN_PURPOSE)) as Record<string, unknown> | null;
    return !!payload && payload.doc === docId && payload.sub === reviewerId;
  } catch {
    return false;
  }
}

export const decideKycSchema = z
  .object({
    submissionId: z.string().min(1).max(64),
    decision: z.enum(KYC_DECISIONS),
    notes: z.string().trim().max(2000).optional().default(''),
    reviewerId: z.string().min(1).max(64),
    requestedDocs: z.array(z.enum(['ID_FRONT', 'ID_BACK', 'SELFIE'])).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.decision !== 'VERIFIED' && v.notes.length < 3) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['notes'], message: 'notes_required' });
    if (v.decision === 'DOCUMENTS_REQUESTED' && !v.requestedDocs?.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['requestedDocs'], message: 'requested_docs_required' });
    }
  });

/**
 * Decide a PENDING submission (`kyc:decide`): VERIFIED, REJECTED (notes = reason shown to
 * the customer) or DOCUMENTS_REQUESTED (notes + requestedDocs). Audited, access-logged,
 * notifies the customer.
 */
export async function decideKyc(input: {
  submissionId: string;
  decision: KycDecision;
  notes?: string;
  reviewerId: string;
  requestedDocs?: KycDocumentType[];
  meta?: KycMeta;
}) {
  const parsed = decideKycSchema.safeParse(input);
  if (!parsed.success) {
    const code = parsed.error.issues[0]?.message;
    throw new KycError(code === 'requested_docs_required' ? 'requested_docs_required' : 'notes_required');
  }
  const v = parsed.data;
  const reviewer = await reviewerOrThrow(v.reviewerId, 'kyc:decide');
  return prisma.$transaction(async (tx) => {
    const sub = await tx.kycSubmission.findUnique({ where: { id: v.submissionId }, include: { user: { select: { id: true, kycStatus: true } } } });
    if (!sub) throw new KycError('not_found');
    if (sub.status !== 'PENDING') throw new KycError('not_reviewable');
    const data: Prisma.KycSubmissionUpdateInput = {
      status: v.decision,
      reviewedAt: new Date(),
      reviewedBy: { connect: { id: reviewer.id } },
      reviewNote: v.notes || null,
      rejectionReason: v.decision === 'REJECTED' ? v.notes : null,
      requestedDocs: v.decision === 'DOCUMENTS_REQUESTED' ? v.requestedDocs : [],
    };
    const updated = await tx.kycSubmission.update({ where: { id: sub.id }, data });
    await tx.user.update({ where: { id: sub.userId }, data: { kycStatus: v.decision } });
    await tx.kycAccessLog.create({
      data: { submissionId: sub.id, actorId: reviewer.id, action: `DECIDE:${v.decision}`, ip: input.meta?.ip ?? null, userAgent: input.meta?.userAgent ?? null },
    });
    await logAudit(
      {
        actorId: reviewer.id,
        actorRole: reviewer.role,
        action: 'kyc.decide',
        entity: 'KycSubmission',
        entityId: sub.id,
        before: { status: sub.status, userKycStatus: sub.user.kycStatus },
        after: { status: v.decision, notes: v.notes || null, requestedDocs: v.requestedDocs ?? [] },
        ip: input.meta?.ip,
        userAgent: input.meta?.userAgent,
      },
      tx,
    );
    const template = v.decision === 'VERIFIED' ? 'kycVerified' : v.decision === 'REJECTED' ? 'kycRejected' : 'kycDocumentsRequested';
    await notifyTemplate(sub.userId, template, {}, '/account/verification', tx);
    return updated;
  });
}

/** Retention (days) from the `kyc.retentionDays` setting; null when not configured. */
export async function getKycRetentionDays(): Promise<number | null> {
  const row = await prisma.setting.findUnique({ where: { key: KYC_SETTING_KEYS.retentionDays } });
  return row ? parseIntSetting(row.value, 1, 3650) : null;
}

/**
 * Data minimisation: crypto-shred (delete ciphertext) documents of
 *  - REJECTED submissions reviewed more than `olderThanDays` ago, and
 *  - obsolete submissions: any non-VERIFIED submission of a user who has a newer VERIFIED one.
 * Rows are kept (soft-deleted, `deletedAt`) for the audit trail. Falls back to the
 * `kyc.retentionDays` setting; does nothing when neither is set.
 */
export async function purgeKycDocuments(olderThanDays?: number, opts: { actorId?: string } = {}) {
  const days = olderThanDays ?? (await getKycRetentionDays());
  if (!days || days < 1) return { skipped: 'retention_not_configured' as const, purged: 0 };
  const cutoff = new Date(Date.now() - days * 24 * 3600 * 1000);
  const verifiedUsers = await prisma.kycSubmission.findMany({ where: { status: 'VERIFIED' }, select: { userId: true, submittedAt: true } });
  const latestVerified = new Map<string, Date>();
  for (const v of verifiedUsers) {
    const prev = latestVerified.get(v.userId);
    if (!prev || prev < v.submittedAt) latestVerified.set(v.userId, v.submittedAt);
  }
  const candidates = await prisma.kycDocument.findMany({
    where: {
      deletedAt: null,
      submission: {
        OR: [
          { status: 'REJECTED', reviewedAt: { lt: cutoff } },
          { status: { not: 'VERIFIED' }, userId: { in: [...latestVerified.keys()] } },
        ],
      },
    },
    select: { id: true, storageKey: true, submissionId: true, submission: { select: { userId: true, status: true, submittedAt: true } } },
  });
  const toPurge = candidates.filter((d) => {
    if (d.submission.status === 'REJECTED') return true;
    const v = latestVerified.get(d.submission.userId);
    return !!v && v > d.submission.submittedAt;
  });
  const storage = getStorage();
  let purged = 0;
  for (const d of toPurge) {
    await storage.delete('private', d.storageKey);
    await prisma.kycDocument.update({ where: { id: d.id }, data: { deletedAt: new Date() } });
    if (opts.actorId) {
      await prisma.kycAccessLog.create({ data: { submissionId: d.submissionId, documentId: d.id, actorId: opts.actorId, action: 'DELETE' } });
    }
    purged++;
  }
  if (purged) {
    await logAudit({ actorId: opts.actorId ?? null, action: 'kyc.documents.purge', entity: 'KycDocument', after: { purged, olderThanDays: days } });
  }
  return { skipped: null, purged };
}
