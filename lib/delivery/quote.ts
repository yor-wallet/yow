import { Prisma, type DeliveryZone } from '@prisma/client';
import { prisma, type Db } from '../db';
import { getDeliverySettings, VOLUMETRIC_DIVISOR, type DeliverySettings } from './settings';
import { addHours, muscatHour, startOfMuscatDay } from './time';

/**
 * DOOM EXPRESS quote engine.
 *
 * Fee (all integers, baisa):
 *   chargeable weight = max(actual weight, volumetric weight)   volumetric g = ceil(volume cm³ × 1000 / 5000)
 *   weight part       = perKgBaisa × ceil(max(0, chargeable − includedWeightGrams) / 1000)   (if perKgBaisa set)
 *   volume part       = perLitreBaisa × ceil(volume cm³ / 1000)                               (if perLitreBaisa set)
 *   STANDARD          = standardFeeBaisa + weight + volume   (0 when subtotal ≥ freeStandardFromBaisa)
 *   EXPRESS           = standardFeeBaisa + weight + volume + expressFeeBaisa (express surcharge)
 *
 * Never invents a fee: a NULL fee makes that delivery type unavailable. EXPRESS is
 * offered only when enabled on the zone, eligible, capacity configured and not yet
 * reached today (Muscat day) and before the configured cut-off hour.
 * The promised ETA is exactly the zone's configured hours.
 */

export type DeliveryTypeInput = 'STANDARD' | 'EXPRESS';

export type QuoteUnavailableReason =
  | 'invalid_input'
  | 'zone_not_found'
  | 'zone_inactive'
  | 'not_configured'
  | 'express_not_offered'
  | 'not_express_eligible'
  | 'parcel_unknown'
  | 'capacity_full'
  | 'capacity_not_configured'
  | 'after_cutoff';

export const QUOTE_UNAVAILABLE_REASONS: readonly QuoteUnavailableReason[] = [
  'invalid_input',
  'zone_not_found',
  'zone_inactive',
  'not_configured',
  'express_not_offered',
  'not_express_eligible',
  'parcel_unknown',
  'capacity_full',
  'capacity_not_configured',
  'after_cutoff',
];

export type QuoteBreakdown = {
  baseBaisa: number;
  weightBaisa: number;
  volumeBaisa: number;
  expressBaisa: number;
  freeStandardApplied: boolean;
  chargeableWeightGrams: number | null;
};

export type DeliveryQuote = {
  available: boolean;
  type: DeliveryTypeInput;
  feeBaisa?: number;
  etaHours?: number;
  promisedBy?: Date;
  reason?: QuoteUnavailableReason;
  zoneId?: string;
  breakdown?: QuoteBreakdown;
  /** Remaining same-day capacity for this type (null = unlimited / not tracked). */
  remainingToday?: number | null;
};

export type QuoteInput = {
  /** Any of zoneId / wilayaId / governorateId (wilaya is the most precise). */
  zoneId?: string;
  wilayaId?: string;
  governorateId?: string;
  /** Total actual weight of the parcel in grams (null/undefined = unknown). */
  weightGrams?: number | null;
  /** Total volume of the parcel in cm³ (null/undefined = unknown). */
  volumeCm3?: number | null;
  type: DeliveryTypeInput;
  /** Quote time (default now). */
  at?: Date;
  /** Order subtotal (enables the zone's free-standard threshold). */
  subtotalBaisa?: number;
  /** False when at least one item is not express-eligible (Product.expressEligible). */
  expressEligible?: boolean;
};

export type ZoneConfig = Pick<
  DeliveryZone,
  | 'id'
  | 'isActive'
  | 'standardFeeBaisa'
  | 'expressFeeBaisa'
  | 'expressAvailable'
  | 'standardHours'
  | 'expressHours'
  | 'perKgBaisa'
  | 'perLitreBaisa'
  | 'freeStandardFromBaisa'
  | 'dailyCapacityStandard'
  | 'dailyCapacityExpress'
>;

export type QuoteContext = {
  now: Date;
  settings: DeliverySettings;
  /** Deliveries of this type already booked today in this zone. */
  usedToday: number;
};

function nonNegInt(v: number | null | undefined): number | null | 'invalid' {
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return 'invalid';
  return Math.ceil(v);
}

/** Volumetric weight in grams for a volume in cm³ (5000 cm³ = 1 kg). */
export function volumetricWeightGrams(volumeCm3: number): number {
  return Math.ceil((volumeCm3 * 1000) / VOLUMETRIC_DIVISOR);
}

