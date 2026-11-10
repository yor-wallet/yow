import { z } from 'zod';
import { parseOmrToBaisa } from '@/lib/money';
import { normalizeOmanPhone } from '@/lib/validation';

/**
 * zod helpers for admin forms (FormData → typed input). Error messages are i18n codes
 * (`admin.errors.fields.*`, falling back to `errors.validation.*`). Empty text never becomes
 * a made-up value: optional fields become null, required ones report `required`.
 */

const empty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Dotted FormData keys (`name.ar`) → nested objects; repeated keys → arrays; checkbox "on" → true. */
export function nestForm(fd: FormData, arrayKeys: readonly string[] = []): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [rawKey, v] of fd.entries()) {
    if (rawKey.startsWith('$ACTION')) continue;
    const value = typeof v === 'string' ? (v === 'on' ? true : v) : v;
    const parts = rawKey.split('.');
    let node = out;
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!;
      if (typeof node[p] !== 'object' || node[p] === null || Array.isArray(node[p])) node[p] = {};
      node = node[p] as Record<string, unknown>;
    }
    const leaf = parts[parts.length - 1]!;
    if (arrayKeys.includes(rawKey)) {
      const prev = node[leaf];
      node[leaf] = Array.isArray(prev) ? [...prev, value] : [value];
    } else node[leaf] = value;
  }
  for (const k of arrayKeys) if (!k.includes('.') && !(k in out)) out[k] = [];
  return out;
}

export const zText = (max = 200, min = 1) =>
  z.string({ required_error: 'required', invalid_type_error: 'required' }).trim().min(min, 'required').max(max, 'too_long');

export const zTextOpt = (max = 500) => z.preprocess((v) => (empty(v) ? null : v), z.string().trim().max(max, 'too_long').nullable());

export const zBool = z.preprocess((v) => v === true || v === 'true' || v === 'on' || v === '1', z.boolean());

export const zInt = (min = 0, max = 1_000_000_000) =>
  z.preprocess(
    (v) => (empty(v) ? undefined : typeof v === 'string' ? (/^-?\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN) : v),
    z.number({ required_error: 'required', invalid_type_error: 'invalid' }).int('invalid').min(min, 'out_of_range').max(max, 'out_of_range'),
  );

export const zIntOpt = (min = 0, max = 1_000_000_000) =>
  z.preprocess(
    (v) => (empty(v) ? null : typeof v === 'string' ? (/^-?\d+$/.test(v.trim()) ? Number(v.trim()) : Number.NaN) : v),
    z.number({ invalid_type_error: 'invalid' }).int('invalid').min(min, 'out_of_range').max(max, 'out_of_range').nullable(),
  );

/** OMR typed by staff ("12.500", "١٢٫٥", "12,5" in fr) → integer baisa. */
export const zMoney = (opts: { positive?: boolean; max?: number } = {}) =>
  z.preprocess(
    (v) => (empty(v) ? undefined : typeof v === 'number' ? v : (parseOmrToBaisa(String(v), String(v).includes(',') && !String(v).includes('.') ? 'fr' : 'en') ?? Number.NaN)),
    z
      .number({ required_error: 'required', invalid_type_error: 'amount_invalid' })
      .int('amount_invalid')
      .min(opts.positive ? 1 : 0, 'amount_invalid')
      .max(opts.max ?? 1_000_000_000, 'amount_too_large'),
  );

export const zMoneyOpt = () =>
  z.preprocess(
    (v) => (empty(v) ? null : typeof v === 'number' ? v : (parseOmrToBaisa(String(v), String(v).includes(',') && !String(v).includes('.') ? 'fr' : 'en') ?? Number.NaN)),
    z.number({ invalid_type_error: 'amount_invalid' }).int('amount_invalid').min(0, 'amount_invalid').max(1_000_000_000, 'amount_too_large').nullable(),
  );

/** "12.5" (%) → 1250 basis points. */
export const zPercentBps = (max = 10_000) =>
  z.preprocess(
    (v) => {
      if (empty(v)) return undefined;
      const s = String(v).replace(',', '.').trim();
      if (!/^\d+(\.\d{1,2})?$/.test(s)) return Number.NaN;
      return Math.round(Number(s) * 100);
    },
    z.number({ required_error: 'required', invalid_type_error: 'invalid' }).int('invalid').min(0, 'out_of_range').max(max, 'out_of_range'),
  );

export const zLocalized = (max = 200) => z.object({ ar: zText(max), en: zText(max), fr: zText(max) }, { required_error: 'required', invalid_type_error: 'required' });

/** Every locale optional; null when all are empty (the reader falls back to another language). */
export const zLocalizedOpt = (max = 2000) =>
  z.preprocess(
    (v) => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      return ['ar', 'en', 'fr'].every((l) => empty(o[l])) ? null : { ar: String(o.ar ?? '').trim(), en: String(o.en ?? '').trim(), fr: String(o.fr ?? '').trim() };
    },
    z.object({ ar: z.string().max(max, 'too_long'), en: z.string().max(max, 'too_long'), fr: z.string().max(max, 'too_long') }).nullable(),
  );

/** `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm` (Asia/Muscat wall time, UTC+4) → Date; empty → null. */
export const zDateOpt = () =>
  z.preprocess(
    (v) => {
      if (empty(v)) return null;
      if (v instanceof Date) return v;
      const s = String(v).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(`${s}T00:00:00+04:00`);
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(s)) return new Date(`${s}:00+04:00`);
      return new Date(Number.NaN);
    },
    z.date({ invalid_type_error: 'date_invalid' }).refine((d) => !Number.isNaN(d.getTime()), 'date_invalid').nullable(),
  );

export const zDate = () => zDateOpt().refine((d): d is Date => d !== null, 'required');

/** Repeated fields or a comma/space separated string → unique trimmed ids. */
export const zIdList = (max = 200) =>
  z.preprocess(
    (v) => {
      const arr = Array.isArray(v) ? v : typeof v === 'string' ? v.split(/[\s,]+/) : [];
      return [...new Set(arr.map((x) => String(x).trim()).filter(Boolean))];
    },
    z.array(z.string().max(64)).max(max, 'too_many'),
  );

export const zSlug = z
  .string({ required_error: 'required' })
  .trim()
  .toLowerCase()
  .min(1, 'required')
  .max(120, 'too_long')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_invalid');

export const zPhone = z.string({ required_error: 'required' }).trim().transform((v, ctx) => {
  const n = normalizeOmanPhone(v);
  if (!n) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'phone_invalid' });
    return z.NEVER;
  }
  return n;
});

/** Locale-less internal path (`/category/x`) or absolute https URL; empty → null. */
export const zLink = z.preprocess(
  (v) => (empty(v) ? null : v),
  z
    .string()
    .trim()
    .max(500, 'too_long')
    .refine((s) => (s.startsWith('/') && !s.startsWith('//') && !s.startsWith('/\\')) || /^https:\/\/[^\s]+$/.test(s), 'link_invalid')
    .nullable(),
);

export const zHttpUrl = z
  .string({ required_error: 'required' })
  .trim()
  .min(1, 'required')
  .max(1000, 'too_long')
  .refine((s) => {
    try {
      const u = new URL(s);
      return u.protocol === 'https:' || u.protocol === 'http:';
    } catch {
      return false;
    }
  }, 'url_invalid');
