import { z } from 'zod';
import type { Prisma, ProductStatus } from '@prisma/client';
import { prisma } from '@/lib/db';
import { isUniqueViolation } from '@/lib/db';
import { can } from '@/lib/rbac';
import { parseOmrToBaisa } from '@/lib/money';
import { partialLocalizedTextSchema } from '@/lib/localized';
import { mediaUrl } from '@/lib/storage';
import { slugSchema, idSchema } from '@/lib/validation';
import { ForbiddenError, NotFoundError, ValidationError, AdminError } from './actor';
import { changedFields, defineMutation } from './mutation';
import { deleteImageFamily, storeOptimisedImage } from './media';
import { validateMedia } from './media';
import { enumParam, parseTableQuery, type SearchParams } from './table';

/**
 * Catalogue administration: products, variants (price / stock) and images.
 * Every write is an RBAC-checked mutation that commits together with its audit row
 * (`lib/admin/mutation.ts`). Prices are entered in OMR with up to 3 decimals and stored as
 * integer baisa; a variant without a price is simply "not sellable" (never a default price).
 * Stock changes also append a `StockMovement` so inventory stays explainable.
 */

// ───────────────────────── schemas ─────────────────────────

const atLeastOne = (v: Record<string, string | undefined>) => Object.values(v).some((x) => !!x && x.trim() !== '');
const localizedRequired = partialLocalizedTextSchema.refine(atLeastOne, 'required');

const listOf = z.array(z.string().trim().min(1).max(200)).max(12);
const highlightsSchema = z.object({ ar: listOf.default([]), en: listOf.default([]), fr: listOf.default([]) }).default({ ar: [], en: [], fr: [] });
const specSchema = z.object({
  key: z.string().trim().min(1).max(60).regex(/^[a-z0-9_-]+$/i, 'slug_invalid'),
  label: localizedRequired,
  value: localizedRequired,
});

const sku = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'required')
  .max(60, 'too_long')
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, 'sku_invalid');

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, 'too_long')
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

const optionalInt = (min: number, max: number) =>
  z
    .number({ invalid_type_error: 'invalid' })
    .int('invalid')
    .min(min, 'invalid')
    .max(max, 'invalid')
    .optional()
    .nullable()
    .transform((v) => (v === undefined ? null : v));

export const productInputSchema = z.object({
  slug: slugSchema.optional(),
  sku,
  name: localizedRequired,
  description: partialLocalizedTextSchema.optional().nullable(),
  highlights: highlightsSchema,
  specs: z.array(specSchema).max(60).default([]),
  model: optionalText(80),
  brandId: idSchema.optional().nullable().transform((v) => v || null),
  categoryId: idSchema,
  warrantyMonths: optionalInt(0, 120),
  isSellable: z.boolean().default(true),
  isFeatured: z.boolean().default(false),
  isDealOfDay: z.boolean().default(false),
  isRecommended: z.boolean().default(false),
  isNewArrival: z.boolean().default(false),
  expressEligible: z.boolean().default(true),
  weightGrams: optionalInt(0, 1_000_000),
  volumeCm3: optionalInt(0, 100_000_000),
});

/** URL slug derived from an English (else any) name, then the SKU. */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 100);
}

function pickSlug(input: { slug?: string; name: Record<string, string | undefined>; sku: string }): string {
  return input.slug || slugify(input.name.en ?? '') || slugify(input.sku) || `product-${Date.now().toString(36)}`;
}

/** OMR text ("329", "329.5", "329,500" in fr…) → baisa; '' / null → null (no price). */
const omrField = z
  .union([z.string(), z.number(), z.null()])
  .optional()
  .transform((v, ctx) => {
    if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) return null;
    const baisa = parseOmrToBaisa(v);
    if (baisa === null || baisa < 0 || baisa > 1_000_000_000) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'amount_invalid' });
      return z.NEVER;
    }
    return baisa;
  });

