import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { GiftCardStatus, Role } from '@prisma/client';
import { prisma } from '@/lib/db';
import { logAudit } from '@/lib/audit';
import { can } from '@/lib/rbac';
import { decryptBuffer, decryptString, encryptBuffer, encryptString, fingerprint } from '@/lib/crypto';
import { buildKey, getStorage, sniffMime } from '@/lib/storage';
import { MoneyError } from '@/lib/wallet/errors';
import { ensureWallet, withLedgerTx } from '@/lib/wallet/ledger';
import { confirmPaymentIntent } from './core';
import { notifyMoney } from './notify';

/**
 * Gift cards → DOOM Wallet. Flow (SPEC): customer submits brand + code (+ optional photo)
 * → code encrypted at rest (AES-256-GCM, AAD = submission id), status SUBMITTED, NEVER
 * credited on submission → finance staff encash the card and record the value ACTUALLY
 * encashed → `reviewGiftCard(VERIFIED)` atomically creates a GIFT_CARD PaymentIntent,
 * confirms it and posts GIFT_CARD_CLEARING → CUSTOMER_WALLET (idempotent: the intent key and
 * the ledger key are derived from the submission id, so a card can never be credited twice).
 */

export const GIFT_CARD_BRANDS = [
  'APPLE',
  'GOOGLE_PLAY',
  'PLAYSTATION',
  'XBOX',
  'STEAM',
  'NINTENDO',
  'AMAZON',
  'NETFLIX',
  'RAZER_GOLD',
  'OTHER',
] as const;
export type GiftCardBrand = (typeof GIFT_CARD_BRANDS)[number];

/** Currencies a card can be denominated in; minor units per currency. */
export const GIFT_CARD_CURRENCIES = { OMR: 3, USD: 2, EUR: 2, GBP: 2, AED: 2, SAR: 2 } as const;
export type GiftCardCurrency = keyof typeof GIFT_CARD_CURRENCIES;

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
/** Open submissions per customer (anti-abuse). */
export const MAX_OPEN_GIFT_CARDS = 5;

/** Parse "25", "25.5", "25,50" in the card currency to minor units (no floats). */
export function parseMinorUnits(input: string, currency: GiftCardCurrency): number | null {
  const digits = GIFT_CARD_CURRENCIES[currency];
  const s = input.trim().replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d))).replace(',', '.');
  const m = new RegExp(`^(\\d{1,7})(?:\\.(\\d{1,${digits}}))?$`).exec(s);
  if (!m) return null;
  const value = Number(m[1]) * 10 ** digits + Number((m[2] ?? '').padEnd(digits, '0') || '0');
  return Number.isSafeInteger(value) && value > 0 ? value : null;
}

export const giftCardInputSchema = z.object({
  brand: z.enum(GIFT_CARD_BRANDS, { errorMap: () => ({ message: 'giftcard_brand_invalid' }) }),
  code: z
    .string({ required_error: 'required' })
    .transform((v) => v.normalize('NFKC').replace(/\s+/g, '').toUpperCase())
    .pipe(z.string().min(6, 'giftcard_code_invalid').max(64, 'giftcard_code_invalid').regex(/^[A-Z0-9-]+$/, 'giftcard_code_invalid')),
  currency: z.enum(Object.keys(GIFT_CARD_CURRENCIES) as [GiftCardCurrency, ...GiftCardCurrency[]], {
    errorMap: () => ({ message: 'giftcard_currency_invalid' }),
  }),
  /** Face value as typed by the customer, in the card currency. */
  value: z.string({ required_error: 'required' }).trim().min(1, 'required').max(20, 'amount_invalid'),
});

export type GiftCardInput = z.input<typeof giftCardInputSchema>;

function newSubmissionId(): string {
  return `gc${randomBytes(12).toString('hex')}`;
}

/** Store an encrypted image as `iv(12) | tag(16) | ciphertext` in the private bucket. */
function packEncrypted(blob: { ciphertext: Buffer; iv: string; authTag: string }): Buffer {
  return Buffer.concat([Buffer.from(blob.iv, 'base64'), Buffer.from(blob.authTag, 'base64'), blob.ciphertext]);
}