/** Pure quote computation (no I/O) — unit tested. */
export function computeQuote(zone: ZoneConfig | null, input: QuoteInput, ctx: QuoteContext): DeliveryQuote {
  const type = input.type;
  if (type !== 'STANDARD' && type !== 'EXPRESS') return { available: false, type, reason: 'invalid_input' };
  if (!zone) return { available: false, type, reason: 'zone_not_found' };
  const zoneId = zone.id;
  const no = (reason: QuoteUnavailableReason): DeliveryQuote => ({ available: false, type, reason, zoneId });

  if (!zone.isActive) return no('zone_inactive');
  const weight = nonNegInt(input.weightGrams);
  const volume = nonNegInt(input.volumeCm3);
  if (weight === 'invalid' || volume === 'invalid') return no('invalid_input');
  if (input.subtotalBaisa !== undefined && (!Number.isSafeInteger(input.subtotalBaisa) || input.subtotalBaisa < 0)) {
    return no('invalid_input');
  }

  // Base fee is required for both types (express = base + surcharge).
  if (zone.standardFeeBaisa === null) return no('not_configured');

  if (type === 'EXPRESS') {
    if (!zone.expressAvailable) return no('express_not_offered');
    if (input.expressEligible === false) return no('not_express_eligible');
    if (zone.expressFeeBaisa === null) return no('not_configured');
  }

  // Parcel-dependent rates need the parcel data; never guess weights.
  if (zone.perKgBaisa !== null && weight === null) return no('parcel_unknown');
  if (zone.perLitreBaisa !== null && volume === null) return no('parcel_unknown');

  const chargeable =
    weight === null && volume === null ? null : Math.max(weight ?? 0, volume !== null ? volumetricWeightGrams(volume) : 0);
  const overGrams = chargeable === null ? 0 : Math.max(0, chargeable - ctx.settings.includedWeightGrams);
  const weightBaisa = zone.perKgBaisa !== null ? zone.perKgBaisa * Math.ceil(overGrams / 1000) : 0;
  const volumeBaisa = zone.perLitreBaisa !== null && volume !== null ? zone.perLitreBaisa * Math.ceil(volume / 1000) : 0;

  // Capacity & cut-off.
  const capacity = type === 'EXPRESS' ? zone.dailyCapacityExpress : zone.dailyCapacityStandard;
  if (type === 'EXPRESS' && capacity === null) return no('capacity_not_configured');
  if (capacity !== null && ctx.usedToday >= capacity) return no('capacity_full');
  if (type === 'EXPRESS' && ctx.settings.expressCutoffHour !== null && muscatHour(ctx.now) >= ctx.settings.expressCutoffHour) {
    return no('after_cutoff');
  }

  const base = zone.standardFeeBaisa;
  let fee: number;
  let freeStandardApplied = false;
  let expressBaisa = 0;
  if (type === 'STANDARD') {
    fee = base + weightBaisa + volumeBaisa;
    if (zone.freeStandardFromBaisa !== null && input.subtotalBaisa !== undefined && input.subtotalBaisa >= zone.freeStandardFromBaisa) {
      fee = 0;
      freeStandardApplied = true;
    }
  } else {
    expressBaisa = zone.expressFeeBaisa ?? 0;
    fee = base + weightBaisa + volumeBaisa + expressBaisa;
  }
  const etaHours = type === 'EXPRESS' ? zone.expressHours : zone.standardHours;

  return {
    available: true,
    type,
    feeBaisa: fee,
    etaHours,
    promisedBy: addHours(ctx.now, etaHours),
    zoneId,
    remainingToday: capacity === null ? null : Math.max(0, capacity - ctx.usedToday),
    breakdown: { baseBaisa: base, weightBaisa, volumeBaisa, expressBaisa, freeStandardApplied, chargeableWeightGrams: chargeable },
  };
}

// ───────────── DB-backed helpers ─────────────

/**
 * Resolve the delivery zone for an address: a wilaya-specific active zone wins,
 * otherwise the governorate-wide zone (empty `wilayaSlugs`).
 */
export async function resolveZone(
  input: Pick<QuoteInput, 'zoneId' | 'wilayaId' | 'governorateId'>,
  db: Db = prisma,
): Promise<DeliveryZone | null> {
  if (input.zoneId) return db.deliveryZone.findUnique({ where: { id: input.zoneId } });
  let governorateId = input.governorateId;
  let wilayaSlug: string | undefined;
  if (input.wilayaId) {
    const w = await db.wilaya.findUnique({ where: { id: input.wilayaId }, select: { slug: true, governorateId: true } });
    if (!w) return null;
    if (governorateId && governorateId !== w.governorateId) return null;
    governorateId = w.governorateId;
    wilayaSlug = w.slug;
  }
  if (!governorateId) return null;
  const zones = await db.deliveryZone.findMany({ where: { governorateId }, orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] });
  const specific = wilayaSlug ? zones.find((z) => z.isActive && z.wilayaSlugs.includes(wilayaSlug)) : undefined;
  return specific ?? zones.find((z) => z.isActive && z.wilayaSlugs.length === 0) ?? zones.find((z) => z.wilayaSlugs.length === 0) ?? null;
}

/** Window during which a PENDING_PAYMENT order holds delivery capacity (checkout reservations last 15 min). */
export const PENDING_CAPACITY_HOLD_MINUTES = 30;