export const variantInputSchema = z.object({
  id: idSchema.optional(),
  productId: idSchema,
  sku,
  name: partialLocalizedTextSchema.optional().nullable(),
  color: optionalText(40),
  colorHex: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, 'color_invalid')
    .optional()
    .nullable()
    .or(z.literal(''))
    .transform((v) => (v ? v : null)),
  capacity: optionalText(40),
  price: omrField,
  compareAt: omrField,
  cost: omrField,
  stock: z.number({ required_error: 'required', invalid_type_error: 'invalid' }).int('invalid').min(0, 'invalid').max(1_000_000, 'invalid'),
  lowStockThreshold: z.number({ invalid_type_error: 'invalid' }).int('invalid').min(0, 'invalid').max(10_000, 'invalid').default(2),
  isActive: z.boolean().default(true),
  isDefault: z.boolean().default(false),
  sort: z.number({ invalid_type_error: 'invalid' }).int('invalid').min(0, 'invalid').max(10_000, 'invalid').default(0),
});

// ───────────────────────── mutations ─────────────────────────

async function requireCategory(tx: Prisma.TransactionClient, id: string) {
  const c = await tx.category.findUnique({ where: { id }, select: { id: true } });
  if (!c) throw new ValidationError({ categoryId: ['invalid'] });
}

async function requireBrand(tx: Prisma.TransactionClient, id: string | null) {
  if (!id) return;
  const b = await tx.brand.findUnique({ where: { id }, select: { id: true } });
  if (!b) throw new ValidationError({ brandId: ['invalid'] });
}

function productData(input: z.output<typeof productInputSchema>) {
  return {
    sku: input.sku,
    name: input.name as Prisma.InputJsonValue,
    description: (input.description ?? undefined) as Prisma.InputJsonValue | undefined,
    highlights: input.highlights as Prisma.InputJsonValue,
    specs: input.specs as Prisma.InputJsonValue,
    model: input.model,
    brandId: input.brandId,
    categoryId: input.categoryId,
    warrantyMonths: input.warrantyMonths,
    isSellable: input.isSellable,
    isFeatured: input.isFeatured,
    isDealOfDay: input.isDealOfDay,
    isRecommended: input.isRecommended,
    isNewArrival: input.isNewArrival,
    expressEligible: input.expressEligible,
    weightGrams: input.weightGrams,
    volumeCm3: input.volumeCm3,
  };
}

/** New products start as DRAFT: nothing is visible to customers until an administrator publishes it. */
export const createProduct = defineMutation({
  name: 'product.create',
  permission: 'catalog:write',
  schema: productInputSchema,
  async run({ tx, input, audit, actor }) {
    await requireCategory(tx, input.categoryId);
    await requireBrand(tx, input.brandId);
    const slug = pickSlug(input);
    try {
      const p = await tx.product.create({ data: { ...productData(input), slug, status: 'DRAFT', createdById: actor.id }, select: { id: true, slug: true } });
      await audit({ action: 'product.create', entity: 'Product', entityId: p.id, after: { sku: input.sku, slug, name: input.name, status: 'DRAFT' } });
      return p;
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) throw new ValidationError({ slug: ['slug_taken'] });
      if (isUniqueViolation(err, 'sku')) throw new ValidationError({ sku: ['sku_taken'] });
      throw err;
    }
  },
});

export const updateProduct = defineMutation({
  name: 'product.update',
  permission: 'catalog:write',
  schema: productInputSchema.extend({ id: idSchema }),
  async run({ tx, input, audit }) {
    const before = await tx.product.findUnique({ where: { id: input.id } });
    if (!before) throw new NotFoundError('product');
    await requireCategory(tx, input.categoryId);
    await requireBrand(tx, input.brandId);
    const data = productData(input);
    try {
      const after = await tx.product.update({ where: { id: input.id }, data: { ...data, ...(input.slug ? { slug: input.slug } : {}) } });
      const diff = changedFields(before as unknown as Record<string, unknown>, after as unknown as Record<string, unknown>);
      await audit({ action: 'product.update', entity: 'Product', entityId: input.id, before: diff.before, after: diff.after });
      return { id: after.id, slug: after.slug };
    } catch (err) {
      if (isUniqueViolation(err, 'slug')) throw new ValidationError({ slug: ['slug_taken'] });
      if (isUniqueViolation(err, 'sku')) throw new ValidationError({ sku: ['sku_taken'] });
      throw err;
    }
  },
});

const STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED'] as const satisfies readonly ProductStatus[];

