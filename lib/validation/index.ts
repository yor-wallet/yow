import { z } from 'zod';
import { toLatinDigits } from '../money';

/**
 * Shared zod schemas. Error messages are i18n CODES, translated by the UI with
 * `useTranslations('errors')` → `t(\`validation.${code}\`)`. Keep codes in sync with
 * messages/{locale}/errors.json → "validation".
 */

export const OMAN_COUNTRY_CODE = '+968';

/**
 * Normalise an Omani phone number to E.164 (`+968XXXXXXXX`) or return null.
 * Accepts `+968 9123 4567`, `00968...`, `968...`, `91234567`, Arabic digits.
 * Omani numbers are 8 digits: mobiles start with 7 or 9, landlines with 2.
 */
export function normalizeOmanPhone(input: string): string | null {
  let digits = toLatinDigits(input).replace(/[\s\-(). ]/g, '');
  if (digits.startsWith('+')) digits = digits.slice(1);
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.length === 11 && digits.startsWith('968')) digits = digits.slice(3);
  if (!/^[279]\d{7}$/.test(digits)) return null;
  return `${OMAN_COUNTRY_CODE}${digits}`;
}

/** Mobile only (7x / 9x) — required for OTP/SMS-capable contact numbers. */
export function isOmanMobile(e164: string): boolean {
  return /^\+968[79]\d{7}$/.test(e164);
}

export const omanPhoneSchema = z
  .string({ required_error: 'required' })
  .trim()
  .min(1, 'required')
  .transform((v, ctx) => {
    const n = normalizeOmanPhone(v);
    if (!n) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'phone_invalid' });
      return z.NEVER;
    }
    return n;
  });

export const emailSchema = z
  .string({ required_error: 'required' })
  .trim()
  .min(1, 'required')
  .max(254, 'too_long')
  .email('email_invalid')
  .transform((v) => v.toLowerCase());

export const passwordSchema = z
  .string({ required_error: 'required' })
  .min(10, 'password_too_short')
  .max(128, 'too_long')
  .refine((v) => /[A-Za-z؀-ۿ]/.test(v) && /\d/.test(v), 'password_weak');

export const fullNameSchema = z
  .string({ required_error: 'required' })
  .trim()
  .min(2, 'name_too_short')
  .max(100, 'too_long');

export const localeSchema = z.enum(['ar', 'en', 'fr']);

export const baisaSchema = z
  .number({ invalid_type_error: 'amount_invalid' })
  .int('amount_invalid')
  .nonnegative('amount_invalid')
  .max(1_000_000_000, 'amount_too_large');

export const positiveBaisaSchema = baisaSchema.refine((v) => v > 0, 'amount_invalid');

export const idSchema = z.string().trim().min(1, 'required').max(64, 'too_long');

export const slugSchema = z
  .string()
  .trim()
  .min(1, 'required')
  .max(120, 'too_long')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'slug_invalid');

export const idempotencyKeySchema = z
  .string()
  .trim()
  .min(16, 'idempotency_invalid')
  .max(128, 'idempotency_invalid')
  .regex(/^[A-Za-z0-9_-]+$/, 'idempotency_invalid');

/** Bounding box of the Sultanate of Oman (incl. Musandam & Dhofar), WGS84. */
export const OMAN_BOUNDS = { minLat: 16.6, maxLat: 26.5, minLng: 51.8, maxLng: 59.9 } as const;

export const omanCoordinatesSchema = z
  .object({ lat: z.number().finite(), lng: z.number().finite() })
  .refine(
    ({ lat, lng }) =>
      lat >= OMAN_BOUNDS.minLat && lat <= OMAN_BOUNDS.maxLat && lng >= OMAN_BOUNDS.minLng && lng <= OMAN_BOUNDS.maxLng,
    'location_outside_oman',
  );

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(24),
});

export const searchQuerySchema = z.string().trim().max(120, 'too_long');

/** Relative in-app path only (prevents open redirects): `/x`, never `//x` or `http:`. */
export const safeRedirectSchema = z
  .string()
  .trim()
  .max(512)
  .refine((v) => v.startsWith('/') && !v.startsWith('//') && !v.startsWith('/\\'), 'redirect_invalid');

export function safeRedirectPath(value: unknown, fallback: string): string {
  const r = safeRedirectSchema.safeParse(value);
  return r.success ? r.data : fallback;
}

// ───────────── Auth ─────────────

export const registerSchema = z
  .object({
    fullName: fullNameSchema,
    email: emailSchema,
    phone: omanPhoneSchema,
    password: passwordSchema,
    confirmPassword: z.string({ required_error: 'required' }),
    acceptTerms: z.literal(true, { errorMap: () => ({ message: 'terms_required' }) }),
    locale: localeSchema.default('ar'),
  })
  .refine((d) => d.password === d.confirmPassword, { message: 'password_mismatch', path: ['confirmPassword'] });

export type RegisterInput = z.input<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ required_error: 'required' }).min(1, 'required').max(128, 'too_long'),
});

export type LoginInput = z.input<typeof loginSchema>;

// ───────────── Address ─────────────

export const addressInputSchema = z.object({
  label: z.string().trim().max(40, 'too_long').optional(),
  recipientName: fullNameSchema,
  phone: omanPhoneSchema,
  governorateId: idSchema,
  wilayaId: idSchema,
  /** Picked from the wilaya's list; the server then writes `area` from its Arabic and English names. */
  neighborhoodId: idSchema.optional(),
  area: z.string().trim().min(2, 'required').max(120, 'too_long'),
  street: z.string().trim().max(120, 'too_long').optional(),
  building: z.string().trim().min(1, 'required').max(120, 'too_long'),
  lat: z.number().finite().optional(),
  lng: z.number().finite().optional(),
  instructions: z.string().trim().max(500, 'too_long').optional(),
  isDefault: z.boolean().optional(),
});

export type AddressInput = z.infer<typeof addressInputSchema>;

// ───────────── Helpers ─────────────

export type FieldErrors = Record<string, string[]>;

/** Flatten a ZodError into `{ field: [code, ...] }` for forms. */
export function fieldErrorsOf(error: z.ZodError): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_form';
    (out[path] ??= []).push(issue.message);
  }
  return out;
}

/** Turn FormData into a plain object (checkbox "on" → true, repeated keys → arrays). */
export function formDataToObject(fd: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of fd.entries()) {
    if (k.startsWith('$ACTION')) continue;
    const value = typeof v === 'string' ? (v === 'on' ? true : v) : v;
    if (k in out) {
      const prev = out[k];
      out[k] = Array.isArray(prev) ? [...prev, value] : [prev, value];
    } else {
      out[k] = value;
    }
  }
  return out;
}
