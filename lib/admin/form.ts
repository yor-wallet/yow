/**
 * FormData → plain objects for the admin schemas (lib/admin/products.ts …).
 *
 * Rules: an empty text box means "absent" (null / undefined) — never a made-up value; numbers that are not
 * numbers become NaN so the schema reports them instead of silently turning them into 0; checkboxes are
 * true only when they are sent (`on`).
 */

export function text(fd: FormData, name: string): string | undefined {
  const v = fd.get(name);
  return typeof v === 'string' ? v : undefined;
}

/** Trimmed text, `null` when empty. */
export function textOrNull(fd: FormData, name: string): string | null {
  const v = text(fd, name)?.trim();
  return v ? v : null;
}

export function flag(fd: FormData, name: string): boolean {
  const v = fd.get(name);
  return v === 'on' || v === 'true' || v === '1';
}

/** Integer-looking text → number; empty → null; anything else → NaN (rejected by the schema). */
export function intOrNull(fd: FormData, name: string): number | null {
  const v = text(fd, name)?.trim();
  if (!v) return null;
  return /^-?\d+$/.test(v) ? Number(v) : Number.NaN;
}

/** Like `intOrNull` for required numbers: empty → undefined so the schema says "required". */
export function intOrUndefined(fd: FormData, name: string): number | undefined {
  const v = intOrNull(fd, name);
  return v === null ? undefined : v;
}

/** `{ ar, en, fr }` from `prefix.ar` / `prefix.en` / `prefix.fr` inputs (missing → ''). */
export function localizedText(fd: FormData, prefix: string): { ar: string; en: string; fr: string } {
  return { ar: text(fd, `${prefix}.ar`) ?? '', en: text(fd, `${prefix}.en`) ?? '', fr: text(fd, `${prefix}.fr`) ?? '' };
}

/** A textarea with one entry per line → trimmed, non-empty lines. */
export function lines(fd: FormData, name: string): string[] {
  return (text(fd, name) ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

/** The distinct row indexes used by inputs named `<prefix>.<n>.…`, in ascending order. */
export function indexesOf(fd: FormData, prefix: string): number[] {
  const re = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\.(\\d+)\\.`);
  const found = new Set<number>();
  for (const key of fd.keys()) {
    const m = re.exec(key);
    if (m) found.add(Number(m[1]));
  }
  return [...found].sort((a, b) => a - b);
}

const blank = (s: string | undefined) => !s || s.trim() === '';

/** The raw object `productInputSchema` / `updateProduct` expect, from the product form. */
export function productFormToRaw(fd: FormData): Record<string, unknown> {
  const specs = indexesOf(fd, 'specs')
    .map((i) => ({
      key: (text(fd, `specs.${i}.key`) ?? '').trim(),
      label: localizedText(fd, `specs.${i}.label`),
      value: localizedText(fd, `specs.${i}.value`),
    }))
    // A row the person added but never filled in is ignored rather than reported as an error.
    .filter((s) => !(s.key === '' && Object.values(s.label).every(blank) && Object.values(s.value).every(blank)));
  return {
    id: textOrNull(fd, 'id') ?? undefined,
    slug: textOrNull(fd, 'slug') ?? undefined,
    sku: text(fd, 'sku') ?? '',
    name: localizedText(fd, 'name'),
    description: localizedText(fd, 'description'),
    highlights: { ar: lines(fd, 'highlights.ar'), en: lines(fd, 'highlights.en'), fr: lines(fd, 'highlights.fr') },
    specs,
    model: textOrNull(fd, 'model'),
    brandId: textOrNull(fd, 'brandId'),
    categoryId: text(fd, 'categoryId') ?? '',
    warrantyMonths: intOrNull(fd, 'warrantyMonths'),
    weightGrams: intOrNull(fd, 'weightGrams'),
    volumeCm3: intOrNull(fd, 'volumeCm3'),
    isSellable: flag(fd, 'isSellable'),
    isFeatured: flag(fd, 'isFeatured'),
    isDealOfDay: flag(fd, 'isDealOfDay'),
    isRecommended: flag(fd, 'isRecommended'),
    isNewArrival: flag(fd, 'isNewArrival'),
    expressEligible: flag(fd, 'expressEligible'),
  };
}

/** The raw object `variantInputSchema` expects, from one variant form. Prices stay text (parsed as OMR by the schema). */
export function variantFormToRaw(fd: FormData): Record<string, unknown> {
  return {
    id: textOrNull(fd, 'id') ?? undefined,
    productId: text(fd, 'productId') ?? '',
    sku: text(fd, 'sku') ?? '',
    color: textOrNull(fd, 'color'),
    colorHex: text(fd, 'colorHex') ?? '',
    capacity: textOrNull(fd, 'capacity'),
    price: text(fd, 'price') ?? '',
    compareAt: text(fd, 'compareAt') ?? '',
    cost: text(fd, 'cost') ?? '',
    stock: intOrUndefined(fd, 'stock'),
    lowStockThreshold: intOrUndefined(fd, 'lowStockThreshold'),
    isActive: flag(fd, 'isActive'),
    isDefault: flag(fd, 'isDefault'),
    // Display order: kept for an existing variant, appended for a new one (the form sends the right value).
    sort: intOrUndefined(fd, 'sort'),
  };
}
