import { z } from 'zod';

/** Translatable DB content (`Json` columns): `{ ar, en, fr }`. */
export type LocalizedText = { ar: string; en: string; fr: string };
export type ContentLocale = keyof LocalizedText;

export const CONTENT_LOCALES: readonly ContentLocale[] = ['ar', 'en', 'fr'];

export const localizedTextSchema = z.object({
  ar: z.string().trim().min(1, 'required'),
  en: z.string().trim().min(1, 'required'),
  fr: z.string().trim().min(1, 'required'),
});

/** Same shape but every locale optional (drafts). */
export const partialLocalizedTextSchema = z.object({
  ar: z.string().trim().optional(),
  en: z.string().trim().optional(),
  fr: z.string().trim().optional(),
});

export function isLocalizedText(value: unknown): value is LocalizedText {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.ar === 'string' && typeof v.en === 'string' && typeof v.fr === 'string';
}

/**
 * Pick the string for `locale` from a LocalizedText-ish Json value, falling back
 * to en → ar → fr, then to `fallback`. Plain strings are returned as-is.
 */
export function localize(value: unknown, locale: string, fallback = ''): string {
  if (value == null) return fallback;
  if (typeof value === 'string') return value;
  if (typeof value !== 'object') return fallback;
  const v = value as Record<string, unknown>;
  const order = [locale, 'en', 'ar', 'fr'];
  for (const l of order) {
    const s = v[l];
    if (typeof s === 'string' && s.trim()) return s;
  }
  return fallback;
}
