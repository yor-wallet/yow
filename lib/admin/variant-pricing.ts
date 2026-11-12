import type { Prisma, Role } from '@prisma/client';
import { z } from 'zod';
import { can } from '@/lib/rbac';
import { idSchema, idempotencyKeySchema } from '@/lib/validation';
import { AdminError, ForbiddenError, NotFoundError, ValidationError, assertCan, type Actor } from './actor';
import { defineMutation, type AuditInput } from './mutation';
import { baisaToCsv } from './csv';

/**
 * Fast price & stock entry for many variants at once (product quick-edit grid, "apply to all
 * variants with the same capacity", CSV import). One planner validates every requested change
 * against the CURRENT database row and the actor's permissions; one committer writes the valid
 * plan inside a SERIALIZABLE transaction with an audit row per variant and a StockMovement for
 * every stock change. Prices are integer baisa; nothing is ever defaulted or guessed.
 *
 * Patch semantics: a field that is ABSENT (undefined) is left unchanged; `null` clears a price
 * (price / compare-at / cost — "not decided yet"); stock is an absolute quantity (≥ reserved).
 */

export type VariantPatch = {
  /** Variant id (grid) — or resolved from `sku` (import). */
  id: string;
  price?: number | null;
  compareAt?: number | null;
  cost?: number | null;
  stock?: number;
};

export type CurrentVariant = {
  id: string;
  sku: string;
  productId: string;
  priceBaisa: number | null;
  compareAtBaisa: number | null;
  costBaisa: number | null;
  stock: number;
  reserved: number;
};

export type PlanError =
  | 'unknown_sku'
  | 'duplicate_sku'
  | 'forbidden_prices'
  | 'forbidden_stock'
  | 'compare_not_higher'
  | 'compare_without_price'
  | 'below_reserved'
  | 'amount_invalid'
  | 'negative'
  | 'stock_invalid';

export type PlannedRow = {
  id: string | null;
  sku: string;
  line?: number;
  status: 'unchanged' | 'change' | 'error';
  errors: PlanError[];
  before: { price: number | null; compareAt: number | null; cost: number | null; stock: number; reserved: number } | null;
  after: { price: number | null; compareAt: number | null; cost: number | null; stock: number } | null;
  priceChanged: boolean;
  stockChanged: boolean;
};

const MAX_BAISA = 1_000_000_000;
const okAmount = (v: number | null | undefined) => v === undefined || v === null || (Number.isSafeInteger(v) && v >= 0 && v <= MAX_BAISA);

/** Pure planner (unit-tested): what would change, and why a row is refused. */
export function planVariantChanges(current: readonly CurrentVariant[], patches: readonly (VariantPatch & { line?: number; sku?: string })[], role: Role): PlannedRow[] {
  const byId = new Map(current.map((v) => [v.id, v]));
  const seen = new Set<string>();
  const canPrice = can(role, 'prices:write');
  const canStock = can(role, 'stock:write');
  return patches.map((p) => {
    const cur = byId.get(p.id);
    const errors: PlanError[] = [];
    if (!cur) return { id: null, sku: p.sku ?? p.id, line: p.line, status: 'error', errors: ['unknown_sku'], before: null, after: null, priceChanged: false, stockChanged: false };
    if (seen.has(cur.id)) errors.push('duplicate_sku');
    seen.add(cur.id);
    for (const v of [p.price, p.compareAt, p.cost]) {
      if (typeof v === 'number' && v < 0) errors.push('negative');
      else if (!okAmount(v)) errors.push('amount_invalid');
    }
    if (p.stock !== undefined && (!Number.isSafeInteger(p.stock) || p.stock < 0 || p.stock > 10_000_000)) errors.push(p.stock < 0 ? 'negative' : 'stock_invalid');
    const after = {
      price: p.price === undefined ? cur.priceBaisa : p.price,
      compareAt: p.compareAt === undefined ? cur.compareAtBaisa : p.compareAt,
      cost: p.cost === undefined ? cur.costBaisa : p.cost,
      stock: p.stock === undefined ? cur.stock : p.stock,
    };
    const priceChanged = after.price !== cur.priceBaisa || after.compareAt !== cur.compareAtBaisa || after.cost !== cur.costBaisa;
    const stockChanged = after.stock !== cur.stock;
    if (priceChanged && !canPrice) errors.push('forbidden_prices');
    if (stockChanged && !canStock) errors.push('forbidden_stock');
    if (after.compareAt !== null && after.price === null) errors.push('compare_without_price');
    else if (after.compareAt !== null && after.price !== null && after.compareAt <= after.price) errors.push('compare_not_higher');
    if (stockChanged && after.stock < cur.reserved) errors.push('below_reserved');
    const before = { price: cur.priceBaisa, compareAt: cur.compareAtBaisa, cost: cur.costBaisa, stock: cur.stock, reserved: cur.reserved };
    const unique = [...new Set(errors)];
    return {
      id: cur.id,
      sku: cur.sku,
      line: p.line,
      status: unique.length ? 'error' : priceChanged || stockChanged ? 'change' : 'unchanged',
      errors: unique,
      before,
      after,
      priceChanged,
      stockChanged,
    };
  });
}

