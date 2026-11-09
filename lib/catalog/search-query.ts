import { toLatinDigits } from '@/lib/money';

/**
 * Search query parsing (pure, shared by the search page, suggestions API and tests).
 * Normalisation must stay in sync with the SQL expression in lib/catalog/listing.ts
 * (`normSql`): lower-case, Latin digits, Arabic letter variants unified, diacritics
 * and tatweel removed.
 */

export const MAX_QUERY_LENGTH = 120;
export const MAX_TOKENS = 6;
export const MIN_TOKEN_LENGTH = 1;

/** Arabic letters folded to one form (must match `ARABIC_FROM`/`ARABIC_TO` in SQL). */
export const ARABIC_FROM = 'أإآٱةى';
export const ARABIC_TO = 'ااااهي';
/** Arabic diacritics (tashkeel) + tatweel, removed. */
export const ARABIC_STRIP = 'ًٌٍَُِّْـ';

const STRIP_RE = new RegExp(`[${ARABIC_STRIP}]`, 'g');

export function normalizeSearchText(input: string): string {
  let s = toLatinDigits(input).toLowerCase().replace(STRIP_RE, '');
  for (let i = 0; i < ARABIC_FROM.length; i++) {
    s = s.split(ARABIC_FROM[i]!).join(ARABIC_TO[i]!);
  }
  return s.replace(/\s+/g, ' ').trim();
}

export type ParsedQuery = {
  /** Normalised full query (empty when nothing searchable). */
  text: string;
  /** Distinct normalised tokens (AND semantics), longest first, max MAX_TOKENS. */
  tokens: string[];
  /** Raw trimmed input (for display). */
  raw: string;
};

/** Escape LIKE wildcards so user input is matched literally (`ESCAPE '\'`). */
export function escapeLike(token: string): string {
  return token.replace(/[\\%_]/g, (m) => `\\${m}`);
}

/**
 * Parse a user query. Punctuation other than `-`, `.`, `+` and `/` (common in SKUs and
 * model names: "SM-S928B", "14.2", "1TB/16GB") is treated as a separator.
 */
export function parseSearchQuery(input: unknown): ParsedQuery {
  const raw = typeof input === 'string' ? input.trim().slice(0, MAX_QUERY_LENGTH) : '';
  const text = normalizeSearchText(raw);
  const parts = text
    .replace(/[^\p{L}\p{N}\-.+/ ]+/gu, ' ')
    .split(' ')
    .map((t) => t.replace(/^[-.+/]+|[-.+/]+$/g, ''))
    .filter((t) => t.length >= MIN_TOKEN_LENGTH);
  const tokens = [...new Set(parts)].sort((a, b) => b.length - a.length).slice(0, MAX_TOKENS);
  return { text: tokens.length ? text : '', tokens, raw };
}

export function isEmptyQuery(q: ParsedQuery): boolean {
  return q.tokens.length === 0;
}
