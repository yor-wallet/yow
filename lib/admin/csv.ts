/**
 * CSV export (RFC 4180). Cells starting with = + - @ (or tab/CR) are prefixed with a
 * quote to neutralise spreadsheet formula injection. UTF-8 BOM so Excel shows Arabic.
 */
export type CsvCell = string | number | boolean | null | undefined | Date;

export function csvCell(value: CsvCell): string {
  if (value === null || value === undefined) return '';
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header: readonly string[], rows: readonly (readonly CsvCell[])[]): string {
  const lines = [header.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))];
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** Baisa as a plain OMR decimal string for spreadsheets (exact, no float maths). */
export function baisaToCsv(baisa: number | null | undefined): string {
  if (baisa === null || baisa === undefined) return '';
  const neg = baisa < 0;
  const abs = Math.abs(baisa);
  return `${neg ? '-' : ''}${Math.floor(abs / 1000)}.${String(abs % 1000).padStart(3, '0')}`;
}