const CURRENT_SELECT = { id: true, sku: true, productId: true, priceBaisa: true, compareAtBaisa: true, costBaisa: true, stock: true, reserved: true } as const;

/** Write a CLEAN plan (no error rows) — one audit row per changed variant, StockMovement per stock change. */
async function commitPlan(
  tx: Prisma.TransactionClient,
  actor: Actor,
  plan: readonly PlannedRow[],
  audit: (e: AuditInput) => Promise<void>,
  meta: { source: 'grid' | 'bulk' | 'import'; reason: string },
) {
  let prices = 0;
  let stocks = 0;
  for (const row of plan) {
    if (row.status !== 'change' || !row.id || !row.after || !row.before) continue;
    // Re-read under lock: the plan was computed on the same snapshot (SERIALIZABLE), this guards the invariants.
    const locked = await tx.$queryRaw<{ stock: number; reserved: number }[]>`SELECT stock, reserved FROM "ProductVariant" WHERE id = ${row.id} FOR UPDATE`;
    const cur = locked[0];
    if (!cur) throw new NotFoundError('ProductVariant');
    if (row.stockChanged && row.after.stock < cur.reserved) throw new ValidationError({ [row.sku]: ['below_reserved'] });
    await tx.productVariant.update({
      where: { id: row.id },
      data: { priceBaisa: row.after.price, compareAtBaisa: row.after.compareAt, costBaisa: row.after.cost, stock: row.after.stock },
    });
    if (row.priceChanged) {
      prices++;
      await audit({
        action: 'variant.price.update',
        entity: 'ProductVariant',
        entityId: row.id,
        before: { priceBaisa: row.before.price, compareAtBaisa: row.before.compareAt, costBaisa: row.before.cost },
        after: { priceBaisa: row.after.price, compareAtBaisa: row.after.compareAt, costBaisa: row.after.cost, source: meta.source },
      });
    }
    if (row.stockChanged) {
      stocks++;
      const delta = row.after.stock - row.before.stock;
      const movement = await tx.stockMovement.create({
        data: { variantId: row.id, type: row.before.stock === 0 && delta > 0 ? 'RECEIPT' : 'ADJUSTMENT', qty: delta, stockAfter: row.after.stock, reason: meta.reason, actorId: actor.id },
      });
      await audit({
        action: 'stock.adjust',
        entity: 'ProductVariant',
        entityId: row.id,
        before: { stock: row.before.stock },
        after: { stock: row.after.stock, delta, reason: meta.reason, movementId: movement.id, source: meta.source },
      });
    }
  }
  return { prices, stocks };
}

// ───────────── Grid / bulk (one product) ─────────────

const cell = z.union([z.number().int(), z.null()]).optional();
export const gridSchema = z.object({
  productId: idSchema,
  reason: z.string().trim().max(200, 'too_long').optional(),
  rows: z
    .array(z.object({ id: idSchema, price: cell, compareAt: cell, cost: cell, stock: z.number().int().optional() }))
    .min(1, 'required')
    .max(500, 'too_many'),
});

export type GridResult = { prices: number; stocks: number; errors: { sku: string; errors: PlanError[] }[] };

/**
 * Save the product quick-edit grid. Every row must belong to `productId`. All-or-nothing: if any
 * row is invalid nothing is written and the row errors are returned as field errors keyed by SKU.
 */
