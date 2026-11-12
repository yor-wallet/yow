import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ValidationError } from './actor';
import { defineMutation } from './mutation';

/**
 * Catalogue import (JSON pack → DRAFT products).
 *
 * A pack lists CANDIDATE models: its colours and capacities are not verified per model or region.
 * So the import never creates a variant, a price, a stock quantity or an image, and never publishes
 * anything: each model becomes a DRAFT product whose candidates are kept as admin-only notes
 * (`Product.importMeta`) until a staff member checks the official page and creates the real SKUs.
 *
 * Idempotent and non-destructive: a model already imported (same slug) only gets its notes refreshed;
 * what staff edited since (name, description, variants, status…) is left untouched.
 */

const MAX_ITEMS = 500;

const itemSchema = z.object({
  id: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(80),
  brand: z.string().trim().min(1).max(60),
  series: z.string().trim().max(80).optional().default(''),
  model: z.string().trim().min(1).max(120),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  colors: z.array(z.string().trim().min(1).max(60)).max(40).optional().default([]),
  storage_gb: z.array(z.number().int().positive().max(8192)).max(12).optional().default([]),
  specs_status: z.string().trim().max(300).optional().default(''),
  // Shown as a link in the admin: only real web addresses (never `javascript:` and the like).
  source_officielle: z
    .string()
    .trim()
    .max(500)
    .refine((v) => /^https?:\/\/[^\s]+$/i.test(v) && URL.canParse(v), 'invalid')
    .nullable()
    .optional(),
});

export const catalogueImportSchema = z.object({
  batch: z.string().trim().min(1).max(60),
  items: z.array(itemSchema).min(1).max(MAX_ITEMS),
});

export type ImportMeta = {
  batch: string;
  externalId: string;
  series: string;
  year: number | null;
  /** Unverified: to be confirmed on the official page before any SKU is created. */
  candidateColors: string[];
  candidateStorageGb: number[];
  specsStatus: string;
  sourceUrl: string | null;
  importedAt: string;
};

export function readImportMeta(value: unknown): ImportMeta | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Partial<ImportMeta>;
  if (typeof v.batch !== 'string' || typeof v.externalId !== 'string') return null;
  return {
    batch: v.batch,
    externalId: v.externalId,
    series: typeof v.series === 'string' ? v.series : '',
    year: typeof v.year === 'number' ? v.year : null,
    candidateColors: Array.isArray(v.candidateColors) ? v.candidateColors.filter((c): c is string => typeof c === 'string') : [],
    candidateStorageGb: Array.isArray(v.candidateStorageGb) ? v.candidateStorageGb.filter((n): n is number => typeof n === 'number') : [],
    specsStatus: typeof v.specsStatus === 'string' ? v.specsStatus : '',
    sourceUrl: typeof v.sourceUrl === 'string' && /^https?:\/\//i.test(v.sourceUrl) ? v.sourceUrl : null,
    importedAt: typeof v.importedAt === 'string' ? v.importedAt : '',
  };
}

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

export type CatalogueImportResult = { created: number; refreshed: number; brandsCreated: string[]; total: number };

export const importCatalogue = defineMutation({
  name: 'catalogue.import',
  permission: 'catalog:write',
  schema: catalogueImportSchema,
  async run({ tx, input, audit, actor }): Promise<CatalogueImportResult> {
    const ids = input.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) throw new ValidationError({ file: ['duplicate_ids'] });

    const phones = await tx.category.findMany({ where: { slug: { startsWith: 'smartphones' } }, select: { id: true, slug: true } });
    const categoryBySlug = new Map(phones.map((c) => [c.slug, c.id]));
    const fallbackCategory = categoryBySlug.get('smartphones-other') ?? categoryBySlug.get('smartphones');
    if (!fallbackCategory) throw new ValidationError({ file: ['category_missing'] });

    const brandIds = new Map<string, string>();
    const brandsCreated: string[] = [];
    for (const name of new Set(input.items.map((i) => i.brand))) {
      const slug = slugOf(name);
      if (!slug) throw new ValidationError({ file: ['invalid'] });
      const existing = await tx.brand.findUnique({ where: { slug }, select: { id: true } });
      if (existing) brandIds.set(name, existing.id);
      else {
        const b = await tx.brand.create({ data: { slug, name }, select: { id: true } });
        brandIds.set(name, b.id);
        brandsCreated.push(name);
      }
    }

    const existing = new Map((await tx.product.findMany({ where: { slug: { in: ids } }, select: { id: true, slug: true } })).map((p) => [p.slug, p.id]));
    const now = new Date().toISOString();
    let created = 0;
    let refreshed = 0;
    for (const item of input.items) {
      const meta: ImportMeta = {
        batch: input.batch,
        externalId: item.id,
        series: item.series,
        year: item.year ?? null,
        candidateColors: [...new Set(item.colors)],
        candidateStorageGb: [...new Set(item.storage_gb)].sort((a, b) => a - b),
        specsStatus: item.specs_status,
        sourceUrl: item.source_officielle ?? null,
        importedAt: now,
      };
      const productId = existing.get(item.id);
      if (productId) {
        await tx.product.update({ where: { id: productId }, data: { importMeta: meta as unknown as Prisma.InputJsonValue } });
        refreshed++;
        continue;
      }
      const brandSlug = slugOf(item.brand);
      await tx.product.create({
        data: {
          slug: item.id,
          sku: `IMP-${item.id.toUpperCase()}`.slice(0, 64),
          brandId: brandIds.get(item.brand)!,
          categoryId: categoryBySlug.get(`smartphones-${brandSlug}`) ?? fallbackCategory,
          model: item.model,
          // Model names are trade names: the same in the three languages until staff localise them.
          name: { ar: item.model, en: item.model, fr: item.model },
          status: 'DRAFT',
          createdById: actor.id,
          importMeta: meta as unknown as Prisma.InputJsonValue,
        },
      });
      created++;
    }
    await audit({ action: 'catalogue.import', entity: 'Product', entityId: input.batch, after: { batch: input.batch, total: input.items.length, created, refreshed, brandsCreated } });
    return { created, refreshed, brandsCreated, total: input.items.length };
  },
});

/** Parse an uploaded pack: either the bare array of models or `{ items: [...] }`. */
export function parseCataloguePack(text: string): unknown[] | null {
  try {
    const data: unknown = JSON.parse(text.replace(/^﻿/, ''));
    if (Array.isArray(data)) return data;
    if (data && typeof data === 'object' && Array.isArray((data as { items?: unknown }).items)) return (data as { items: unknown[] }).items;
    return null;
  } catch {
    return null;
  }
}