function unpackEncrypted(buf: Buffer): { ciphertext: Buffer; iv: string; authTag: string } {
  return { iv: buf.subarray(0, 12).toString('base64'), authTag: buf.subarray(12, 28).toString('base64'), ciphertext: buf.subarray(28) };
}

export type SubmitGiftCardResult = { id: string; status: GiftCardStatus; replayed: boolean };

/**
 * Customer submission. Validates, rejects duplicate codes (keyed fingerprint), encrypts the
 * code and optional photo, stores the submission as SUBMITTED. Never credits anything.
 * Idempotent: the same customer re-submitting an open card gets the existing submission.
 */
export async function submitGiftCard(input: {
  userId: string;
  data: GiftCardInput;
  photo?: Buffer | null;
}): Promise<SubmitGiftCardResult> {
  const parsed = giftCardInputSchema.safeParse(input.data);
  if (!parsed.success) {
    throw new MoneyError('invalid_input', 'Invalid gift card', { fieldErrors: parsed.error.flatten().fieldErrors });
  }
  const { brand, code, currency, value } = parsed.data;
  const declaredValue = parseMinorUnits(value, currency);
  if (declaredValue === null) throw new MoneyError('invalid_amount', 'Invalid face value', { fieldErrors: { value: ['amount_invalid'] } });
  if (declaredValue > 5_000 * 10 ** GIFT_CARD_CURRENCIES[currency]) {
    throw new MoneyError('amount_above_maximum', 'Face value too large', { fieldErrors: { value: ['amount_too_large'] } });
  }

  const user = await prisma.user.findUnique({ where: { id: input.userId }, select: { status: true } });
  if (!user || user.status !== 'ACTIVE') throw new MoneyError('forbidden');

  const fp = fingerprint(code, 'giftcard');
  const previous = await prisma.giftCardSubmission.findFirst({
    where: { codeFingerprint: fp, status: { in: ['SUBMITTED', 'UNDER_REVIEW', 'VERIFIED'] } },
    select: { id: true, userId: true, status: true },
  });
  if (previous) {
    // The same customer re-sending the same open card (double click, retry, back + resubmit) → replay.
    if (previous.userId === input.userId && previous.status !== 'VERIFIED') return { id: previous.id, status: previous.status, replayed: true };
    throw new MoneyError('duplicate_code', 'This gift card code was already submitted');
  }

  const open = await prisma.giftCardSubmission.count({ where: { userId: input.userId, status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } } });
  if (open >= MAX_OPEN_GIFT_CARDS) throw new MoneyError('invalid_input', 'Too many gift cards awaiting review', { reason: 'too_many_open' });

  const id = newSubmissionId();
  let imageKey: string | null = null;
  if (input.photo && input.photo.length > 0) {
    if (input.photo.length > MAX_IMAGE_BYTES) throw new MoneyError('invalid_image', 'Image too large');
    const mime = sniffMime(input.photo);
    if (!mime || !IMAGE_TYPES.has(mime)) throw new MoneyError('invalid_image', 'Unsupported image type');
    imageKey = buildKey(`giftcards/${input.userId.toLowerCase()}`, 'bin');
    const encrypted = encryptBuffer(input.photo, `giftcard-image:${id}:${mime}`);
    await getStorage().put('private', imageKey, packEncrypted(encrypted), { contentType: 'application/octet-stream' });
    imageKey = `${imageKey}#${mime}`;
  }

  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.giftCardSubmission.create({
      data: {
        id,
        userId: input.userId,
        brand,
        codeEncrypted: encryptString(code, `giftcard:${id}`),
        codeLast4: code.slice(-4),
        codeFingerprint: fp,
        declaredValue,
        declaredCurrency: currency,
        imageKey,
        status: 'SUBMITTED',
      },
      select: { id: true, status: true },
    });
    await logAudit(
      {
        actorId: input.userId,
        actorRole: 'CUSTOMER',
        action: 'giftcard.submit',
        entity: 'GiftCardSubmission',
        entityId: id,
        after: { brand, declaredValue, currency, hasImage: !!imageKey },
      },
      tx,
    );
    return created;
  });
  return { id: row.id, status: row.status, replayed: false };
}

export type ReviewDecision = 'UNDER_REVIEW' | 'VERIFIED' | 'REJECTED';

