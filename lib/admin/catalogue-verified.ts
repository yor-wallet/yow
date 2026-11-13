import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { ValidationError } from './actor';
import { defineMutation } from './mutation';
import type { ImportMeta } from './catalogue-import';

/**
 * Verified catalogue import (`data/catalogue/verified-catalogue-2026.json`).
 *
 * The file is produced by `scripts/catalogue-research/*` from OFFICIAL manufacturer pages. It holds
 * facts only: names, series, year, colours (with the manufacturer's swatch when published),
 * storage/RAM configurations, specifications, real part numbers, and the source URLs with the date
 * they were checked. It NEVER holds a price, a stock quantity, a review or a photo, and this import
 * never creates any.
 *
 * What it creates
 *  · Products (always DRAFT first; `publish: true` then activates the ones that are fully verified).
 *  · Variants (colour × storage) ONLY when the source confirms the matrix (`variantMatrix: confirmed`:
 *    Apple lists every finish in every capacity; Samsung lists each real SKU). Variants are created
 *    without price (`priceBaisa = null`) and with stock 0 — so they show "price coming soon" and cannot
 *    be bought until staff enter the real price and stock.
 *  · For models whose colour × capacity matrix is NOT confirmed (HONOR, OPPO) or that have no official
 *    page yet, the candidates stay admin-only notes (`Product.importMeta`) and the product stays DRAFT.
 *
 * Idempotent and non-destructive: an existing product only receives facts it lacks (series, year,
 * sources, specs while still empty); existing variants (matched by SKU) are never modified, so
 * prices and stock entered by staff are safe.
 */

const text = z.string().trim().min(1).max(400);
const localized = z.object({ ar: text, en: text, fr: text });

const modelSchema = z.object({
  id: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(80),
  verified: z.boolean(),
  brand: z.string().trim().min(1).max(60),
  series: z.string().trim().max(80).nullable().optional(),
  model: z.string().trim().min(1).max(120),
  year: z.number().int().min(2000).max(2100).nullable().optional(),
  sources: z
    .array(z.object({ label: z.string().trim().min(1).max(200), url: z.string().trim().max(500).refine((v) => /^https?:\/\/[^\s]+$/i.test(v) && URL.canParse(v), 'invalid') }))
    .max(8)
    .default([]),
  checkedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  colors: z
    .array(z.object({ name: z.string().trim().min(1).max(60), hex: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullable().optional() }))
    .max(40)
    .default([]),
  configs: z.array(z.object({ ramGb: z.number().int().positive().max(512), storageGb: z.number().int().positive().max(8192) })).max(20).default([]),
  variantMatrix: z.enum(['confirmed', 'unconfirmed']).default('unconfirmed'),
  variants: z
    .array(
      z.object({
        color: z.string().trim().min(1).max(60),
        storageGb: z.number().int().positive().max(8192),
        ramGb: z.number().int().positive().max(512).nullable().optional(),
        mpn: z.string().trim().max(40).nullable().optional(),
      }),
    )
    .max(80)
    .default([]),
  specs: z
    .array(z.object({ key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_-]+$/i), label: localized, value: localized }))
    .max(60)
    .default([]),
  pack: z.object({ colors: z.array(z.string()).default([]), storage_gb: z.array(z.number()).default([]), source_officielle: z.string().nullable().optional() }).partial().optional(),
});

export const verifiedCatalogueSchema = z.object({
  models: z.array(modelSchema).min(1).max(500),
  publish: z.boolean().default(false),
});
export type VerifiedModel = z.infer<typeof modelSchema>;

