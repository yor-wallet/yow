'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Input, Select } from '@/components/ui/Field';
import { SubmitButton } from '@/components/ui/SubmitButton';
import { ShopImage } from '@/components/shop/ShopImage';
import { addProductImageAction, deleteProductImageAction } from '@/app/[locale]/admin/products/actions';
import { ConfirmAction } from './ConfirmAction';
import { LANGS, type ImageItem, type SelectOption } from './product-types';
import { Section } from './ui';
import { useAdminAction } from './useAdminAction';

/**
 * Product images: the file is checked by its real type on the server, optimised (WebP + AVIF + responsive
 * sizes) and attached to the whole product or to one variant (e.g. a colour). Alt text is per language.
 */
export function ImageManager({ productId, images, variantOptions }: { productId: string; images: ImageItem[]; variantOptions: SelectOption[] }) {
  const t = useTranslations('admin.images');
  const tf = useTranslations('admin.form');
  const formRef = useRef<HTMLFormElement>(null);
  const { formAction, onSubmit, pending, fieldError } = useAdminAction(addProductImageAction, { onSuccess: () => formRef.current?.reset() });
  return (
    <Section id="images" title={t('title')} description={t('text')}>
      {images.length === 0 ? (
        <p className="mb-4 text-sm text-muted" data-testid="images-empty">
          {t('empty')}
        </p>
      ) : (
        <ul className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4" data-testid="images">
          {images.map((img) => (
            <li key={img.id} className="flex flex-col gap-2 rounded-xl border border-border bg-bg-2 p-2" data-testid="image-item">
              <div className="grid aspect-square place-items-center overflow-hidden rounded-lg bg-surface-2">
                <ShopImage src={img.url} width={img.width} height={img.height} alt={img.alt} sizes="(min-width: 1024px) 20vw, 40vw" className="size-full object-contain" />
              </div>
              {img.variantLabel ? <p className="truncate text-xs text-muted">{img.variantLabel}</p> : null}
              <ConfirmAction action={deleteProductImageAction} fields={{ id: img.id }} label={t('delete')} title={t('deleteConfirm')} confirmLabel={t('delete')} testId="delete-image" />
            </li>
          ))}
        </ul>
      )}
      <form ref={formRef} action={formAction} onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2" aria-busy={pending || undefined} data-testid="image-form">
        <input type="hidden" name="productId" value={productId} />
        <div className="flex flex-col gap-1.5 sm:col-span-2">
          <label htmlFor="image-file" className="text-sm font-medium">
            {t('file')}
          </label>
          <input
            id="image-file"
            type="file"
            name="file"
            accept="image/png,image/jpeg,image/webp,image/avif"
            required
            aria-invalid={fieldError('file') ? true : undefined}
            className="block w-full min-w-0 rounded-xl border border-border bg-surface text-sm file:me-3 file:min-h-11 file:cursor-pointer file:border-0 file:bg-surface-2 file:px-4 file:text-sm file:font-semibold file:text-fg"
            data-testid="image-file"
          />
          {fieldError('file') ? (
            <p role="alert" className="text-sm font-medium text-error">
              {fieldError('file')}
            </p>
          ) : null}
        </div>
        {LANGS.map((lang) => (
          <Input key={lang} name={`alt.${lang}`} label={t('alt', { language: tf(`languages.${lang}`) })} dir={lang === 'ar' ? 'rtl' : 'ltr'} />
        ))}
        {variantOptions.length > 0 ? (
          <Select name="variantId" label={t('forVariant')} defaultValue="">
            <option value="">{t('allVariants')}</option>
            {variantOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        ) : null}
        <div className="flex items-end sm:col-span-2">
          <SubmitButton size="sm" loading={pending} data-testid="image-upload">
            {t('add')}
          </SubmitButton>
        </div>
      </form>
    </Section>
  );
}