export const saveVariantGrid = defineMutation({
  name: 'variant.grid.save',
  permission: 'catalog:write',
  isolation: 'serializable',
  schema: gridSchema,
  async run({ tx, actor, input, audit }) {
    const current = await tx.productVariant.findMany({ where: { productId: input.productId }, select: CURRENT_SELECT });
    const rows = input.rows.filter((r) => current.some((c) => c.id === r.id));
    if (rows.length !== input.rows.length) throw new NotFoundError('ProductVariant');
    const plan = planVariantChanges(current, rows, actor.role);
    const bad = plan.filter((r) => r.status === 'error');
    if (bad.length) {
      if (bad.some((b) => b.errors.includes('forbidden_prices'))) throw new ForbiddenError('prices:write');
      if (bad.some((b) => b.errors.includes('forbidden_stock'))) throw new ForbiddenError('stock:write');
      const fieldErrors: Record<string, string[]> = {};
      for (const b of bad) {
        const i = rows.findIndex((r) => r.id === b.id);
        for (const e of b.errors) {
          const field = e === 'compare_not_higher' || e === 'compare_without_price' ? 'compareAt' : e === 'below_reserved' || e === 'stock_invalid' ? 'stock' : 'price';
          (fieldErrors[`rows.${i}.${field}`] ??= []).push(e);
        }
      }
      throw new ValidationError(fieldErrors);
    }
    const res = await commitPlan(tx, actor, plan, audit, { source: 'grid', reason: input.reason?.trim() || 'admin_quick_edit' });
    return { ...res, changed: plan.filter((r) => r.status === 'change').length };
  },
});

/**
 * FormData of the grid (`rows.<i>.id|price|compareAt|cost|stock`) → raw grid input. An empty price box
 * clears the price ("not decided yet"); a box that was not sent (no permission) stays unchanged.
 * Malformed / negative values become field errors — they are never coerced.
 */
export function parseGridForm(fd: FormData): { input: { productId: string; reason?: string; rows: VariantPatch[] }; fieldErrors: Record<string, string[]> } {
  const fieldErrors: Record<string, string[]> = {};
  const indexes = new Set<number>();
  for (const key of fd.keys()) {
    const m = /^rows\.(\d+)\.id$/.exec(key);
    if (m) indexes.add(Number(m[1]));
  }
  const rows: VariantPatch[] = [...indexes].sort((a, b) => a - b).map((i) => {
    const row: VariantPatch = { id: String(fd.get(`rows.${i}.id`) ?? '') };
    for (const field of ['price', 'compareAt', 'cost'] as const) {
      const v = fd.get(`rows.${i}.${field}`);
      if (typeof v !== 'string') continue;
      if (v.trim() === '') {
        row[field] = null;
        continue;
      }
      const r = parseOmrCell(v);
      if (r.code) (fieldErrors[`rows.${i}.${field}`] ??= []).push(r.code);
      else if (r.value !== undefined) row[field] = r.value;
    }
    const st = fd.get(`rows.${i}.stock`);
    if (typeof st === 'string') {
      const r = parseStockCell(st);
      if (r.code || r.value === undefined) (fieldErrors[`rows.${i}.stock`] ??= []).push(r.code ?? 'stock_invalid');
      else row.stock = r.value;
    }
    return row;
  });
  const reason = fd.get('reason');
  return { input: { productId: String(fd.get('productId') ?? ''), reason: typeof reason === 'string' ? reason : undefined, rows }, fieldErrors };
}

// ───────────── CSV import (any product) ─────────────

export const IMPORT_COLUMNS = ['sku', 'priceOmr', 'compareAtOmr', 'costOmr', 'stock'] as const;
export const MAX_IMPORT_ROWS = 5000;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

export type CsvRow = { line: number; sku: string; price?: number | null; compareAt?: number | null; cost?: number | null; stock?: number; bad: { field: string; code: 'amount_invalid' | 'negative' | 'stock_invalid' }[] };
export type CsvParse = { ok: true; rows: CsvRow[]; columns: string[] } | { ok: false; code: 'empty' | 'too_large' | 'too_many_rows' | 'missing_sku_column' | 'no_value_column' | 'malformed' };

/** RFC 4180-ish line splitter (quotes, doubled quotes, `,` or `;` delimiter). */
function splitCsv(text: string, delimiter: string): string[][] | null {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (quoted) return null;
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((f) => f.trim() !== ''));
}

