'use client';

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/Button';
import { Checkbox, Input, Select, Textarea } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import type { ActionState } from '@/lib/admin/action';
import { LANGS, type Lang, type ProductFormValues, type SelectOption, type SpecValues, emptyLocalized } from './product-types';
import { Section } from './ui';
import { useAdminAction } from './useAdminAction';

type Props = {
  mode: 'create' | 'edit';
  values: ProductFormValues;
  categories: SelectOption[];
  brands: SelectOption[];
  action: (prev: ActionState, formData: FormData) => Promise<ActionState>;
};

let uidCounter = 0;
const nextUid = () => ++uidCounter;
type SpecRow = SpecValues & { uid: number };

const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');

/**
 * Product create / edit form. Names and descriptions are written per language (at least one name is needed,
 * the storefront falls back to another language for the rest); nothing is pre-filled for prices or stock —
 * those live on the variants below the form.
 */
export function ProductForm({ mode, values, categories, brands, action }: Props) {
  const t = useTranslations('admin.form');
  const { formAction, onSubmit, pending, fieldError } = useAdminAction(action);
  const [specs, setSpecs] = useState<SpecRow[]>(() => values.specs.map((s) => ({ ...s, uid: nextUid() })));
  const language = (l: Lang) => t(`languages.${l}`);

  const addSpec = () => setSpecs((rows) => [...rows, { key: '', label: emptyLocalized(), value: emptyLocalized(), uid: nextUid() }]);
  const removeSpec = (uid: number) => setSpecs((rows) => rows.filter((r) => r.uid !== uid));
  const nameError = fieldError('name');

  return (
    <form action={formAction} onSubmit={onSubmit} className="flex flex-col gap-6" data-testid="product-form" aria-busy={pending || undefined}>
      {mode === 'edit' && values.id ? <input type="hidden" name="id" value={values.id} /> : null}

      <Section id="general" title={t('sections.general')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input
            name="sku"
            label={t('fields.sku')}
            hint={t('fields.skuHint')}
            defaultValue={values.sku}
            required
            autoCapitalize="characters"
            spellCheck={false}
            dir="ltr"
            error={fieldError('sku')}
            data-testid="field-sku"
          />
          <Input
            name="slug"
            label={t('fields.slug')}
            hint={t('fields.slugHint')}
            defaultValue={values.slug}
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            error={fieldError('slug')}
            data-testid="field-slug"
          />
          <Input name="model" label={t('fields.model')} defaultValue={values.model} dir="ltr" error={fieldError('model')} />
          <Select name="brandId" label={t('fields.brand')} defaultValue={values.brandId} error={fieldError('brandId')}>
            <option value="">{t('fields.noBrand')}</option>
            {brands.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </Select>
          <Select name="categoryId" label={t('fields.category')} defaultValue={values.categoryId} required error={fieldError('categoryId')} data-testid="field-category">
            <option value="" disabled>
              {t('fields.chooseCategory')}
            </option>
            {categories.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
          <Input
            name="warrantyMonths"
            type="number"
            inputMode="numeric"
            min={0}
            step={1}
            label={t('fields.warranty')}
            defaultValue={values.warrantyMonths}
            error={fieldError('warrantyMonths')}
          />
        </div>
      </Section>

      <Section id="content" title={t('sections.content')} description={t('nameRule')}>
        {nameError ? (
          <p role="alert" className="mb-3 text-sm font-medium text-error" data-testid="name-error">
            {nameError}
          </p>
        ) : null}
        <div className="grid gap-6 lg:grid-cols-3">
          {LANGS.map((lang) => (
            <fieldset key={lang} dir={dirOf(lang)} className="flex min-w-0 flex-col gap-4 rounded-xl border border-border p-4">
              <legend className="px-2 text-sm font-bold">{language(lang)}</legend>
              <Input name={`name.${lang}`} label={t('fields.nameLocale', { language: language(lang) })} defaultValue={values.name[lang]} data-testid={`field-name-${lang}`} />
              <Textarea name={`description.${lang}`} rows={5} label={t('fields.description', { language: language(lang) })} defaultValue={values.description[lang]} />
              <Textarea name={`highlights.${lang}`} rows={4} label={t('fields.highlights', { language: language(lang) })} defaultValue={values.highlights[lang]} />
            </fieldset>
          ))}
        </div>
      </Section>

      <Section id="specs" title={t('sections.specs')}>
        <div className="flex flex-col gap-4">
          {specs.map((row, i) => (
            <div key={row.uid} className="rounded-xl border border-border p-4" data-testid="spec-row">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,12rem)_1fr]">
                <Input name={`specs.${i}.key`} label={t('fields.specKey')} defaultValue={row.key} dir="ltr" autoCapitalize="none" spellCheck={false} error={fieldError(`specs.${i}.key`)} />
                <div className="grid gap-3 md:grid-cols-3">
                  {LANGS.map((lang) => (
                    <div key={lang} dir={dirOf(lang)} className="flex min-w-0 flex-col gap-3">
                      <Input name={`specs.${i}.label.${lang}`} label={t('fields.specLabel', { language: language(lang) })} defaultValue={row.label[lang]} />
                      <Input name={`specs.${i}.value.${lang}`} label={t('fields.specValue', { language: language(lang) })} defaultValue={row.value[lang]} />
                    </div>
                  ))}
                </div>
              </div>
              {fieldError(`specs.${i}`) ? (
                <p role="alert" className="mt-2 text-sm font-medium text-error">
                  {fieldError(`specs.${i}`)}
                </p>
              ) : null}
              <div className="mt-3 flex justify-end">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeSpec(row.uid)} leadingIcon={<Trash2 size={16} aria-hidden="true" />}>
                  {t('fields.removeSpec')}
                </Button>
              </div>
            </div>
          ))}
          <div>
            <Button type="button" variant="outline" size="sm" onClick={addSpec} leadingIcon={<Plus size={16} aria-hidden="true" />} data-testid="add-spec">
              {t('fields.addSpec')}
            </Button>
          </div>
        </div>
      </Section>

      <Section id="logistics" title={t('sections.logistics')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Input name="weightGrams" type="number" inputMode="numeric" min={0} step={1} label={t('fields.weight')} defaultValue={values.weightGrams} error={fieldError('weightGrams')} />
          <Input name="volumeCm3" type="number" inputMode="numeric" min={0} step={1} label={t('fields.volume')} defaultValue={values.volumeCm3} error={fieldError('volumeCm3')} />
        </div>
        <Checkbox name="expressEligible" label={t('fields.expressEligible')} defaultChecked={values.expressEligible} className="mt-2" />
      </Section>

      <Section id="flags" title={t('sections.flags')}>
        <div className="grid gap-x-6 sm:grid-cols-2">
          <Checkbox name="isSellable" label={t('fields.isSellable')} defaultChecked={values.isSellable} />
          <Checkbox name="isFeatured" label={t('fields.isFeatured')} defaultChecked={values.isFeatured} />
          <Checkbox name="isDealOfDay" label={t('fields.isDealOfDay')} defaultChecked={values.isDealOfDay} />
          <Checkbox name="isRecommended" label={t('fields.isRecommended')} defaultChecked={values.isRecommended} />
          <Checkbox name="isNewArrival" label={t('fields.isNewArrival')} defaultChecked={values.isNewArrival} />
        </div>
      </Section>

      <div
        className="sticky bottom-0 z-20 -mx-4 flex items-center justify-end gap-3 border-t border-border px-4 py-3 sm:-mx-6 sm:px-6"
        style={{ background: 'var(--doom-header)', backdropFilter: 'blur(16px)', paddingBottom: 'max(0.75rem, var(--safe-bottom))' }}
      >
        <SubmitButton loading={pending} loadingLabel={t('saving')} data-testid="product-save">
          {mode === 'create' ? t('create') : t('save')}
        </SubmitButton>
      </div>
    </form>
  );
}
