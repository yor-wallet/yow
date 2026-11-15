'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/Input';
import type { ActionState } from '@/lib/admin/action';
import { AdminForm, FCheckbox, FInput, FLocalized, FMoney, FSelect } from './AdminForm';
import { ProductPicker, type PickedProduct } from './ProductPicker';

export type PromotionFormValues = {
  id?: string;
  name: Record<'ar' | 'en' | 'fr', string>;
  description: Record<'ar' | 'en' | 'fr', string>;
  type: 'PERCENT' | 'FIXED';
  percent: string;
  amount: string;
  code: string;
  minSubtotal: string;
  maxDiscount: string;
  categoryIds: string[];
  brandIds: string[];
  products: PickedProduct[];
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
  isActive: boolean;
};

export type PromotionTargets = { categories: { id: string; label: string; child: boolean }[]; brands: { id: string; label: string }[] };

function Targets({ name, legend, options, initial }: { name: string; legend: string; options: { id: string; label: string; child?: boolean }[]; initial: string[] }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="min-w-0 rounded-2xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{legend}</legend>
      <div className="grid max-h-64 grid-cols-1 gap-x-4 overflow-y-auto sm:grid-cols-2">
        {options.map((o) => (
          <div key={o.id} className={o.child ? 'ps-5' : undefined}>
            <Checkbox name={name} value={o.id} label={o.label} defaultChecked={initial.includes(o.id)} />
          </div>
        ))}
      </div>
    </fieldset>
  );
}

export function PromotionForm({
  action,
  values,
  targets,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  values: PromotionFormValues;
  targets: PromotionTargets;
}) {
  const t = useTranslations('admin.promotions');
  const [type, setType] = useState(values.type);
  return (
    <AdminForm action={action} hidden={{ id: values.id }} submitLabel={values.id ? t('save') : t('create')} testId="promotion-form">
      <FLocalized name="name" label={t('fields.name')} defaultValue={values.name} required maxLength={120} />
      <FLocalized name="description" label={t('fields.description')} defaultValue={values.description} multiline maxLength={400} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FSelect
          name="type"
          label={t('fields.type')}
          defaultValue={values.type}
          options={[
            { value: 'PERCENT', label: t('types.PERCENT') },
            { value: 'FIXED', label: t('types.FIXED') },
          ]}
          onChange={(e) => setType(e.currentTarget.value === 'FIXED' ? 'FIXED' : 'PERCENT')}
        />
        {type === 'PERCENT' ? (
          <FInput name="percent" label={t('fields.percent')} defaultValue={values.percent} inputMode="decimal" dir="ltr" placeholder="5" hint={t('hints.percent')} required />
        ) : (
          <FMoney name="amount" label={t('fields.amount')} defaultValue={values.amount} hint={t('hints.amount')} required />
        )}
        <FInput name="code" label={t('fields.code')} defaultValue={values.code} dir="ltr" maxLength={32} autoCapitalize="characters" autoComplete="off" hint={t('hints.code')} />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FMoney name="minSubtotalBaisa" label={t('fields.minSubtotal')} defaultValue={values.minSubtotal} hint={t('hints.minSubtotal')} />
        {type === 'PERCENT' ? <FMoney name="maxDiscountBaisa" label={t('fields.maxDiscount')} defaultValue={values.maxDiscount} hint={t('hints.maxDiscount')} /> : null}
      </div>

      <p className="text-sm text-muted">{t('hints.scope')}</p>
      <Targets name="categoryIds" legend={t('fields.categories')} options={targets.categories} initial={values.categoryIds} />
      <Targets name="brandIds" legend={t('fields.brands')} options={targets.brands} initial={values.brandIds} />
      <ProductPicker name="productIds" label={t('fields.products')} initial={values.products} max={50} />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FInput name="startsAt" type="datetime-local" label={t('fields.startsAt')} defaultValue={values.startsAt} dir="ltr" hint={t('hints.dates')} />
        <FInput name="endsAt" type="datetime-local" label={t('fields.endsAt')} defaultValue={values.endsAt} dir="ltr" />
        <FInput name="usageLimit" label={t('fields.usageLimit')} defaultValue={values.usageLimit} inputMode="numeric" dir="ltr" hint={t('hints.usageLimit')} />
        <FInput name="perUserLimit" label={t('fields.perUserLimit')} defaultValue={values.perUserLimit} inputMode="numeric" dir="ltr" hint={t('hints.perUserLimit')} />
      </div>

      <FCheckbox name="isActive" label={t('fields.isActive')} defaultChecked={values.isActive} hint={t('hints.isActive')} />
    </AdminForm>
  );
}
