import { describe, expect, it } from 'vitest';
import {
  applyBasisPoints,
  formatBaisa,
  formatOmrNumber,
  omrToBaisa,
  parseOmrToBaisa,
  splitInstallments,
  sumBaisa,
  toLatinDigits,
} from '@/lib/money';

const NBSP = ' ';
const NNBSP = ' ';

describe('formatBaisa', () => {
  it('formats with 3 decimals and Latin digits per locale', () => {
    expect(formatBaisa(1_234_500, 'en')).toBe(`OMR${NBSP}1,234.500`);
    expect(formatBaisa(1_234_500, 'ar')).toBe(`1,234.500${NBSP}ر.ع.`);
    expect(formatBaisa(1_234_500, 'fr')).toBe(`1${NNBSP}234,500${NBSP}OMR`);
  });

  it('handles zero, small and negative amounts', () => {
    expect(formatBaisa(0, 'en')).toBe(`OMR${NBSP}0.000`);
    expect(formatBaisa(5, 'en')).toBe(`OMR${NBSP}0.005`);
    expect(formatBaisa(-2500, 'en')).toBe(`-OMR${NBSP}2.500`);
    expect(formatBaisa(2500, 'en', { signed: true })).toBe(`+OMR${NBSP}2.500`);
  });

  it('never outputs Arabic-Indic digits', () => {
    expect(formatBaisa(9_876_543, 'ar')).not.toMatch(/[٠-٩]/);
  });

  it('can trim whole amounts and omit the currency', () => {
    expect(formatBaisa(360_000, 'en', { trimWhole: true })).toBe(`OMR${NBSP}360`);
    expect(formatBaisa(360_500, 'en', { trimWhole: true })).toBe(`OMR${NBSP}360.500`);
    expect(formatOmrNumber(1_000_000_000, 'en')).toBe('1,000,000.000');
    expect(formatBaisa(1500, 'ar', { currency: false })).toBe('1.500');
  });

  it('rejects non-integer amounts', () => {
    expect(() => formatBaisa(1.5, 'en')).toThrow();
  });
});

describe('parseOmrToBaisa', () => {
  it('parses plain and decimal values', () => {
    expect(parseOmrToBaisa('12')).toBe(12_000);
    expect(parseOmrToBaisa('12.5')).toBe(12_500);
    expect(parseOmrToBaisa('12.345')).toBe(12_345);
    expect(parseOmrToBaisa('0.005')).toBe(5);
  });

  it('accepts currency labels, spaces, groups and Arabic digits', () => {
    expect(parseOmrToBaisa('OMR 1,234.500')).toBe(1_234_500);
    expect(parseOmrToBaisa('١٢٫٥ ر.ع.')).toBe(12_500);
    expect(parseOmrToBaisa('1 234,5', 'fr')).toBe(1_234_500);
    expect(parseOmrToBaisa('1.234,500')).toBe(1_234_500);
    expect(parseOmrToBaisa('1,500')).toBe(1_500_000);
  });

  it('rejects invalid input and more than 3 decimals', () => {
    expect(parseOmrToBaisa('')).toBeNull();
    expect(parseOmrToBaisa('abc')).toBeNull();
    expect(parseOmrToBaisa('1.2345')).toBeNull();
    expect(parseOmrToBaisa('1,5')).toBeNull();
    expect(parseOmrToBaisa('1..2')).toBeNull();
  });

  it('round-trips with formatBaisa', () => {
    for (const v of [0, 1, 999, 1000, 123_456, 98_765_432]) {
      expect(parseOmrToBaisa(formatBaisa(v, 'en'))).toBe(v);
      expect(parseOmrToBaisa(formatBaisa(v, 'ar'))).toBe(v);
      expect(parseOmrToBaisa(formatBaisa(v, 'fr'), 'fr')).toBe(v);
    }
  });
});

describe('helpers', () => {
  it('omrToBaisa avoids float drift', () => {
    expect(omrToBaisa(0.1 + 0.2)).toBe(300);
    expect(omrToBaisa(19.995)).toBe(19_995);
  });

  it('sumBaisa and applyBasisPoints', () => {
    expect(sumBaisa([1000, 2500, 5])).toBe(3505);
    expect(applyBasisPoints(100_000, 1000)).toBe(10_000);
    expect(applyBasisPoints(333, 5000)).toBe(167);
  });

  it('splitInstallments: last instalment absorbs rounding (SPEC example 360 OMR)', () => {
    expect(splitInstallments(360_000, 3)).toEqual([120_000, 120_000, 120_000]);
    expect(splitInstallments(360_000, 6)).toEqual(Array(6).fill(60_000));
    expect(splitInstallments(360_000, 12)).toEqual(Array(12).fill(30_000));
    const parts = splitInstallments(100_000, 3);
    expect(parts).toEqual([33_333, 33_333, 33_334]);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(100_000);
  });

  it('toLatinDigits', () => {
    expect(toLatinDigits('٠١٢٣٤٥٦٧٨٩ ۴')).toBe('0123456789 4');
  });
});
