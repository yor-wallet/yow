/**
 * Money helpers. ALL amounts are integer baisa (1 OMR = 1000 baisa).
 * Never use floats for money arithmetic; floats are only produced for display.
 *
 * Formatting is implemented by hand (not Intl) so server and client render the
 * exact same string (no hydration mismatch) and digits are always Latin.
 */

export const BAISA_PER_OMR = 1000;
export const CURRENCY = 'OMR' as const;

export type MoneyLocale = 'ar' | 'en' | 'fr';

export function isBaisa(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

export function assertBaisa(value: unknown, label = 'amount'): asserts value is number {
  if (!isBaisa(value)) throw new TypeError(`${label} must be an integer number of baisa, got ${String(value)}`);
}

/** Currency label for a locale: `ر.ع.` in Arabic, `OMR` otherwise. */
export function currencyLabel(locale: string): string {
  return locale === 'ar' ? 'ر.ع.' : 'OMR';
}

const NBSP = ' ';
const NNBSP = ' ';

function groupThousands(intDigits: string, sep: string): string {
  return intDigits.replace(/\B(?=(\d{3})+(?!\d))/g, sep);
}

/** Number part only, e.g. `1,234.500` (en/ar) or `1 234,500` (fr). */
export function formatOmrNumber(baisa: number, locale: string = 'ar', fractionDigits: 0 | 3 = 3): string {
  assertBaisa(baisa);
  const negative = baisa < 0;
  const abs = Math.abs(baisa);
  const whole = Math.floor(abs / BAISA_PER_OMR);
  const frac = abs % BAISA_PER_OMR;
  const fr = locale === 'fr';
  const intPart = groupThousands(String(whole), fr ? NNBSP : ',');
  const fracPart = fractionDigits === 3 ? `${fr ? ',' : '.'}${String(frac).padStart(3, '0')}` : '';
  return `${negative ? '-' : ''}${intPart}${fracPart}`;
}

export type FormatBaisaOptions = {
  /** Include the currency label (default true). */
  currency?: boolean;
  /** Show a leading `+` for positive amounts (wallet credits). */
  signed?: boolean;
  /** Drop the 3 decimals when the amount is a whole number of OMR (default false). */
  trimWhole?: boolean;
};

/**
 * Format baisa for display.
 *   en: `OMR 1,234.500`   fr: `1 234,500 OMR`   ar: `1,234.500 ر.ع.`
 */
export function formatBaisa(baisa: number, locale: string = 'ar', opts: FormatBaisaOptions = {}): string {
  assertBaisa(baisa);
  const { currency = true, signed = false, trimWhole = false } = opts;
  const digits: 0 | 3 = trimWhole && baisa % BAISA_PER_OMR === 0 ? 0 : 3;
  const num = formatOmrNumber(Math.abs(baisa), locale, digits);
  const sign = baisa < 0 ? '-' : signed && baisa > 0 ? '+' : '';
  if (!currency) return `${sign}${num}`;
  if (locale === 'en') return `${sign}OMR${NBSP}${num}`;
  return `${sign}${num}${NBSP}${currencyLabel(locale)}`;
}

const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
};

/** Convert Arabic-Indic / Persian digits to Latin digits. */
export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d);
}

/**
 * Parse a user-entered OMR amount into baisa. Returns `null` when invalid.
 * Accepts Arabic digits, `٫` decimal, currency labels, spaces and group separators.
 * `locale: 'fr'` treats a lone comma as the decimal separator; otherwise a comma is a group separator.
 * More than 3 decimals is rejected (never silently rounded).
 */
export function parseOmrToBaisa(input: string | number, locale: string = 'en'): number | null {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) return null;
    input = String(input);
  }
  let s = toLatinDigits(String(input))
    .replace(/ر\.?\s?ع\.?|OMR|R\.?O\.?/gi, '')
    .replace(/[\s  ]/g, '')
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
  if (!s) return null;
  let negative = false;
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1);
  } else if (s.startsWith('+')) {
    s = s.slice(1);
  }
  const hasDot = s.includes('.');
  const hasComma = s.includes(',');
  if (hasDot && hasComma) {
    const decimalSep = s.lastIndexOf('.') > s.lastIndexOf(',') ? '.' : ',';
    const groupSep = decimalSep === '.' ? ',' : '.';
    s = s.split(groupSep).join('');
    if (decimalSep === ',') s = s.replace(',', '.');
  } else if (hasComma) {
    if (locale === 'fr') {
      s = s.replace(',', '.');
    } else if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      return null;
    }
  }
  const m = /^(\d+)(?:\.(\d{1,3}))?$/.exec(s);
  if (!m) return null;
  const whole = Number(m[1]);
  const frac = Number((m[2] ?? '').padEnd(3, '0') || '0');
  const value = whole * BAISA_PER_OMR + frac;
  if (!Number.isSafeInteger(value)) return null;
  return negative ? -value : value;
}

/** Convert an OMR decimal (e.g. from config) to baisa, rounding half away from zero. */
export function omrToBaisa(omr: number): number {
  if (!Number.isFinite(omr)) throw new TypeError('omr must be finite');
  const v = Math.sign(omr) * Math.round(Math.abs(omr) * BAISA_PER_OMR + Number.EPSILON);
  assertBaisa(v);
  return v;
}

/** For display/analytics only — never feed the result back into money arithmetic. */
export function baisaToOmr(baisa: number): number {
  assertBaisa(baisa);
  return baisa / BAISA_PER_OMR;
}

export function sumBaisa(values: readonly number[]): number {
  let total = 0;
  for (const v of values) {
    assertBaisa(v);
    total += v;
  }
  assertBaisa(total, 'sum');
  return total;
}

/** `amount * bps / 10000`, rounded half up (100 bps = 1%). */
export function applyBasisPoints(baisa: number, bps: number): number {
  assertBaisa(baisa);
  if (!Number.isInteger(bps)) throw new TypeError('bps must be an integer');
  return Math.round((baisa * bps) / 10_000);
}

/**
 * Split `total` into `parts` integer amounts. Every part is floor(total/parts);
 * the LAST part absorbs the rounding remainder (DOOM FLEX rule).
 * e.g. 360000 / 3 → [120000, 120000, 120000]; 100000 / 3 → [33333, 33333, 33334].
 */
export function splitInstallments(total: number, parts: number): number[] {
  assertBaisa(total);
  if (!Number.isInteger(parts) || parts < 1) throw new RangeError('parts must be a positive integer');
  if (total < 0) throw new RangeError('total must be >= 0');
  const base = Math.floor(total / parts);
  const out = Array.from({ length: parts }, () => base);
  out[parts - 1] = total - base * (parts - 1);
  return out;
}
