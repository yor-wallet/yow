import type { DeviceArtSpec } from '@/lib/devices/art';
import type { Availability } from './stock';

/** Serializable product summary for cards, rails, grids, search results. */
export type ProductCardData = {
  id: string;
  slug: string;
  /** Already localised. */
  name: string;
  brand: string | null;
  categoryIcon: string | null;
  /** Illustration used when `image` is null (smartphones only). */
  art: DeviceArtSpec | null;
  image: { src: string; width: number; height: number; alt: string } | null;
  /** Lowest active variant price (null ⇒ price unavailable). */
  priceBaisa: number | null;
  compareAtBaisa: number | null;
  /** Several variants with different prices ⇒ show "from". */
  priceFrom: boolean;
  availability: Availability;
  /** Set when the product can be added in one click (single purchasable variant). */
  quickAddVariantId: string | null;
  variantCount: number;
  isNew: boolean;
  /** Best live automatic promotion targeting this product (badge only; applied at checkout). */
  promo: { type: 'PERCENT' | 'FIXED'; value: number } | null;
};

export type ListResult = {
  items: ProductCardData[];
  nextCursor: string | null;
  total: number;
};

export type FacetBrand = { slug: string; name: string; count: number };
export type FacetSeries = { value: string; count: number };
export type FacetYear = { value: number; count: number };
export type FacetColor = { value: string; hex: string | null; count: number };
export type FacetCapacity = { value: string; count: number };

export type Facets = {
  brands: FacetBrand[];
  /** Product families present in the scope, newest first. */
  series: FacetSeries[];
  years: FacetYear[];
  capacities: FacetCapacity[];
  colors: FacetColor[];
  /** Whole OMR bounds of priced variants (null when nothing is priced). */
  priceMinOmr: number | null;
  priceMaxOmr: number | null;
};