/**
 * Deliveries of `type` booked today (Muscat) in `zone`: non-failed shipments created
 * today + orders still awaiting payment placed in the last 30 minutes (provisional hold).
 * Matched through the order's address snapshot (`governorateId`, `wilayaId`).
 */
export async function countBookedToday(zone: DeliveryZone, type: DeliveryTypeInput, now: Date, db: Db = prisma): Promise<number> {
  const dayStart = startOfMuscatDay(now);
  const holdFrom = new Date(Math.max(dayStart.getTime(), now.getTime() - PENDING_CAPACITY_HOLD_MINUTES * 60_000));
  // Wilaya ids of this zone (specific zone) or wilayas served by OTHER specific zones (excluded from a governorate-wide zone).
  let includeIds: string[] | null = null;
  let excludeIds: string[] = [];
  if (zone.wilayaSlugs.length > 0) {
    includeIds = (await db.wilaya.findMany({ where: { slug: { in: zone.wilayaSlugs } }, select: { id: true } })).map((w) => w.id);
    if (includeIds.length === 0) return 0;
  } else {
    const others = await db.deliveryZone.findMany({
      where: { governorateId: zone.governorateId, isActive: true, id: { not: zone.id }, NOT: { wilayaSlugs: { isEmpty: true } } },
      select: { wilayaSlugs: true },
    });
    const slugs = others.flatMap((o) => o.wilayaSlugs);
    if (slugs.length) excludeIds = (await db.wilaya.findMany({ where: { slug: { in: slugs } }, select: { id: true } })).map((w) => w.id);
  }
  const wilayaFilter = includeIds
    ? Prisma.sql`AND (o."addressSnapshot"->>'wilayaId') = ANY(${includeIds}::text[])`
    : excludeIds.length
      ? Prisma.sql`AND COALESCE(o."addressSnapshot"->>'wilayaId', '') <> ALL(${excludeIds}::text[])`
      : Prisma.empty;
  const rows = await db.$queryRaw<{ n: bigint }[]>`
    SELECT (
      (SELECT count(*) FROM "Shipment" s JOIN "Order" o ON o.id = s."orderId"
        WHERE s."deliveryType" = ${type}::"DeliveryType" AND s."createdAt" >= ${dayStart} AND s.status <> 'FAILED'::"ShipmentStatus"
          AND (o."addressSnapshot"->>'governorateId') = ${zone.governorateId} ${wilayaFilter})
      +
      (SELECT count(*) FROM "Order" o
        WHERE o."deliveryType" = ${type}::"DeliveryType" AND o.status = 'PENDING_PAYMENT'::"OrderStatus" AND o."placedAt" >= ${holdFrom}
          AND (o."addressSnapshot"->>'governorateId') = ${zone.governorateId} ${wilayaFilter})
    ) AS n`;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Quote a delivery for an address (zone / wilaya / governorate), parcel and type.
 *
 *   const q = await quoteDelivery({ wilayaId, weightGrams, volumeCm3, type: 'EXPRESS', subtotalBaisa });
 *   if (!q.available) show t(`delivery.quote.reasons.${q.reason}`)
 */
export async function quoteDelivery(input: QuoteInput, db: Db = prisma): Promise<DeliveryQuote> {
  const now = input.at ?? new Date();
  const zone = await resolveZone(input, db);
  if (!zone) return computeQuote(null, input, { now, settings: { expressCutoffHour: null, includedWeightGrams: 0 }, usedToday: 0 });
  const [settings, usedToday] = await Promise.all([
    getDeliverySettings(db),
    zone.isActive ? countBookedToday(zone, input.type, now, db) : Promise.resolve(0),
  ]);
  return computeQuote(zone, input, { now, settings, usedToday });
}

/** Quote both delivery types at once (checkout delivery step). */
export async function quoteDeliveryOptions(input: Omit<QuoteInput, 'type'>, db: Db = prisma): Promise<Record<DeliveryTypeInput, DeliveryQuote>> {
  const [standard, express] = await Promise.all([
    quoteDelivery({ ...input, type: 'STANDARD' }, db),
    quoteDelivery({ ...input, type: 'EXPRESS' }, db),
  ]);
  return { STANDARD: standard, EXPRESS: express };
}

/** Sum the parcel of cart/order lines. Unknown weight/volume on any line ⇒ null (never guessed). */
export function aggregateParcel(lines: { weightGrams: number | null | undefined; volumeCm3: number | null | undefined; qty: number }[]): {
  weightGrams: number | null;
  volumeCm3: number | null;
} {
  let weight: number | null = 0;
  let volume: number | null = 0;
  for (const l of lines) {
    weight = weight === null || l.weightGrams == null ? null : weight + l.weightGrams * l.qty;
    volume = volume === null || l.volumeCm3 == null ? null : volume + l.volumeCm3 * l.qty;
  }
  return { weightGrams: lines.length ? weight : null, volumeCm3: lines.length ? volume : null };
}