/** Publish / unpublish. A product needs at least one active variant to be published. */
export const setProductStatus = defineMutation({
  name: 'product.status',
  permission: 'catalog:write',
  schema: z.object({ id: idSchema, status: z.enum(STATUSES) }),
  async run({ tx, input, audit }) {
    const p = await tx.product.findUnique({ where: { id: input.id }, select: { id: true, status: true, publishedAt: true, _count: { select: { variants: { where: { isActive: true } } } } } });
    if (!p) throw new NotFoundError('product');
    if (input.status === 'ACTIVE' && p._count.variants === 0) throw new AdminError('product_needs_variant');
    await tx.product.update({ where: { id: p.id }, data: { status: input.status, ...(input.status === 'ACTIVE' && !p.publishedAt ? { publishedAt: new Date() } : {}) } });
    await audit({ action: 'product.status', entity: 'Product', entityId: p.id, before: { status: p.status }, after: { status: input.status } });
    return { id: p.id, status: input.status };
  },
});

export const saveVariant = defineMutation({
  name: 'variant.save',
  permission: 'catalog:write',
  schema: variantInputSchema,
  async run({ tx, input, audit, actor }) {
    const product = await tx.product.findUnique({ where: { id: input.productId }, select: { id: true } });
    if (!product) throw new NotFoundError('product');
    const existing = input.id ? await tx.productVariant.findUnique({ where: { id: input.id } }) : null;
    if (input.id && (!existing || existing.productId !== input.productId)) throw new NotFoundError('variant');

    // Fine-grained RBAC: price and stock have their own permissions.
    const priceChanged = !existing || existing.priceBaisa !== input.price || existing.compareAtBaisa !== input.compareAt || existing.costBaisa !== input.cost;
    if (priceChanged && (input.price !== null || input.compareAt !== null || input.cost !== null || existing) && !can(actor.role, 'prices:write')) throw new ForbiddenError('prices:write');
    const stockChanged = !existing || existing.stock !== input.stock;
    if (stockChanged && !can(actor.role, 'stock:write')) throw new ForbiddenError('stock:write');
    if (input.compareAt !== null && input.price !== null && input.compareAt <= input.price) throw new ValidationError({ compare: ['compare_not_higher'] });
    if (existing && input.stock < existing.reserved) throw new ValidationError({ stock: ['below_reserved'] });

    const data = {
      sku: input.sku,
      name: (input.name ?? undefined) as Prisma.InputJsonValue | undefined,
      color: input.color,
      colorHex: input.colorHex,
      capacity: input.capacity,
      priceBaisa: input.price,
      compareAtBaisa: input.compareAt,
      costBaisa: input.cost,
      stock: input.stock,
      lowStockThreshold: input.lowStockThreshold,
      isActive: input.isActive,
      isDefault: input.isDefault,
      sort: input.sort,
    };
    try {
      if (input.isDefault) await tx.productVariant.updateMany({ where: { productId: input.productId, ...(existing ? { id: { not: existing.id } } : {}) }, data: { isDefault: false } });
      const saved = existing
        ? await tx.productVariant.update({ where: { id: existing.id }, data })
        : await tx.productVariant.create({ data: { ...data, productId: input.productId } });
      if (!existing || existing.stock !== saved.stock) {
        await tx.stockMovement.create({
          data: { variantId: saved.id, type: existing ? 'ADJUSTMENT' : 'RECEIPT', qty: saved.stock - (existing?.stock ?? 0), stockAfter: saved.stock, reason: existing ? 'admin_edit' : 'initial_stock', actorId: actor.id },
        });
      }
      await audit({
        action: existing ? 'variant.update' : 'variant.create',
        entity: 'ProductVariant',
        entityId: saved.id,
        before: existing ? changedFields(existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>).before : undefined,
        after: existing ? changedFields(existing as unknown as Record<string, unknown>, saved as unknown as Record<string, unknown>).after : { sku: saved.sku, priceBaisa: saved.priceBaisa, stock: saved.stock },
      });
      return { id: saved.id };
    } catch (err) {
      if (isUniqueViolation(err, 'sku')) throw new ValidationError({ sku: ['sku_taken'] });
      throw err;
    }
  },
});

