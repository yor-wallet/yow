import type { Prisma } from '@prisma/client';
import { localize } from '@/lib/localized';
import { baisaToInput, emptyLocalized, type ImageItem, type LocalizedValues, type ProductFormValues, type SelectOption, type VariantValues } from './product-types';

/** Server-side mapping from database rows to the plain props of the admin client forms. */

type CategoryRow = { id: string; name: Prisma.JsonValue; parentId: string | null };

/** Parents first, each followed by its children ("Smartphones › Apple"), labels in the admin's language. */
export function categoryOptions(rows: CategoryRow[], locale: string): SelectOption[] {
  const nameOf = (r: CategoryRow) => localize(r.name, locale, r.id);
  const roots = rows.filter((r) => !r.parentId);
  const out: SelectOption[] = [];
  for (const root of roots) {
    out.push({ value: root.id, label: nameOf(root) });
    for (const child of rows.filter((r) => r.parentId === root.id)) out.push({ value: child.id, label: `${nameOf(root)} › ${nameOf(child)}` });
  }
  // Orphans (parent missing) are still selectable.
  for (const r of rows) if (r.parentId && !rows.some((p) => p.id === r.parentId)) out.push({ value: r.id, label: nameOf(r) });
  return out;
}

export function brandOptions(rows: { id: string; name: string | Prisma.JsonValue }[], locale: string): SelectOption[] {
  return rows.map((b) => ({ value: b.id, label: localize(b.name, locale, b.id) }));
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function localizedValues(v: unknown): LocalizedValues {
  const out = emptyLocalized();
  if (isRecord(v)) for (const l of ['ar', 'en', 'fr'] as const) if (typeof v[l] === 'string') out[l] = v[l] as string;
  return out;
}

function highlightValues(v: unknown): LocalizedValues {
  const out = emptyLocalized();
  if (isRecord(v)) for (const l of ['ar', 'en', 'fr'] as const) if (Array.isArray(v[l])) out[l] = (v[l] as unknown[]).filter((x): x is string => typeof x === 'string').join('\n');
  return out;
}

type ProductRow = {
  id: string;
  sku: string;
  slug: string;
  model: string | null;
  brandId: string | null;
  categoryId: string;
  warrantyMonths: number | null;
  weightGrams: number | null;
  volumeCm3: number | null;
  name: Prisma.JsonValue;
  description: Prisma.JsonValue | null;
  highlights: Prisma.JsonValue | null;
  specs: Prisma.JsonValue | null;
  isSellable: boolean;
  isFeatured: boolean;
  isDealOfDay: boolean;
  isRecommended: boolean;
  isNewArrival: boolean;
  expressEligible: boolean;
};

export function productToFormValues(p: ProductRow): ProductFormValues {
  const num = (n: number | null) => (n === null ? '' : String(n));
  return {
    id: p.id,
    sku: p.sku,
    slug: p.slug,
    model: p.model ?? '',
    brandId: p.brandId ?? '',
    categoryId: p.categoryId,
    warrantyMonths: num(p.warrantyMonths),
    weightGrams: num(p.weightGrams),
    volumeCm3: num(p.volumeCm3),
    name: localizedValues(p.name),
    description: localizedValues(p.description),
    highlights: highlightValues(p.highlights),
    specs: Array.isArray(p.specs)
      ? (p.specs as unknown[]).filter(isRecord).map((s) => ({ key: typeof s.key === 'string' ? s.key : '', label: localizedValues(s.label), value: localizedValues(s.value) }))
      : [],
    isSellable: p.isSellable,
    isFeatured: p.isFeatured,
    isDealOfDay: p.isDealOfDay,
    isRecommended: p.isRecommended,
    isNewArrival: p.isNewArrival,
    expressEligible: p.expressEligible,
  };
}

type VariantRow = {
  id: string;
  sku: string;
  color: string | null;
  colorHex: string | null;
  capacity: string | null;
  priceBaisa: number | null;
  compareAtBaisa: number | null;
  costBaisa: number | null;
  stock: number;
  reserved: number;
  lowStockThreshold: number;
  isActive: boolean;
  isDefault: boolean;
  sort: number;
};

export function variantToFormValues(v: VariantRow): VariantValues {
  return {
    id: v.id,
    sku: v.sku,
    color: v.color ?? '',
    colorHex: v.colorHex ?? '',
    capacity: v.capacity ?? '',
    price: baisaToInput(v.priceBaisa),
    compareAt: baisaToInput(v.compareAtBaisa),
    cost: baisaToInput(v.costBaisa),
    stock: String(v.stock),
    lowStockThreshold: String(v.lowStockThreshold),
    isActive: v.isActive,
    isDefault: v.isDefault,
    reserved: v.reserved,
    sort: v.sort,
  };
}

export function imageToItem(
  img: { id: string; url: string | null; width: number | null; height: number | null; alt: Prisma.JsonValue | null; variantId: string | null },
  variants: { id: string; sku: string }[],
  locale: string,
  fallbackAlt: string,
): ImageItem | null {
  if (!img.url) return null;
  return {
    id: img.id,
    url: img.url,
    width: img.width ?? 800,
    height: img.height ?? 800,
    alt: localize(img.alt, locale, fallbackAlt),
    variantLabel: variants.find((v) => v.id === img.variantId)?.sku ?? null,
  };
}