/** OMR cell: digits with up to 3 decimals ('.' or ','), no sign, no thousands separators. Empty → undefined (unchanged). */
export function parseOmrCell(raw: string): { value?: number | null; code?: 'amount_invalid' | 'negative' } {
  const s = raw.trim().replace(/^'/, ''); // our own export prefixes formula-like cells with '
  if (s === '') return {};
  if (/^-/.test(s)) return { code: 'negative' };
  const m = /^(\d{1,7})(?:[.,](\d{1,3}))?$/.exec(s);
  if (!m) return { code: 'amount_invalid' };
  return { value: Number(m[1]) * 1000 + Number((m[2] ?? '').padEnd(3, '0') || '0') };
}

export function parseStockCell(raw: string): { value?: number; code?: 'stock_invalid' | 'negative' } {
  const s = raw.trim();
  if (s === '') return {};
  if (/^-/.test(s)) return { code: 'negative' };
  if (!/^\d{1,7}$/.test(s)) return { code: 'stock_invalid' };
  return { value: Number(s) };
}

const HEADER_ALIASES: Record<string, (typeof IMPORT_COLUMNS)[number]> = {
  sku: 'sku',
  priceomr: 'priceOmr',
  price: 'priceOmr',
  compareatomr: 'compareAtOmr',
  compareat: 'compareAtOmr',
  costomr: 'costOmr',
  cost: 'costOmr',
  stock: 'stock',
};

/** Parse an import file (pure). Unknown columns are ignored; empty cells mean "unchanged". */
export function parseVariantCsv(text: string): CsvParse {
  if (!text || !text.trim()) return { ok: false, code: 'empty' };
  if (Buffer.byteLength(text, 'utf8') > MAX_IMPORT_BYTES) return { ok: false, code: 'too_large' };
  const clean = text.replace(/^﻿/, '');
  const firstLine = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ';' : ',';
  const table = splitCsv(clean, delimiter);
  if (!table) return { ok: false, code: 'malformed' };
  const [header, ...body] = table;
  if (!header) return { ok: false, code: 'empty' };
  const cols = header.map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[^a-z]/g, '')] ?? null);
  const at = (name: (typeof IMPORT_COLUMNS)[number]) => cols.indexOf(name);
  if (at('sku') < 0) return { ok: false, code: 'missing_sku_column' };
  const valueCols = (['priceOmr', 'compareAtOmr', 'costOmr', 'stock'] as const).filter((c) => at(c) >= 0);
  if (!valueCols.length) return { ok: false, code: 'no_value_column' };
  if (body.length > MAX_IMPORT_ROWS) return { ok: false, code: 'too_many_rows' };
  const rows: CsvRow[] = body.map((cells, i) => {
    const get = (c: (typeof IMPORT_COLUMNS)[number]) => (at(c) >= 0 ? (cells[at(c)] ?? '') : '');
    const row: CsvRow = { line: i + 2, sku: get('sku').trim().toUpperCase(), bad: [] };
    for (const [col, key] of [['priceOmr', 'price'], ['compareAtOmr', 'compareAt'], ['costOmr', 'cost']] as const) {
      const r = parseOmrCell(get(col));
      if (r.code) row.bad.push({ field: col, code: r.code });
      else if (r.value !== undefined) row[key] = r.value;
    }
    const st = parseStockCell(get('stock'));
    if (st.code) row.bad.push({ field: 'stock', code: st.code });
    else if (st.value !== undefined) row.stock = st.value;
    return row;
  });
  return { ok: true, rows, columns: valueCols };
}

export type ImportPreview = {
  ok: boolean;
  /** Parse-level failure code (file not usable at all). */
  fileError?: Extract<CsvParse, { ok: false }>['code'];
  total: number;
  changes: number;
  unchanged: number;
  errors: number;
  rows: { line: number; sku: string; status: PlannedRow['status']; errors: string[]; before: PlannedRow['before']; after: PlannedRow['after'] }[];
};

