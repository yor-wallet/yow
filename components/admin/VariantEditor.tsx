'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { deleteVariantAction, saveVariantAction } from '@/app/[locale]/admin/products/actions';
import { ConfirmAction } from './ConfirmAction';
import type { VariantValues } from './product-types';
import { Section } from './ui';
import { useAdminAction } from './useAdminAction';

const blankVariant = (sort: number, first: boolean): VariantValues => ({
  sku: '',
  color: '',
  colorHex: '',
  capacity: '',
  price: '',
  compareAt: '',
  cost: '',
  stock: '0',
  lowStockThreshold: '2',
  isActive: true,
  isDefault: first,
  reserved: 0,
  sort,
});

/**
 * Variants are where prices and stock live. Each variant is saved on its own; a price field left empty means
 * "not decided yet" (the storefront then says "price unavailable" and the variant cannot be bought).
 * People without the price / stock permission see those fields read-only.
 */
export function VariantEditor({ productId, variants, canPrice, canStock }: { productId: string; variants: VariantValues[]; canPrice: boolean; canStock: boolean }) {
  const t = useTranslations('admin.variants');
  const [adding, setAdding] = useState(false);
  return (
    <Section
      id="variants"
      title={t('title')}
      description={t('text')}
      actions={
        <Button type="button" variant="outline" size="sm" onClick={() => setAdding(true)} disabled={adding} leadingIcon={<Plus size={16} aria-hidden="true" />} data-testid="add-variant">
          {t('add')}
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="variants">
        {variants.length === 0 && !adding ? (
          <p className="text-sm text-muted" data-testid="variants-empty">
            {t('empty')}
          </p>
        ) : null}
        {variants.map((v) => (
          // The whole value is part of the key: after a save the server sends the normalised values (e.g. "329.000")
          // and the uncontrolled inputs of that card are rebuilt from them.
          <VariantCard key={JSON.stringify(v)} productId={productId} v={v} canPrice={canPrice} canStock={canStock} />
        ))}
        {adding ? (
          <VariantCard key="new" productId={productId} v={blankVariant(variants.length, variants.length === 0)} canPrice={canPrice} canStock={canStock} isNew onDone={() => setAdding(false)} />
        ) : null}
      </div>
    </Section>
  );
}

function VariantCard({ productId, v, canPrice, canStock, isNew, onDone }: { productId: string; v: VariantValues; canPrice: boolean; canStock: boolean; isNew?: boolean; onDone?: () => void }) {
  const t = useTranslations('admin.variants');
  const tc = useTranslations('common.actions');
  const { formAction, onSubmit, pending, fieldError } = useAdminAction(saveVariantAction, { onSuccess: () => onDone?.() });
  return (
    <div className="rounded-xl border border-border bg-bg-2 p-4" data-testid={isNew ? 'variant-new' : 'variant-card'} data-sku={v.sku}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-bold [unicode-bidi:isolate]" dir="ltr">
          {isNew ? t('new') : v.sku}
        </h3>
        {v.isDefault && !isNew ? <Badge variant="info">{t('default')}</Badge> : null}
        {!v.isActive && !isNew ? <Badge variant="warning">{t('inactive')}</Badge> : null}
        {v.reserved > 0 ? <span className="text-xs text-muted">{t('reserved', { count: v.reserved })}</span> : null}
        <div className="ms-auto">
          {!isNew && v.id ? (
            <ConfirmAction action={deleteVariantAction} fields={{ id: v.id }} label={t('delete')} title={t('deleteConfirm')} confirmLabel={t('delete')} testId="delete-variant" />
          ) : (
            <Button type="button" variant="ghost" size="sm" onClick={onDone}>
              {tc('cancel')}
            </Button>
          )}
        </div>
      </div>
      <form action={formAction} onSubmit={onSubmit} aria-busy={pending || undefined}>
        <input type="hidden" name="productId" value={productId} />
        {v.id ? <input type="hidden" name="id" value={v.id} /> : null}
        <input type="hidden" name="sort" value={v.sort} />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Input name="sku" label={t('fields.sku')} defaultValue={v.sku} required dir="ltr" autoCapitalize="characters" spellCheck={false} error={fieldError('sku')} data-testid="variant-sku" />
          <Input name="capacity" label={t('fields.capacity')} defaultValue={v.capacity} error={fieldError('capacity')} />
          <Input name="color" label={t('fields.color')} defaultValue={v.color} error={fieldError('color')} />
          <Input name="colorHex" label={t('fields.colorHex')} defaultValue={v.colorHex} placeholder="#1A2B3C" dir="ltr" spellCheck={false} error={fieldError('colorHex')} />
          <Input
            name="price"
            label={t('fields.price')}
            hint={t('hints.price')}
            defaultValue={v.price}
            inputMode="decimal"
            dir="ltr"
            readOnly={!canPrice}
            error={fieldError('price')}
            data-testid="variant-price"
          />
          <Input
            name="compareAt"
            label={t('fields.compareAt')}
            hint={t('hints.compareAt')}
            defaultValue={v.compareAt}
            inputMode="decimal"
            dir="ltr"
            readOnly={!canPrice}
            error={fieldError('compareAt') ?? fieldError('compare')}
          />
          <Input name="cost" label={t('fields.cost')} hint={t('hints.cost')} defaultValue={v.cost} inputMode="decimal" dir="ltr" readOnly={!canPrice} error={fieldError('cost')} />
          <Input
            name="stock"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            label={t('fields.stock')}
            hint={t('hints.stock')}
            defaultValue={v.stock}
            required
            readOnly={!canStock}
            error={fieldError('stock')}
            data-testid="variant-stock"
          />
          <Input name="lowStockThreshold" type="number" inputMode="numeric" min={0} step={1} label={t('fields.lowStock')} defaultValue={v.lowStockThreshold} error={fieldError('lowStockThreshold')} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-6">
          <Checkbox name="isActive" label={t('fields.isActive')} defaultChecked={v.isActive} />
          <Checkbox name="isDefault" label={t('fields.isDefault')} defaultChecked={v.isDefault} />
        </div>
        <div className="mt-3 flex justify-end">
          <SubmitButton size="sm" loading={pending} data-testid="variant-save">
            {t('save')}
          </SubmitButton>
        </div>
      </form>
    </div>
  );
}
