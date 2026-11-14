import { z } from 'zod';
import { formatOmrNumber, parseOmrToBaisa } from '@/lib/money';
import { ValidationError } from './actor';
import { defineMutation } from './mutation';
import { getSettings, SETTINGS, settingValueSchema, type SettingKey } from './settings';

/**
 * Admin > Settings > Payments: how the crypto, gift-card and wallet-limit settings are grouped and
 * edited. The values live in `Setting` (lib/admin/settings.ts) and are read by lib/payments/policy.ts,
 * lib/payments/giftcards.ts and lib/wallet/limits.ts. Every save is RBAC-checked, validated and audited.
 */
export type FieldControl = 'switch' | 'percent' | 'omr' | 'count';
export type PaymentSettingSectionId = 'crypto' | 'giftcard' | 'wallet';
export type PaymentSettingField = { key: SettingKey; control: FieldControl };
export type PaymentSettingSection = { id: PaymentSettingSectionId; fields: readonly PaymentSettingField[] };

export const PAYMENT_SETTING_SECTIONS: readonly PaymentSettingSection[] = [
  {
    id: 'crypto',
    fields: [
      { key: 'crypto.enabled', control: 'switch' },
      { key: 'crypto.forOrders', control: 'switch' },
      { key: 'crypto.forTopup', control: 'switch' },
      { key: 'crypto.requireKyc', control: 'switch' },
      { key: 'crypto.minPaymentBaisa', control: 'omr' },
      { key: 'crypto.maxPaymentBaisa', control: 'omr' },
    ],
  },
  {
    id: 'giftcard',
    fields: [
      { key: 'giftcard.enabled', control: 'switch' },
      { key: 'giftcard.feeBps', control: 'percent' },
      { key: 'giftcard.requireKyc', control: 'switch' },
      { key: 'giftcard.maxOpen', control: 'count' },
    ],
  },
  {
    id: 'wallet',
    fields: [
      { key: 'wallet.minTopUpBaisa', control: 'omr' },
      { key: 'wallet.maxTopUpBaisa', control: 'omr' },
      { key: 'wallet.maxBalanceBaisa', control: 'omr' },
    ],
  },
];

/** Stored value → the text a staff member edits (empty when unset). */
export function toFormValue(control: FieldControl, value: number | null): string {
  if (value === null) return '';
  if (control === 'percent') return (value / 100).toFixed(2).replace(/\.?0+$/, '');
  if (control === 'omr') return formatOmrNumber(value, 'en');
  return String(value);
}

const latin = (s: string) =>
  s
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٫,]/g, '.')
    .replace(/[%٪\s]/g, '')
    .trim();

/** Text typed by staff → number; `null` = empty, `'invalid'` = not a number of this control. */
export function parseFormValue(control: FieldControl, raw: string): number | null | 'invalid' {
  const s = latin(raw);
  if (s === '') return null;
  switch (control) {
    case 'switch':
      return s === '1' ? 1 : s === '0' ? 0 : 'invalid';
    case 'count':
      return /^\d{1,6}$/.test(s) ? Number(s) : 'invalid';
    case 'percent': {
      const m = /^(\d{1,2})(?:\.(\d{1,2}))?$/.exec(s);
      return m ? Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0')) : 'invalid';
    }
    case 'omr':
      return parseOmrToBaisa(s) ?? 'invalid';
  }
}

const schema = z.object({
  section: z.enum(['crypto', 'giftcard', 'wallet']),
  /** key → text as typed (switches: "1" / "0"). Keys outside the section are ignored. */
  values: z.record(z.string(), z.string().max(40)),
});

export const savePaymentSettings = defineMutation({
  name: 'settings.payments.save',
  permission: 'settings:write',
  schema,
  async run({ tx, actor, input, audit }) {
    const section = PAYMENT_SETTING_SECTIONS.find((s) => s.id === input.section)!;
    const before = await getSettings(tx);
    const errors: Record<string, string[]> = {};
    const next = new Map<SettingKey, number | null>();

    for (const f of section.fields) {
      const raw = input.values[f.key];
      if (raw === undefined) continue;
      const parsed = parseFormValue(f.control, raw);
      if (parsed === 'invalid') {
        errors[f.key] = ['number_invalid'];
        continue;
      }
      const def = SETTINGS[f.key].default as number | null;
      if (parsed === null) {
        next.set(f.key, def); // empty = back to the default (unset for optional values)
        continue;
      }
      const checked = settingValueSchema(f.key).safeParse(parsed);
      if (!checked.success) {
        errors[f.key] = [checked.error.issues[0]?.message ?? 'out_of_range'];
        continue;
      }
      next.set(f.key, parsed);
    }

    // Cross-checks on the values as they will be after this save.
    const after = { ...before } as Record<string, number | null>;
    for (const [k, v] of next) after[k] = v;
    const inverted = (lo: string, hi: string) => after[lo] !== null && after[hi] !== null && (after[lo] as number) > (after[hi] as number);
    if (inverted('crypto.minPaymentBaisa', 'crypto.maxPaymentBaisa')) errors['crypto.maxPaymentBaisa'] = ['range_inverted'];
    if (inverted('wallet.minTopUpBaisa', 'wallet.maxTopUpBaisa')) errors['wallet.maxTopUpBaisa'] = ['range_inverted'];
    if (inverted('wallet.maxTopUpBaisa', 'wallet.maxBalanceBaisa')) errors['wallet.maxBalanceBaisa'] = ['range_inverted'];
    if (Object.keys(errors).length) throw new ValidationError(errors);

    const changedBefore: Record<string, unknown> = {};
    const changedAfter: Record<string, unknown> = {};
    for (const [key, value] of next) {
      if ((before as Record<string, unknown>)[key] === value) continue;
      changedBefore[key] = (before as Record<string, unknown>)[key];
      changedAfter[key] = value;
      if (value === null || value === SETTINGS[key].default) await tx.setting.deleteMany({ where: { key } });
      else await tx.setting.upsert({ where: { key }, update: { value, updatedById: actor.id }, create: { key, value, updatedById: actor.id } });
    }
    const changed = Object.keys(changedAfter).length;
    if (changed > 0) {
      await audit({ action: 'settings.payments.update', entity: 'Setting', entityId: input.section, before: changedBefore, after: changedAfter });
    }
    return { section: input.section, changed };
  },
});
