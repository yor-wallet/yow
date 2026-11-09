import { prisma, type Db } from '../db';

/**
 * Operational delivery settings stored in the `Setting` table (admin → Site settings).
 * Fees themselves live on `DeliveryZone` (NULL = not configured = unavailable).
 *
 * | key                              | value                    | meaning                                                   |
 * |----------------------------------|--------------------------|-----------------------------------------------------------|
 * | `delivery.expressCutoffHour`     | integer 0–23 (Muscat)    | EXPRESS orders accepted only BEFORE this hour, same day.  |
 * | `delivery.includedWeightGrams`   | integer ≥ 0              | chargeable weight included in the base fee (per-kg above) |
 *
 * Values may be stored as a bare number, a numeric string or `{ "value": n }`.
 */
export const DELIVERY_SETTING_KEYS = {
  expressCutoffHour: 'delivery.expressCutoffHour',
  includedWeightGrams: 'delivery.includedWeightGrams',
} as const;

/** Volumetric divisor (cm³ per kg): volumetric weight kg = volume cm³ / 5000. */
export const VOLUMETRIC_DIVISOR = 5000;

export type DeliverySettings = {
  /** Muscat hour after which EXPRESS is closed for the day; null = no cut-off configured. */
  expressCutoffHour: number | null;
  /** Grams included in the base fee before the per-kg rate applies (0 when not configured). */
  includedWeightGrams: number;
};

/** Parse an integer setting value (number, numeric string, `{value}`, `{hour}`, `{grams}`) within bounds. */
export function parseIntSetting(value: unknown, min: number, max: number): number | null {
  let raw: unknown = value;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const o = raw as Record<string, unknown>;
    raw = o.value ?? o.hour ?? o.grams ?? null;
  }
  const n = typeof raw === 'number' ? raw : typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : NaN;
  if (!Number.isInteger(n) || n < min || n > max) return null;
  return n;
}

export async function getDeliverySettings(db: Db = prisma): Promise<DeliverySettings> {
  const rows = await db.setting.findMany({
    where: { key: { in: Object.values(DELIVERY_SETTING_KEYS) } },
    select: { key: true, value: true },
  });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  return {
    expressCutoffHour: parseIntSetting(byKey.get(DELIVERY_SETTING_KEYS.expressCutoffHour), 0, 23),
    includedWeightGrams: parseIntSetting(byKey.get(DELIVERY_SETTING_KEYS.includedWeightGrams), 0, 1_000_000) ?? 0,
  };
}