const slugOf = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** "256 GB" / "1 TB" — the capacity text shown to shoppers and used by the capacity filter. */
export function capacityLabel(gb: number): string {
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024} TB` : `${gb} GB`;
}

/** Product name shown in the three languages: brand trade names are not translated. */
export function displayName(brand: string, model: string): string {
  if (brand === 'Apple') return model;
  return model.toLowerCase().startsWith(brand.toLowerCase()) ? model : `${brand} ${model}`;
}

/** Stable variant SKU: the manufacturer part number when published, else derived from model + colour + capacity. */
export function variantSku(modelId: string, v: { color: string; storageGb: number; mpn?: string | null }): string {
  if (v.mpn) return v.mpn.toUpperCase();
  return `${modelId}-${slugOf(v.color)}-${v.storageGb}`.toUpperCase().slice(0, 60);
}

export type VerifiedImportResult = { productsCreated: number; productsUpdated: number; variantsCreated: number; published: number; unverified: number; draftsAwaitingMatrix: number; brandsCreated: string[] };

export const importVerifiedCatalogue = defineMutation({
  name: 'catalogue.import_verified',
  permission: 'catalog:write',
  schema: verifiedCatalogueSchema,
  async run({ tx, input, audit, actor }): Promise<VerifiedImportResult> {
    const ids = input.models.map((m) => m.id);
    if (new Set(ids).size !== ids.length) throw new ValidationError({ file: ['duplicate_ids'] });

    // Categories: smartphones-<brand> when it exists; OPPO is created on demand under "smartphones".
    let phones = await tx.category.findMany({ where: { slug: { startsWith: 'smartphones' } }, select: { id: true, slug: true } });
    const root = phones.find((c) => c.slug === 'smartphones');
    if (!root) throw new ValidationError({ file: ['category_missing'] });
    if (input.models.some((m) => m.brand === 'OPPO') && !phones.some((c) => c.slug === 'smartphones-oppo')) {
      const sort = await tx.category.count({ where: { parentId: root.id } });
      const c = await tx.category.create({
        data: { slug: 'smartphones-oppo', icon: 'smartphone', name: { ar: 'أوبو', en: 'OPPO', fr: 'OPPO' }, parentId: root.id, sort },
        select: { id: true, slug: true },
      });
      phones = [...phones, c];
    }
    const categoryBySlug = new Map(phones.map((c) => [c.slug, c.id]));
    const fallbackCategory = categoryBySlug.get('smartphones-other') ?? root.id;

    const brandIds = new Map<string, string>();
    const brandsCreated: string[] = [];
    for (const name of new Set(input.models.map((m) => m.brand))) {
      const slug = slugOf(name);
      const existing = await tx.brand.findUnique({ where: { slug }, select: { id: true } });
      if (existing) brandIds.set(name, existing.id);
      else {
        const b = await tx.brand.create({ data: { slug, name }, select: { id: true } });
        brandIds.set(name, b.id);
        brandsCreated.push(name);
      }
    }

    const existingProducts = new Map(
      (
        await tx.product.findMany({
          where: { slug: { in: ids } },
          select: { id: true, slug: true, status: true, specs: true, series: true, modelYear: true, importMeta: true, specsVerified: true, variants: { select: { sku: true, isActive: true } } },
        })
      ).map((p) => [p.slug, p]),
    );
    const now = new Date();
    const out: VerifiedImportResult = { productsCreated: 0, productsUpdated: 0, variantsCreated: 0, published: 0, unverified: 0, draftsAwaitingMatrix: 0, brandsCreated };

    for (const m of input.models) {
      const factsVerified = m.verified && m.specs.length > 0;
      const confirmed = m.verified && m.variantMatrix === 'confirmed' && m.variants.length > 0;
      if (!m.verified) out.unverified++;
      else if (!confirmed) out.draftsAwaitingMatrix++;

      const meta: ImportMeta = {
        batch: `verified-${m.checkedAt}`,
        externalId: m.id,
        series: m.series ?? '',
        year: m.year ?? null,
        candidateColors: [...new Set((m.colors.length ? m.colors.map((c) => c.name) : (m.pack?.colors ?? [])))],
        candidateStorageGb: [...new Set(m.configs.length ? m.configs.map((c) => c.storageGb) : (m.pack?.storage_gb ?? []))].sort((a, b) => a - b),
        specsStatus: !m.verified
          ? 'Aucune fiche officielle trouvée le ' + m.checkedAt + ' : modèle à vérifier avant publication.'
          : confirmed
            ? 'Fiche officielle vérifiée le ' + m.checkedAt + ' : variantes créées sans prix ni stock.'
            : 'Fiche officielle vérifiée le ' + m.checkedAt + ' : combinaisons couleur × capacité à confirmer avant de créer les variantes.',
        sourceUrl: m.sources[0]?.url ?? m.pack?.source_officielle ?? null,
        importedAt: now.toISOString(),
      };

      const name = displayName(m.brand, m.model);
      const brandSlug = slugOf(m.brand);
      const existing = existingProducts.get(m.id);
      let productId: string;
      if (existing) {
        productId = existing.id;
        const data: Prisma.ProductUpdateInput = { importMeta: meta as unknown as Prisma.InputJsonValue };
        if (existing.series === null && m.series) data.series = m.series;
        if (existing.modelYear === null && m.year) data.modelYear = m.year;
        if (m.sources.length) {
          data.sourceLinks = m.sources as unknown as Prisma.InputJsonValue;
          data.sourceCheckedAt = new Date(`${m.checkedAt}T00:00:00Z`);
        }
        const emptySpecs = Array.isArray(existing.specs) && existing.specs.length === 0;
        if (factsVerified && emptySpecs) {
          data.specs = m.specs as unknown as Prisma.InputJsonValue;
          data.specsVerified = true;
        }
        await tx.product.update({ where: { id: existing.id }, data });
        out.productsUpdated++;
      } else {
        const p = await tx.product.create({
          data: {
            slug: m.id,
            sku: `IMP-${m.id.toUpperCase()}`.slice(0, 64),
            brandId: brandIds.get(m.brand)!,
            categoryId: categoryBySlug.get(`smartphones-${brandSlug}`) ?? fallbackCategory,
            model: m.model,
            name: { ar: name, en: name, fr: name },
            specs: (factsVerified ? m.specs : []) as unknown as Prisma.InputJsonValue,
            specsVerified: factsVerified,
            series: m.series ?? null,
            modelYear: m.year ?? null,
            sourceLinks: (m.sources.length ? m.sources : null) as unknown as Prisma.InputJsonValue,
            sourceCheckedAt: m.sources.length ? new Date(`${m.checkedAt}T00:00:00Z`) : null,
            status: 'DRAFT',
            createdById: actor.id,
            importMeta: meta as unknown as Prisma.InputJsonValue,
          },
          select: { id: true },
        });
        productId = p.id;
        out.productsCreated++;
      }

      // Variants: only when the source confirms the matrix. Existing SKUs are left untouched.
      let activeVariants = existing?.variants.filter((v) => v.isActive).length ?? 0;
      if (confirmed) {
        const known = new Set((existing?.variants ?? []).map((v) => v.sku));
        const hexOf = new Map(m.colors.map((c) => [c.name.toLowerCase(), c.hex?.toLowerCase() ?? null]));
        const ordered = [...m.variants].sort((a, b) => a.storageGb - b.storageGb || m.colors.findIndex((c) => c.name === a.color) - m.colors.findIndex((c) => c.name === b.color));
        let sort = known.size;
        const rows: Prisma.ProductVariantCreateManyInput[] = [];
        for (const v of ordered) {
          const sku = variantSku(m.id, v);
          if (known.has(sku)) continue;
          const label = capacityLabel(v.storageGb);
          rows.push({
            productId,
            sku,
            name: { ar: `${label} · ${v.color}`, en: `${label} · ${v.color}`, fr: `${label} · ${v.color}` },
            color: v.color,
            colorHex: hexOf.get(v.color.toLowerCase()) ?? null,
            capacity: label,
            storageGb: v.storageGb,
            ramGb: v.ramGb ?? null,
            mpn: v.mpn ?? null,
            priceBaisa: null,
            stock: 0,
            isActive: true,
            isDefault: known.size === 0 && sort === 0,
            sort: sort++,
          });
          known.add(sku);
        }
        // One statement per product: the import must stay fast when the database is far from the caller.
        if (rows.length) {
          await tx.productVariant.createMany({ data: rows });
          activeVariants += rows.length;
          out.variantsCreated += rows.length;
        }
      }

      // Publishing is explicit, never automatic: only fully verified models that are still import-managed drafts.
      const managed = !existing || existing.importMeta !== null;
      if (input.publish && factsVerified && confirmed && activeVariants > 0 && managed && (!existing || existing.status === 'DRAFT')) {
        await tx.product.update({ where: { id: productId }, data: { status: 'ACTIVE', publishedAt: now } });
        out.published++;
      }
    }

    await audit({
      action: 'catalogue.import_verified',
      entity: 'Product',
      entityId: `verified-${input.models[0]!.checkedAt}`,
      after: { ...out, total: input.models.length, publish: input.publish },
    });
    return out;
  },
});