export type ReviewGiftCardResult = {
  id: string;
  status: GiftCardStatus;
  /** Ledger credit (VERIFIED only). */
  paymentIntentId: string | null;
  creditedBaisa: number | null;
  replayed: boolean;
};

async function reviewer(reviewerId: string): Promise<{ id: string; role: Role }> {
  const u = await prisma.user.findUnique({ where: { id: reviewerId }, select: { id: true, role: true, status: true } });
  if (!u || u.status !== 'ACTIVE' || !can(u.role, 'giftcards:review')) throw new MoneyError('forbidden', 'Gift card review requires the FINANCE or ADMIN role');
  return { id: u.id, role: u.role };
}

/**
 * Finance decision on a submission (requires `giftcards:review` = FINANCE / ADMIN / SUPERADMIN;
 * audited). VERIFIED requires the value ACTUALLY encashed (baisa > 0) and credits the wallet
 * atomically and idempotently; REJECTED closes it; UNDER_REVIEW marks it as being processed.
 */
export async function reviewGiftCard(input: {
  id: string;
  decision: ReviewDecision;
  encashedValueBaisa?: number | null;
  notes?: string | null;
  reviewerId: string;
}): Promise<ReviewGiftCardResult> {
  const actor = await reviewer(input.reviewerId);
  const notes = input.notes?.trim().slice(0, 1000) || null;
  if (input.decision === 'VERIFIED') {
    const v = input.encashedValueBaisa;
    if (typeof v !== 'number' || !Number.isSafeInteger(v) || v <= 0 || v > 5_000_000) {
      throw new MoneyError('invalid_amount', 'encashedValueBaisa (the value actually encashed) is required');
    }
  }

  const current = await prisma.giftCardSubmission.findUnique({ where: { id: input.id }, select: { userId: true } });
  if (!current) throw new MoneyError('not_found');
  if (current.userId === actor.id) throw new MoneyError('self_review', 'Staff cannot review their own gift card');
  await ensureWallet(current.userId);

  const result = await withLedgerTx(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "GiftCardSubmission" WHERE "id" = ${input.id} FOR UPDATE`;
    const card = await tx.giftCardSubmission.findUniqueOrThrow({ where: { id: input.id } });
    if (card.status === 'VERIFIED') {
      if (input.decision === 'VERIFIED' && card.encashedValueBaisa === input.encashedValueBaisa) {
        return { id: card.id, status: card.status, paymentIntentId: card.paymentIntentId, creditedBaisa: card.encashedValueBaisa, replayed: true };
      }
      throw new MoneyError('already_decided', 'Gift card already verified and credited');
    }
    if (card.status === 'REJECTED') {
      if (input.decision === 'REJECTED') return { id: card.id, status: card.status, paymentIntentId: null, creditedBaisa: null, replayed: true };
      throw new MoneyError('already_decided', 'Gift card already rejected');
    }
    const before = { status: card.status, encashedValueBaisa: card.encashedValueBaisa };

    if (input.decision === 'UNDER_REVIEW') {
      await tx.giftCardSubmission.update({ where: { id: card.id }, data: { status: 'UNDER_REVIEW', reviewedById: actor.id, notes: notes ?? card.notes } });
      await logAudit(
        { actorId: actor.id, actorRole: actor.role, action: 'giftcard.review.start', entity: 'GiftCardSubmission', entityId: card.id, before, after: { status: 'UNDER_REVIEW' } },
        tx,
      );
      return { id: card.id, status: 'UNDER_REVIEW' as const, paymentIntentId: null, creditedBaisa: null, replayed: false };
    }

    if (input.decision === 'REJECTED') {
      await tx.giftCardSubmission.update({
        where: { id: card.id },
        data: { status: 'REJECTED', reviewedById: actor.id, reviewedAt: new Date(), notes },
      });
      await logAudit(
        { actorId: actor.id, actorRole: actor.role, action: 'giftcard.reject', entity: 'GiftCardSubmission', entityId: card.id, before, after: { status: 'REJECTED', notes } },
        tx,
      );
      await notifyMoney(card.userId, 'giftCardRejected', {}, '/wallet?filter=rejected', tx);
      return { id: card.id, status: 'REJECTED' as const, paymentIntentId: null, creditedBaisa: null, replayed: false };
    }

    // VERIFIED: the encashed value is credited through the single confirmation path.
    const value = input.encashedValueBaisa as number;
    const intent = await tx.paymentIntent.create({
      data: {
        userId: card.userId,
        provider: 'GIFT_CARD',
        purpose: 'TOPUP',
        amountBaisa: value,
        idempotencyKey: `giftcard:${card.id}`,
        status: 'PENDING',
        metadata: { giftCardSubmissionId: card.id, brand: card.brand },
      },
    });
    await tx.giftCardSubmission.update({
      where: { id: card.id },
      data: { status: 'VERIFIED', encashedValueBaisa: value, reviewedById: actor.id, reviewedAt: new Date(), notes, paymentIntentId: intent.id },
    });
    const confirmed = await confirmPaymentIntent(
      intent.id,
      { confirmedAmountBaisa: value, source: 'giftcard.review', actorId: actor.id },
      tx,
    );
    if (confirmed.outcome !== 'succeeded') throw new MoneyError('ledger_integrity', 'Gift card credit failed');
    await logAudit(
      {
        actorId: actor.id,
        actorRole: actor.role,
        action: 'giftcard.verify',
        entity: 'GiftCardSubmission',
        entityId: card.id,
        before,
        after: { status: 'VERIFIED', encashedValueBaisa: value, declaredValue: card.declaredValue, declaredCurrency: card.declaredCurrency, paymentIntentId: intent.id },
      },
      tx,
    );
    await notifyMoney(card.userId, 'giftCardVerified', { amountBaisa: value }, '/wallet', tx);
    return { id: card.id, status: 'VERIFIED' as const, paymentIntentId: intent.id, creditedBaisa: value, replayed: false };
  });
  return result;
}

/** Decrypt a submitted code for the reviewer (permission + audit). */
export async function revealGiftCardCode(input: { id: string; actorId: string }): Promise<string> {
  const actor = await reviewer(input.actorId);
  const card = await prisma.giftCardSubmission.findUnique({ where: { id: input.id }, select: { id: true, codeEncrypted: true, userId: true } });
  if (!card) throw new MoneyError('not_found');
  if (card.userId === actor.id) throw new MoneyError('self_review');
  const code = decryptString(card.codeEncrypted, `giftcard:${card.id}`);
  await logAudit({ actorId: actor.id, actorRole: actor.role, action: 'giftcard.code.reveal', entity: 'GiftCardSubmission', entityId: card.id });
  return code;
}

/** Decrypt the optional photo for the reviewer (permission + audit). */
export async function getGiftCardImage(input: { id: string; actorId: string }): Promise<{ data: Buffer; mime: string } | null> {
  const actor = await reviewer(input.actorId);
  const card = await prisma.giftCardSubmission.findUnique({ where: { id: input.id }, select: { id: true, imageKey: true } });
  if (!card) throw new MoneyError('not_found');
  if (!card.imageKey) return null;
  const [key, mime = 'application/octet-stream'] = card.imageKey.split('#');
  const raw = await getStorage().get('private', key!);
  if (!raw) return null;
  const data = decryptBuffer(unpackEncrypted(raw), `giftcard-image:${card.id}:${mime}`);
  await logAudit({ actorId: actor.id, actorRole: actor.role, action: 'giftcard.image.view', entity: 'GiftCardSubmission', entityId: card.id });
  return { data, mime };
}

/** Review queue for the admin finance centre (no secrets). */
export async function listGiftCardsForReview(opts: { status?: GiftCardStatus[]; take?: number; actorId: string }) {
  await reviewer(opts.actorId);
  return prisma.giftCardSubmission.findMany({
    where: { status: { in: opts.status ?? ['SUBMITTED', 'UNDER_REVIEW'] } },
    orderBy: { createdAt: 'asc' },
    take: Math.min(opts.take ?? 50, 200),
    select: {
      id: true,
      brand: true,
      codeLast4: true,
      declaredValue: true,
      declaredCurrency: true,
      status: true,
      encashedValueBaisa: true,
      createdAt: true,
      reviewedAt: true,
      notes: true,
      imageKey: true,
      user: { select: { id: true, fullName: true, email: true, kycStatus: true } },
    },
  });
}
