'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { Checkbox } from '@/components/ui/Input';
import type { ActionState } from '@/lib/admin/action';
import { AdminForm, FCheckbox, FInput, FLocalized, FSelect, useFormCtx } from './AdminForm';
import { ProductPicker, type PickedProduct } from './ProductPicker';

export type CampaignFormValues = {
  id?: string;
  slug: string;
  internalName: string;
  title: Record<'ar' | 'en' | 'fr', string>;
  subtitle: Record<'ar' | 'en' | 'fr', string>;
  cta: Record<'ar' | 'en' | 'fr', string>;
  mediaType: string;
  sceneKind: string;
  theme: string;
  placements: string[];
  products: PickedProduct[];
  linkUrl: string;
  priority: string;
  startsAt: string;
  endsAt: string;
  isActive: boolean;
  hasMedia: boolean;
};

const ACCEPT: Record<string, string> = {
  IMAGE: 'image/png,image/jpeg,image/webp,image/avif',
  VIDEO: 'video/mp4,video/webm',
  LOTTIE: 'application/json,.json',
  SCENE_3D: '',
};

function FileField({ name, label, accept, hint }: { name: string; label: string; accept: string; hint: string }) {
  const { fieldError } = useFormCtx();
  const err = fieldError(name);
  return (
    <label className="flex min-w-0 flex-col gap-1.5 text-sm font-medium">
      <span>{label}</span>
      <input
        type="file"
        name={name}
        accept={accept}
        aria-invalid={err ? true : undefined}
        className="block w-full min-w-0 rounded-xl border border-dashed border-border-strong bg-surface p-3 text-sm file:me-3 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-2 file:font-semibold file:text-fg"
        data-testid={`file-${name}`}
      />
      {err ? (
        <span className="text-sm font-medium text-error" role="alert">
          {err}
        </span>
      ) : (
        <span className="text-xs font-normal text-muted">{hint}</span>
      )}
    </label>
  );
}

function Placements({ options, initial }: { options: { value: string; label: string }[]; initial: string[] }) {
  const t = useTranslations('admin.campaigns');
  const { fieldError } = useFormCtx();
  const err = fieldError('placements');
  return (
    <fieldset className="rounded-2xl border border-border p-3">
      <legend className="px-1 text-sm font-medium">{t('fields.placements')}</legend>
      <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">
        {options.map((o) => (
          <Checkbox key={o.value} name="placements" value={o.value} label={o.label} defaultChecked={initial.includes(o.value)} />
        ))}
      </div>
      {err ? (
        <p className="text-sm font-medium text-error" role="alert">
          {err}
        </p>
      ) : null}
    </fieldset>
  );
}

export function CampaignForm({
  action,
  values,
  options,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  values: CampaignFormValues;
  options: { mediaTypes: { value: string; label: string }[]; scenes: { value: string; label: string }[]; themes: { value: string; label: string }[]; placements: { value: string; label: string }[] };
}) {
  const t = useTranslations('admin.campaigns');
  const [mediaType, setMediaType] = useState(values.mediaType);
  return (
    <AdminForm action={action} hidden={{ id: values.id }} submitLabel={values.id ? t('save') : t('create')} testId="campaign-form" encType="multipart/form-data">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FInput name="internalName" label={t('fields.internalName')} defaultValue={values.internalName} required maxLength={120} hint={t('hints.internalName')} />
        <FInput name="slug" label={t('fields.slug')} defaultValue={values.slug} required maxLength={120} dir="ltr" hint={t('hints.slug')} />
      </div>
      <FLocalized name="title" label={t('fields.title')} defaultValue={values.title} required maxLength={160} />
      <FLocalized name="subtitle" label={t('fields.subtitle')} defaultValue={values.subtitle} multiline maxLength={300} />
      <FLocalized name="cta" label={t('fields.cta')} defaultValue={values.cta} maxLength={40} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <FSelect name="mediaType" label={t('fields.mediaType')} defaultValue={values.mediaType} options={options.mediaTypes} onChange={(e) => setMediaType(e.currentTarget.value)} />
        <FSelect name="sceneKind" label={t('fields.sceneKind')} defaultValue={values.sceneKind} options={options.scenes} hint={t('hints.sceneKind')} />
        <FSelect name="theme" label={t('fields.theme')} defaultValue={values.theme} options={options.themes} />
      </div>
      {mediaType !== 'SCENE_3D' ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <FileField name="media" label={t('fields.media')} accept={ACCEPT[mediaType] ?? ''} hint={t(`hints.media${mediaType as 'IMAGE'}`)} />
          {mediaType !== 'LOTTIE' ? <FileField name="mediaMobile" label={t('fields.mediaMobile')} accept={ACCEPT[mediaType] ?? ''} hint={t('hints.mediaMobile')} /> : null}
        </div>
      ) : null}
      {mediaType === 'VIDEO' || mediaType === 'SCENE_3D' ? <FileField name="poster" label={t('fields.poster')} accept={ACCEPT.IMAGE!} hint={t('hints.poster')} /> : null}
      {values.id && values.hasMedia ? <FCheckbox name="removeMedia" label={t('fields.removeMedia')} /> : null}
      <Placements options={options.placements} initial={values.placements} />
      <ProductPicker name="productIds" label={t('fields.products')} initial={values.products} />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <FInput name="linkUrl" label={t('fields.linkUrl')} defaultValue={values.linkUrl} dir="ltr" maxLength={500} hint={t('hints.linkUrl')} />
        <FInput name="priority" label={t('fields.priority')} defaultValue={values.priority} inputMode="numeric" dir="ltr" hint={t('hints.priority')} />
        <FInput name="startsAt" type="datetime-local" label={t('fields.startsAt')} defaultValue={values.startsAt} dir="ltr" hint={t('hints.dates')} />
        <FInput name="endsAt" type="datetime-local" label={t('fields.endsAt')} defaultValue={values.endsAt} dir="ltr" />
      </div>
      <FCheckbox name="isActive" label={t('fields.isActive')} defaultChecked={values.isActive} />
    </AdminForm>
  );
}