/** A variant that was ever ordered is deactivated instead of deleted (order history keeps its meaning). */
export const deleteVariant = defineMutation({
  name: 'variant.delete',
  permission: 'catalog:write',
  schema: z.object({ id: idSchema }),
  async run({ tx, input, audit }) {
    const v = await tx.productVariant.findUnique({ where: { id: input.id }, select: { id: true, sku: true, productId: true, _count: { select: { orderItems: true } } } });
    if (!v) throw new NotFoundError('variant');
    if (v._count.orderItems > 0) throw new AdminError('variant_in_use');
    await tx.productVariant.delete({ where: { id: v.id } });
    await audit({ action: 'variant.delete', entity: 'ProductVariant', entityId: v.id, before: { sku: v.sku } });
    return { id: v.id, productId: v.productId };
  },
});

// ───────────────────────── images ─────────────────────────

/** Validate, optimise (WebP + AVIF + responsive sizes) and attach an image. The file is checked by its magic bytes. */
export async function addProductImage(
  actor: Parameters<typeof createProduct>[0],
  input: { productId: string; variantId?: string | null; file: Buffer; alt?: Record<string, string | undefined> | null },
) {
  const mutation = defineMutation({
    name: 'product.image.add',
    permission: 'catalog:write',
    schema: z.object({ productId: idSchema, variantId: idSchema.optional().nullable(), alt: partialLocalizedTextSchema.optional().nullable() }),
    async run({ tx, input: i, audit }) {
      const p = await tx.product.findUnique({ where: { id: i.productId }, select: { id: true } });
      if (!p) throw new NotFoundError('product');
      if (i.variantId) {
        const v = await tx.productVariant.findFirst({ where: { id: i.variantId, productId: i.productId }, select: { id: true } });
        if (!v) throw new ValidationError({ variantId: ['invalid'] });
      }
      const check = validateMedia(input.file, 'image');
      if (!check.ok) throw new ValidationError({ file: [check.code] });
      let stored;
      try {
        stored = await storeOptimisedImage(input.file, `products/${i.productId}`);
      } catch {
        throw new ValidationError({ file: ['bad_image'] });
      }
      const last = await tx.productImage.aggregate({ where: { productId: i.productId }, _max: { sort: true } });
      const image = await tx.productImage.create({
        data: { productId: i.productId, variantId: i.variantId ?? null, key: stored.key, width: stored.width, height: stored.height, alt: (i.alt ?? undefined) as Prisma.InputJsonValue | undefined, sort: (last._max.sort ?? -1) + 1 },
      });
      await audit({ action: 'product.image.add', entity: 'ProductImage', entityId: image.id, after: { productId: i.productId, key: stored.key } });
      return { id: image.id };
    },
  });
  return mutation(actor, { productId: input.productId, variantId: input.variantId, alt: input.alt });
}

export const deleteProductImage = defineMutation({
  name: 'product.image.delete',
  permission: 'catalog:write',
  schema: z.object({ id: idSchema }),
  async run({ tx, input, audit }) {
    const img = await tx.productImage.findUnique({ where: { id: input.id } });
    if (!img) throw new NotFoundError('image');
    await tx.productImage.delete({ where: { id: img.id } });
    await audit({ action: 'product.image.delete', entity: 'ProductImage', entityId: img.id, before: { productId: img.productId, key: img.key } });
    // Files are removed best-effort once the row is gone.
    void deleteImageFamily(img.key);
    return { id: img.id, productId: img.productId };
  },
});

// ───────────────────────── queries ─────────────────────────

export const PRODUCT_SORTS = ['updatedAt', 'createdAt', 'sku', 'status'] as const;

export type AdminProductRow = {
  id: string;
  slug: string;
  sku: string;
  name: Prisma.JsonValue;
  status: ProductStatus;
  brand: string | null;
  category: Prisma.JsonValue;
  variants: number;
  priceMinBaisa: number | null;
  priceMaxBaisa: number | null;
  stock: number;
  image: string | null;
  /** At least one active variant without a price (or no variant at all). */
  needsPrice: boolean;
  /** No uploaded photo yet (the storefront shows a device illustration instead). */
  needsPhoto: boolean;
  updatedAt: Date;
};

/** Products (not archived) that still need a real price: no variant, or an active variant without a price. */
export const NEEDS_PRICE_WHERE: Prisma.ProductWhereInput = {
  status: { not: 'ARCHIVED' },
  OR: [{ variants: { none: {} } }, { variants: { some: { isActive: true, priceBaisa: null } } }],
};

/** Products (not archived) without any uploaded photo. */
export const NO_PHOTO_WHERE: Prisma.ProductWhereInput = { status: { not: 'ARCHIVED' }, images: { none: {} } };

