/** Plain, serialisable shapes passed from the admin server pages to their client forms. */

export type Lang = 'ar' | 'en' | 'fr';
export const LANGS: readonly Lang[] = ['ar', 'en', 'fr'];
export type LocalizedValues = Record<Lang, string>;
export const emptyLocalized = (): LocalizedValues => ({ ar: '', en: '', fr: '' });

export type SpecValues = { key: string; label: LocalizedValues; value: LocalizedValues };

export type ProductFormValues = {
  id?: string;
  sku: string;
  slug: string;
  model: string;
  brandId: string;
  categoryId: string;
  warrantyMonths: string;
  weightGrams: string;
  volumeCm3: string;
  name: LocalizedValues;
  description: LocalizedValues;
  /** One highlight per line. */
  highlights: LocalizedValues;
  specs: SpecValues[];
  isSellable: boolean;
  isFeatured: boolean;
  isDealOfDay: boolean;
  isRecommended: boolean;
  isNewArrival: boolean;
  expressEligible: boolean;
};

export const EMPTY_PRODUCT: ProductFormValues = {
  sku: '',
  slug: '',
  model: '',
  brandId: '',
  categoryId: '',
  warrantyMonths: '',
  weightGrams: '',
  volumeCm3: '',
  name: emptyLocalized(),
  description: emptyLocalized(),
  highlights: emptyLocalized(),
  specs: [],
  isSellable: true,
  isFeatured: false,
  isDealOfDay: false,
  isRecommended: false,
  isNewArrival: false,
  expressEligible: true,
};

export type SelectOption = { value: string; label: string };

export type VariantValues = {
  id?: string;
  sku: string;
  color: string;
  colorHex: string;
  capacity: string;
  /** OMR text with 3 decimals ('' = no price yet). */
  price: string;
  compareAt: string;
  cost: string;
  stock: string;
  lowStockThreshold: string;
  isActive: boolean;
  isDefault: boolean;
  reserved: number;
  sort: number;
};

export type ImageItem = { id: string; url: string; width: number; height: number; alt: string; variantLabel: string | null };

/** Baisa → "329.500" (the text a person types and `parseOmrToBaisa` reads back exactly). */
export function baisaToInput(baisa: number | null | undefined): string {
  return baisa === null || baisa === undefined ? '' : (baisa / 1000).toFixed(3);
}