async function planImport(db: Prisma.TransactionClient | typeof import('@/lib/db').prisma, text: string, role: Role): Promise<{ preview: ImportPreview; plan: PlannedRow[] }> {
  const parsed = parseVariantCsv(text);
  if (!parsed.ok) return { preview: { ok: false, fileError: parsed.code, total: 0, changes: 0, unchanged: 0, errors: 0, rows: [] }, plan: [] };
  const skus = [...new Set(parsed.rows.map((r) => r.sku).filter(Boolean))];
  const current = skus.length ? await db.productVariant.findMany({ where: { sku: { in: skus } }, select: CURRENT_SELECT }) : [];
  const bySku = new Map(current.map((c) => [c.sku, c]));
  const counts = new Map<string, number>();
  for (const r of parsed.rows) counts.set(r.sku, (counts.get(r.sku) ?? 0) + 1);
  const patches = parsed.rows.map((r) => ({ id: bySku.get(r.sku)?.id ?? `missing:${r.line}`, sku: r.sku, line: r.line, price: r.price, compareAt: r.compareAt, cost: r.cost, stock: r.stock }));
  const plan = planVariantChanges(current, patches, role).map((row, i) => {
    const src = parsed.rows[i]!;
    const extra: PlanError[] = [...src.bad.map((b) => b.code), ...((counts.get(src.sku) ?? 0) > 1 ? (['duplicate_sku'] as const) : [])];
    const errors = [...new Set([...row.errors, ...extra])];
    return { ...row, sku: src.sku || row.sku, errors, status: errors.length ? ('error' as const) : row.status };
  });
  const preview: ImportPreview = {
    ok: plan.every((r) => r.status !== 'error'),
    total: plan.length,
    changes: plan.filter((r) => r.status === 'change').length,
    unchanged: plan.filter((r) => r.status === 'unchanged').length,
    errors: plan.filter((r) => r.status === 'error').length,
    rows: plan
      .filter((r) => r.status !== 'unchanged')
      .slice(0, 300)
      .map((r) => ({ line: r.line ?? 0, sku: r.sku, status: r.status, errors: r.errors, before: r.before, after: r.after })),
  };
  return { preview, plan };
}

const importInput = z.object({ csv: z.string().max(MAX_IMPORT_BYTES + 1024, 'too_large'), idempotencyKey: idempotencyKeySchema.optional() });

/** Dry run: never writes. `catalog:write` required to look at the plan. */
export async function previewVariantImport(actor: Actor | null | undefined, raw: unknown): Promise<ImportPreview> {
  assertCan(actor, 'catalog:write');
  const input = importInput.safeParse(raw);
  if (!input.success) throw new ValidationError({ csv: ['too_large'] });
  const { prisma } = await import('@/lib/db');
  return (await planImport(prisma, input.data.csv, actor.role)).preview;
}

/** Apply a CLEAN import atomically (re-planned on the server; a file with any error is refused). */
export const applyVariantImport = defineMutation({
  name: 'variant.import',
  permission: 'catalog:write',
  isolation: 'serializable',
  schema: importInput,
  async run({ tx, actor, input, audit }) {
    const { preview, plan } = await planImport(tx, input.csv, actor.role);
    if (preview.fileError) throw new AdminError('import_file_invalid');
    if (!preview.ok) throw new AdminError('import_has_errors');
    if (preview.changes === 0) throw new AdminError('import_nothing');
    const res = await commitPlan(tx, actor, plan, audit, { source: 'import', reason: 'csv_import' });
    await audit({ action: 'variant.import', entity: 'ProductVariant', after: { rows: preview.total, changes: preview.changes, ...res } });
    return { ...res, changes: preview.changes };
  },
});

// ───────────── CSV export ─────────────

export const EXPORT_HEADER = ['sku', 'priceOmr', 'compareAtOmr', 'costOmr', 'stock', 'reserved', 'product', 'productSku', 'color', 'capacity', 'productStatus'] as const;

export function exportRow(
  v: { sku: string; priceBaisa: number | null; compareAtBaisa: number | null; costBaisa: number | null; stock: number; reserved: number; color: string | null; capacity: string | null },
  product: { name: string; sku: string; status: string },
  includeCost: boolean,
) {
  return [v.sku, baisaToCsv(v.priceBaisa), baisaToCsv(v.compareAtBaisa), includeCost ? baisaToCsv(v.costBaisa) : '', v.stock, v.reserved, product.name, product.sku, v.color ?? '', v.capacity ?? '', product.status];
}