/** Counters for the "complete the catalogue" workflow (products list + overview alerts). */
export async function catalogueGaps(): Promise<{ needsPrice: number; noPhoto: number; variantsWithoutPrice: number }> {
  const [needsPrice, noPhoto, variantsWithoutPrice] = await Promise.all([
    prisma.product.count({ where: NEEDS_PRICE_WHERE }),
    prisma.product.count({ where: NO_PHOTO_WHERE }),
    prisma.productVariant.count({ where: { isActive: true, priceBaisa: null, product: { status: { not: 'ARCHIVED' } } } }),
  ]);
  return { needsPrice, noPhoto, variantsWithoutPrice };
}

export async function listAdminProducts(sp: SearchParams) {
  const t = parseTableQuery(sp, { sortable: PRODUCT_SORTS, defaultSort: 'updatedAt' });
  const status = enumParam(sp, 'status', STATUSES);
  const price = enumParam(sp, 'price', ['missing'] as const);
  const photo = enumParam(sp, 'photo', ['missing'] as const);
  const q = t.q;
  const where: Prisma.ProductWhereInput = {
    AND: [...(price ? [NEEDS_PRICE_WHERE] : []), ...(photo ? [NO_PHOTO_WHERE] : [])],
    ...(status ? { status } : {}),
    ...(q
      ? {
          OR: [
            { sku: { contains: q, mode: 'insensitive' } },
            { slug: { contains: q, mode: 'insensitive' } },
            { model: { contains: q, mode: 'insensitive' } },
            { name: { path: ['en'], string_contains: q, mode: 'insensitive' } },
            { name: { path: ['ar'], string_contains: q, mode: 'insensitive' } },
            { name: { path: ['fr'], string_contains: q, mode: 'insensitive' } },
            { variants: { some: { sku: { contains: q, mode: 'insensitive' } } } },
          ],
        }
      : {}),
  };
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({
      where,
      orderBy: { [t.sort]: t.dir },
      skip: t.skip,
      take: t.take,
      select: {
        id: true,
        slug: true,
        sku: true,
        name: true,
        status: true,
        updatedAt: true,
        brand: { select: { name: true } },
        category: { select: { name: true } },
        images: { orderBy: { sort: 'asc' }, take: 1, select: { key: true } },
        variants: { select: { priceBaisa: true, stock: true, isActive: true } },
      },
    }),
  ]);
  const items: AdminProductRow[] = rows.map((r) => {
    const prices = r.variants.map((v) => v.priceBaisa).filter((p): p is number => p !== null);
    return {
      id: r.id,
      slug: r.slug,
      sku: r.sku,
      name: r.name,
      status: r.status,
      brand: r.brand?.name ?? null,
      category: r.category.name,
      variants: r.variants.length,
      priceMinBaisa: prices.length ? Math.min(...prices) : null,
      priceMaxBaisa: prices.length ? Math.max(...prices) : null,
      stock: r.variants.reduce((s, v) => s + v.stock, 0),
      image: mediaUrl(r.images[0]?.key),
      needsPrice: r.variants.length === 0 || r.variants.some((v) => v.isActive && v.priceBaisa === null),
      needsPhoto: r.images.length === 0,
      updatedAt: r.updatedAt,
    };
  });
  return { items, total, query: t, status, price, photo };
}

export async function getAdminProduct(id: string) {
  const p = await prisma.product.findUnique({
    where: { id },
    include: {
      variants: { orderBy: [{ sort: 'asc' }, { createdAt: 'asc' }] },
      images: { orderBy: { sort: 'asc' } },
      brand: { select: { id: true, name: true } },
      category: { select: { id: true, name: true } },
    },
  });
  if (!p) return null;
  return { ...p, images: p.images.map((i) => ({ ...i, url: mediaUrl(i.key) })) };
}

export async function productFormOptions() {
  const [categories, brands] = await Promise.all([
    prisma.category.findMany({ orderBy: [{ parentId: 'asc' }, { sort: 'asc' }], select: { id: true, name: true, parentId: true, slug: true } }),
    prisma.brand.findMany({ where: { isActive: true }, orderBy: { sort: 'asc' }, select: { id: true, name: true } }),
  ]);
  return { categories, brands };
}
