/**
 * Time helpers for DOOM EXPRESS. All operational days (capacity, cut-off) are
 * counted in Muscat local time (Asia/Muscat, UTC+04:00, no daylight saving).
 */

export const MUSCAT_TZ = 'Asia/Muscat';

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: MUSCAT_TZ, hour: '2-digit', hourCycle: 'h23' });
const dayFmt = new Intl.DateTimeFormat('en-CA', { timeZone: MUSCAT_TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

/** Hour of the day (0–23) in Muscat for `date`. */
export function muscatHour(date: Date): number {
  return Number(hourFmt.format(date)) % 24;
}

/** `YYYY-MM-DD` of `date` in Muscat. */
export function muscatDayKey(date: Date): string {
  return dayFmt.format(date);
}

/** UTC instant of 00:00 Muscat time on the Muscat day containing `date`. */
export function startOfMuscatDay(date: Date): Date {
  const [y, m, d] = muscatDayKey(date).split('-').map(Number) as [number, number, number];
  // Muscat is UTC+4 all year: local midnight = 20:00 UTC of the previous day.
  return new Date(Date.UTC(y, m - 1, d) - 4 * 3600 * 1000);
}

export function addHours(date: Date, hours: number): Date {
  return new Date(date.getTime() + hours * 3600 * 1000);
}
