/**
 * KYC: magic-byte validation, AES-256-GCM encryption round-trip, reviewer access control +
 * KycAccessLog on every access, decisions (audited, notified), documents-requested flow,
 * retention purge.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/db';
import { decryptBuffer, sha256Hex } from '@/lib/crypto';
import { __setStorageDriverForTests } from '@/lib/storage';
import { decideKyc, getKycDocumentForReview, getKycOverview, isHeic, KycError, kycDocumentUrl, listKycQueue, purgeKycDocuments, submitKyc, validateKycImage, verifyKycDocumentToken } from '@/lib/kyc';
import { cleanup, createAddress, createUser, heicHeader, image, useMemoryStorage, type MemoryStorage } from './fixtures';

let storage: MemoryStorage;
beforeAll(() => {
  storage = useMemoryStorage();
});
afterAll(async () => {
  await cleanup();
  __setStorageDriverForTests(null);
  await prisma.$disconnect();
});

const expectKyc = async (p: Promise<unknown>, code: string) => {
  await expect(p).rejects.toBeInstanceOf(KycError);
  await expect(p).rejects.toMatchObject({ code });
};

async function customerReadyForKyc() {
  const user = await createUser();
  await createAddress(user.id);
  return user;
}

describe('document validation (magic bytes)', () => {
  it('accepts JPEG, PNG and WebP by content, never by name or declared type', async () => {
    expect(validateKycImage(await image('jpeg'))).toEqual({ ok: true, mime: 'image/jpeg' });
    expect(validateKycImage(await image('png'))).toEqual({ ok: true, mime: 'image/png' });
    expect(validateKycImage(await image('webp'))).toEqual({ ok: true, mime: 'image/webp' });
  });

  it('rejects HEIC explicitly, other formats, empty and oversized files', async () => {
    expect(isHeic(heicHeader())).toBe(true);
    expect(validateKycImage(heicHeader())).toEqual({ ok: false, code: 'heic_unsupported' });
    expect(validateKycImage(Buffer.from('%PDF-1.7 fake document content'))).toEqual({ ok: false, code: 'unsupported_type' });
    expect(validateKycImage(Buffer.from('GIF89a......................'))).toEqual({ ok: false, code: 'unsupported_type' });
    expect(validateKycImage(Buffer.alloc(0))).toEqual({ ok: false, code: 'empty' });
    const big = Buffer.concat([await image('jpeg'), Buffer.alloc(8 * 1024 * 1024)]);
    expect(validateKycImage(big)).toEqual({ ok: false, code: 'too_large' });
  });
});

describe('submission, encryption and reviewer access', () => {
  it('encrypts each document (AAD = document id) and logs every reviewer access', async () => {
    const user = await customerReadyForKyc();
    const admin = await createUser({ role: 'ADMIN' });
    const support = await createUser({ role: 'SUPPORT' });
    const files = { ID_FRONT: await image('jpeg', 80), ID_BACK: await image('png', 72), SELFIE: await image('webp', 96) };

    const sub = await submitKyc({ userId: user.id, fullName: 'Fatma Al Hinai', files });
    expect(sub.status).toBe('PENDING');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus).toBe('PENDING');
    const docs = await prisma.kycDocument.findMany({ where: { submissionId: sub.id } });
    expect(docs.map((d) => d.type).sort()).toEqual(['ID_BACK', 'ID_FRONT', 'SELFIE']);

    for (const d of docs) {
      const plain = files[d.type];
      const blob = await storage.get('private', d.storageKey);
      expect(d.storageKey.startsWith('kyc/')).toBe(true);
      expect(blob).not.toBeNull();
      expect(blob!.equals(plain)).toBe(false); // ciphertext at rest
      expect(d.sha256).toBe(sha256Hex(plain));
      expect(d.sizeBytes).toBe(plain.length);
      // round-trip with the right AAD only
      expect(decryptBuffer({ ciphertext: blob!, iv: d.iv, authTag: d.authTag }, d.id).equals(plain)).toBe(true);
      expect(() => decryptBuffer({ ciphertext: blob!, iv: d.iv, authTag: d.authTag }, 'other-id')).toThrow();
    }

    // a second submission while pending is refused
    await expectKyc(submitKyc({ userId: user.id, fullName: 'Fatma Al Hinai', files }), 'already_pending');

    // queue exposes metadata only
    const queue = await listKycQueue({ take: 200 });
    const entry = queue.items.find((i) => i.id === sub.id);
    expect(entry?.documents).toHaveLength(3);
    expect(JSON.stringify(entry)).not.toMatch(/storageKey|authTag|"iv"/);

    // SUPPORT (kyc:read only) and the customer cannot open documents — attempts are audited, nothing decrypted
    const front = docs.find((d) => d.type === 'ID_FRONT')!;
    await expectKyc(getKycDocumentForReview(front.id, support.id), 'forbidden');
    await expectKyc(getKycDocumentForReview(front.id, user.id), 'forbidden');
    expect(await prisma.auditLog.count({ where: { action: 'kyc.document.view.denied', entityId: front.id } })).toBe(2);

    // ADMIN (kyc:documents) gets the decrypted bytes; each access writes KycAccessLog + audit
    const before = await prisma.kycAccessLog.count({ where: { documentId: front.id } });
    const got = await getKycDocumentForReview(front.id, admin.id, { ip: '10.1.2.3', userAgent: 'vitest' });
    expect(got.bytes.equals(files.ID_FRONT)).toBe(true);
    expect(got.mime).toBe('image/jpeg');
    await getKycDocumentForReview(front.id, admin.id);
    const logs = await prisma.kycAccessLog.findMany({ where: { documentId: front.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.length - before).toBe(2);
    expect(logs[0]).toMatchObject({ actorId: admin.id, action: 'VIEW', ip: '10.1.2.3', userAgent: 'vitest', submissionId: sub.id });
    expect(await prisma.auditLog.count({ where: { action: 'kyc.document.view', entityId: front.id, actorId: admin.id } })).toBe(2);

    // tampered ciphertext fails closed
    const blob = await storage.get('private', front.storageKey);
    const tampered = Buffer.from(blob!);
    tampered[0] = tampered[0]! ^ 0xff;
    await storage.put('private', front.storageKey, tampered);
    await expect(getKycDocumentForReview(front.id, admin.id)).rejects.toThrow();
    await storage.put('private', front.storageKey, blob!);

    // short-lived links are bound to the document and the reviewer
    const url = await kycDocumentUrl(front.id, admin.id);
    const token = new URL(url, 'http://x').searchParams.get('t')!;
    expect(url.startsWith(`/api/kyc/document/${front.id}?t=`)).toBe(true);
    expect(await verifyKycDocumentToken(token, front.id, admin.id)).toBe(true);
    expect(await verifyKycDocumentToken(token, front.id, support.id)).toBe(false);
    expect(await verifyKycDocumentToken(token, 'another-doc', admin.id)).toBe(false);
  });

  it('requires a phone, an address and every document, and validates each file', async () => {
    const noPhone = await createUser({ phone: false });
    await createAddress(noPhone.id);
    const files = { ID_FRONT: await image(), ID_BACK: await image(), SELFIE: await image() };
    await expectKyc(submitKyc({ userId: noPhone.id, fullName: 'No Phone', files }), 'phone_required');
    const noAddress = await createUser();
    await expectKyc(submitKyc({ userId: noAddress.id, fullName: 'No Address', files }), 'address_required');
    const user = await customerReadyForKyc();
    await expect(submitKyc({ userId: user.id, fullName: 'Bad', files: { ...files, SELFIE: heicHeader() } })).rejects.toMatchObject({ code: 'heic_unsupported', field: 'SELFIE' });
    await expect(submitKyc({ userId: user.id, fullName: 'Missing', files: { ID_FRONT: files.ID_FRONT } })).rejects.toMatchObject({ code: 'missing_document', field: 'ID_BACK' });
    expect(await prisma.kycSubmission.count({ where: { userId: user.id } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus).toBe('UNVERIFIED');
  });
});

describe('decisions', () => {
  it('handles documents requested → resubmission → verified, audited and notified', async () => {
    const user = await customerReadyForKyc();
    const admin = await createUser({ role: 'ADMIN' });
    const finance = await createUser({ role: 'FINANCE' });
    const files = { ID_FRONT: await image('jpeg', 40), ID_BACK: await image('jpeg', 41), SELFIE: await image('jpeg', 42) };
    const sub = await submitKyc({ userId: user.id, fullName: 'Salim Al Rawahi', files });

    await expectKyc(decideKyc({ submissionId: sub.id, decision: 'VERIFIED', reviewerId: finance.id }), 'forbidden');
    await expectKyc(decideKyc({ submissionId: sub.id, decision: 'REJECTED', notes: '', reviewerId: admin.id }), 'notes_required');
    await expectKyc(decideKyc({ submissionId: sub.id, decision: 'DOCUMENTS_REQUESTED', notes: 'Blurry back side', reviewerId: admin.id }), 'requested_docs_required');

    await decideKyc({ submissionId: sub.id, decision: 'DOCUMENTS_REQUESTED', notes: 'The back side is blurry', requestedDocs: ['ID_BACK'], reviewerId: admin.id });
    let overview = await getKycOverview(user.id);
    expect(overview.status).toBe('DOCUMENTS_REQUESTED');
    expect(overview.submission).toMatchObject({ requestedDocs: ['ID_BACK'], reviewNote: 'The back side is blurry' });
    expect(await prisma.notification.count({ where: { userId: user.id, type: 'kyc.decision' } })).toBe(1);
    await expectKyc(decideKyc({ submissionId: sub.id, decision: 'VERIFIED', reviewerId: admin.id }), 'not_reviewable');

    // only the requested document is needed; the replaced one is crypto-shredded
    const oldBack = await prisma.kycDocument.findFirstOrThrow({ where: { submissionId: sub.id, type: 'ID_BACK' } });
    const newBack = await image('png', 50);
    await submitKyc({ userId: user.id, fullName: 'Salim Al Rawahi', files: { ID_BACK: newBack } });
    expect(await storage.exists('private', oldBack.storageKey)).toBe(false);
    expect((await prisma.kycDocument.findUniqueOrThrow({ where: { id: oldBack.id } })).deletedAt).toBeInstanceOf(Date);
    overview = await getKycOverview(user.id);
    expect(overview.status).toBe('PENDING');
    expect(overview.submission?.id).toBe(sub.id);
    expect(overview.submission?.documents.map((d) => d.type).sort()).toEqual(['ID_BACK', 'ID_FRONT', 'SELFIE']);

    await decideKyc({ submissionId: sub.id, decision: 'VERIFIED', notes: '', reviewerId: admin.id, meta: { ip: '10.9.9.9', userAgent: 'vitest' } });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: user.id } })).kycStatus).toBe('VERIFIED');
    expect(await prisma.kycAccessLog.count({ where: { submissionId: sub.id, action: 'DECIDE:VERIFIED', actorId: admin.id } })).toBe(1);
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'kyc.decide', entityId: sub.id, after: { path: ['status'], equals: 'VERIFIED' } } });
    expect(audit.before).toMatchObject({ status: 'PENDING' });
    await expectKyc(submitKyc({ userId: user.id, fullName: 'Again', files }), 'already_verified');
  });

  it('purges rejected documents after the retention period (rows kept for the audit trail)', async () => {
    const user = await customerReadyForKyc();
    const admin = await createUser({ role: 'ADMIN' });
    const sub = await submitKyc({ userId: user.id, fullName: 'Old Rejected', files: { ID_FRONT: await image(), ID_BACK: await image(), SELFIE: await image() } });
    await decideKyc({ submissionId: sub.id, decision: 'REJECTED', notes: 'Document expired', reviewerId: admin.id });
    expect((await getKycOverview(user.id)).submission?.rejectionReason).toBe('Document expired');
    const docs = await prisma.kycDocument.findMany({ where: { submissionId: sub.id } });

    // not old enough yet
    await purgeKycDocuments(30, { actorId: admin.id });
    expect(await storage.exists('private', docs[0]!.storageKey)).toBe(true);

    await prisma.kycSubmission.update({ where: { id: sub.id }, data: { reviewedAt: new Date(Date.now() - 40 * 24 * 3600 * 1000) } });
    const res = await purgeKycDocuments(30, { actorId: admin.id });
    expect(res.purged).toBeGreaterThanOrEqual(3);
    for (const d of docs) {
      expect(await storage.exists('private', d.storageKey)).toBe(false);
      expect((await prisma.kycDocument.findUniqueOrThrow({ where: { id: d.id } })).deletedAt).toBeInstanceOf(Date);
    }
    expect(await prisma.kycAccessLog.count({ where: { submissionId: sub.id, action: 'DELETE' } })).toBe(3);
    // a purged document can no longer be opened (and the attempt is logged)
    await expectKyc(getKycDocumentForReview(docs[0]!.id, admin.id), 'not_found');
    expect(await prisma.kycAccessLog.count({ where: { documentId: docs[0]!.id, action: 'VIEW_MISSING' } })).toBe(1);
  });
});
