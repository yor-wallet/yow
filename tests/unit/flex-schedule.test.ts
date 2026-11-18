/**
 * DOOM FLEX schedule (pure): the owner's rule of 18 Nov 2026 — the customer pays only the first instalment when
 * confirming the plan, never the full price, and that first instalment is a little higher than the others.
 */
import { describe, expect, it } from 'vitest';
import { computeSchedule, FLEX_FIRST_EXTRA_PCT, flexAmounts } from '@/lib/flex/schedule';

describe('DOOM FLEX schedule', () => {
  it('first instalment a little higher, the others equal, the total exact to the baisa', () => {
    expect(FLEX_FIRST_EXTRA_PCT).toBe(20);
    expect(flexAmounts(360_000, 3)).toEqual([135_000, 112_500, 112_500]);
    expect(flexAmounts(360_000, 6)).toEqual([70_000, 58_000, 58_000, 58_000, 58_000, 58_000]);
    expect(flexAmounts(362_000, 6)).toEqual([70_500, 58_300, 58_300, 58_300, 58_300, 58_300]);
    for (const total of [3, 12, 999, 5_000, 12_000, 99_999, 360_000, 459_900, 1_299_000, 9_999_999]) {
      for (const n of [3, 6, 12]) {
        if (total < n) continue;
        const a = flexAmounts(total, n);
        expect(a).toHaveLength(n);
        expect(a.reduce((s, x) => s + x, 0)).toBe(total);
        expect(a.every((x) => Number.isInteger(x) && x >= 1)).toBe(true);
        expect(new Set(a.slice(1)).size).toBe(1);
        expect(a[0]).toBeGreaterThanOrEqual(a[1]!);
        // From 1 OMR up, the following instalments are whole 0.100 OMR.
        if (a[1]! >= 1000) expect(a[1]! % 100).toBe(0);
      }
    }
    // 0 % extra: equal instalments, the first carrying the rounding.
    expect(flexAmounts(360_000, 3, 0)).toEqual([120_000, 120_000, 120_000]);
    expect(() => flexAmounts(2, 3)).toThrow(RangeError);
    expect(() => flexAmounts(360_000, 3, 101)).toThrow(RangeError);
  });

  it('the first instalment is due on the confirmation day (Muscat), the next ones one month apart', () => {
    // 20:30 UTC on 30 Jan = 31 Jan in Muscat.
    const s = computeSchedule(360_000, 3, new Date('2027-01-30T20:30:00Z'));
    expect(s.installments.map((i) => i.dueDate)).toEqual(['2027-01-31', '2027-02-28', '2027-03-31']);
    expect(s).toMatchObject({ firstBaisa: 135_000, monthlyBaisa: 112_500, lastBaisa: 112_500, totalBaisa: 360_000, interestBaisa: 0, feesBaisa: 0 });
    const year = computeSchedule(360_000, 12, new Date('2026-11-18T08:00:00Z'));
    expect(year.installments[0]!.dueDate).toBe('2026-11-18');
    expect(year.installments[1]!.dueDate).toBe('2026-12-18');
    expect(year.installments[11]!.dueDate).toBe('2027-10-18');
  });
});
