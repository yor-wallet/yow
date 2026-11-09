import { z } from 'zod';
import { prisma, type Db } from '@/lib/db';
import { emailSchema, normalizeOmanPhone } from '@/lib/validation';

/**
 * Typed site settings stored in `Setting` (key → Json value). Each definition has a
 * kind (drives the admin form + validation) and a default used while unset.
 * `null` default = "not configured" (features depending on it say so).
 * Keys are a shared contract (docs/ADMIN.md → Settings); other modules may read them
 * with `getSetting(key)`.
 */
export type SettingKind = 'bps' | 'int' | 'baisa' | 'time' | 'text' | 'email' | 'phone';

type Def<K extends SettingKind, V> = { kind: K; group: SettingGroup; default: V; min?: number; max?: number };
export type SettingGroup = 'commerce' | 'pricing' | 'delivery' | 'compliance' | 'operations' | 'contact';

export const SETTINGS = {
  'tax.vatBps': { kind: 'bps', group: 'commerce', default: 500, min: 0, max: 5000 } as Def<'bps', number>,
  'stock.lowThreshold': { kind: 'int', group: 'commerce', default: 2, min: 0, max: 10_000 } as Def<'int', number>,
  'pricing.targetMarginBps': { kind: 'bps', group: 'pricing', default: 1500, min: 0, max: 20_000 } as Def<'bps', number>,
  'pricing.competitivenessBps': { kind: 'bps', group: 'pricing', default: 200, min: 0, max: 5000 } as Def<'bps', number>,
  'pricing.roundingBaisa': { kind: 'baisa', group: 'pricing', default: 50, min: 1, max: 10_000 } as Def<'baisa', number>,
  'pricing.deviationAlertBps': { kind: 'bps', group: 'pricing', default: 1500, min: 100, max: 10_000 } as Def<'bps', number>,
  'delivery.expressCutoff': { kind: 'time', group: 'delivery', default: null } as Def<'time', string | null>,
  'kyc.retentionDays': { kind: 'int', group: 'compliance', default: null, min: 30, max: 3650 } as Def<'int', number | null>,
  'support.slaHours': { kind: 'int', group: 'operations', default: 24, min: 1, max: 720 } as Def<'int', number>,
  'payments.stuckPendingMinutes': { kind: 'int', group: 'operations', default: 30, min: 5, max: 10_080 } as Def<'int', number>,
  'contact.phone': { kind: 'phone', group: 'contact', default: null } as Def<'phone', string | null>,
  'contact.whatsapp': { kind: 'phone', group: 'contact', default: null } as Def<'phone', string | null>,
  'contact.email': { kind: 'email', group: 'contact', default: null } as Def<'email', string | null>,
  'contact.address': { kind: 'text', group: 'contact', default: null } as Def<'text', string | null>,
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = (typeof SETTINGS)[K]['default'];
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };

export const SETTING_KEYS = Object.keys(SETTINGS) as SettingKey[];
export const SETTING_GROUPS: readonly SettingGroup[] = ['commerce', 'pricing', 'delivery', 'compliance', 'operations', 'contact'];

/** zod schema for a stored value of `key` (null clears to "not configured" when allowed). */
export function settingValueSchema(key: SettingKey): z.ZodType<unknown> {
  const def = SETTINGS[key] as Def<SettingKind, unknown>;
  const nullable = def.default === null;
  let base: z.ZodType<unknown>;
  switch (def.kind) {
    case 'bps':
    case 'int':
    case 'baisa':
      base = z
        .number({ invalid_type_error: 'number_invalid' })
        .int('number_invalid')
        .min(def.min ?? 0, 'out_of_range')
        .max(def.max ?? 1_000_000_000, 'out_of_range');
      break;
    case 'time':
      base = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time_invalid');
      break;
    case 'email':
      base = emailSchema;
      break;
    case 'phone':
      base = z.string().transform((v, ctx) => {
        const n = normalizeOmanPhone(v);
        if (!n) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'phone_invalid' });
          return z.NEVER;
        }
        return n;
      });
      break;
    default:
      base = z.string().trim().min(1, 'required').max(500, 'too_long');
  }
  return nullable ? base.nullable() : base;
}

function coerce<K extends SettingKey>(key: K, raw: unknown): SettingValue<K> {
  const parsed = settingValueSchema(key).safeParse(raw);
  return (parsed.success ? parsed.data : SETTINGS[key].default) as SettingValue<K>;
}

/** All settings with defaults applied (invalid stored values fall back to the default). */
export async function getSettings(db: Pick<Db, 'setting'> = prisma): Promise<SettingsMap> {
  const rows = await db.setting.findMany({ where: { key: { in: SETTING_KEYS } } });
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out = {} as Record<string, unknown>;
  for (const key of SETTING_KEYS) out[key] = byKey.has(key) ? coerce(key, byKey.get(key)) : SETTINGS[key].default;
  return out as SettingsMap;
}

export async function getSetting<K extends SettingKey>(key: K, db: Pick<Db, 'setting'> = prisma): Promise<SettingValue<K>> {
  const row = await db.setting.findUnique({ where: { key } });
  return row ? coerce(key, row.value) : SETTINGS[key].default;
}

/** Which keys are explicitly stored (vs. using defaults). */
export async function storedSettingKeys(db: Pick<Db, 'setting'> = prisma): Promise<Set<string>> {
  const rows = await db.setting.findMany({ where: { key: { in: SETTING_KEYS } }, select: { key: true } });
  return new Set(rows.map((r) => r.key));
}
