import type { Promotion } from '@prisma/client';
import { localize } from '@/lib/localized';
import { percentFromBps } from '@/lib/catalog/promotions';
import type { PromotionFormValues } from '@/components/admin/PromotionForm';
import type { PickedProduct } from '@/components/admin/ProductPicker';

const loc = (v: unknown): Record<'ar' | 'en' | 'fr', string> => {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  return { ar: typeof o.ar === 'string' ? o.ar : '', en: typeof o.en === 'string' ? o.en : '', fr: typeof o.fr === 'string' ? o.fr : '' };
};

/** `datetime-local` value in Muscat wall time (UTC+4). */
const muscatInput = (d: Date | null) => (d ? new Date(d.getTime() + 4 * 3_600_000).toISOString().slice(0, 16) : '');

/** Integer baisa → the plain OMR text the form expects ("12.500"). */
const omr = (baisa: number | null) => (baisa === null ? '' : `${Math.floor(baisa / 1000)}.${String(baisa % 1000).padStart(3, '0')}`);

export function promotionValues(p: Promotion | null, products: { id: string; sku: string; name: unknown }[], locale: string): PromotionFormValues {
  if (!p) {
    return {
      name: loc(null), description: loc(null), type: 'PERCENT', percent: '', amount: '', code: '', minSubtotal: '', maxDiscount: '',
      categoryIds: [], brandIds: [], products: [], startsAt: '', endsAt: '', usageLimit: '', perUserLimit: '', isActive: false,
    };
  }
  const picked: PickedProduct[] = products.map((x) => ({ id: x.id, sku: x.sku, name: localize(x.name, locale) }));
  return {
    id: p.id,
    name: loc(p.name),
    description: loc(p.description),
    type: p.type,
    percent: p.type === 'PERCENT' ? percentFromBps(p.value) : '',
    amount: p.type === 'FIXED' ? omr(p.value) : '',
    code: p.code ?? '',
    minSubtotal: omr(p.minSubtotalBaisa),
    maxDiscount: omr(p.maxDiscountBaisa),
    categoryIds: p.categoryIds,
    brandIds: p.brandIds,
    products: picked,
    startsAt: muscatInput(p.startsAt),
    endsAt: muscatInput(p.endsAt),
    usageLimit: p.usageLimit === null ? '' : String(p.usageLimit),
    perUserLimit: p.perUserLimit === null ? '' : String(p.perUserLimit),
    isActive: p.isActive,
  };
}
