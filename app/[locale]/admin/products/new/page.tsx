import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { productFormOptions } from '@/lib/admin/products';
import { ProductForm } from '@/components/admin/ProductForm';
import { brandOptions, categoryOptions } from '@/components/admin/options';
import { EMPTY_PRODUCT } from '@/components/admin/product-types';
import { AdminPageHeader } from '@/components/admin/ui';
import { createProductAction } from '../actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('form.createTitle'), robots: { index: false } };
}

export default async function NewProductPage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('catalog:write', '/admin/products/new');
  const [t, options] = await Promise.all([getTranslations('admin'), productFormOptions()]);
  return (
    <>
      <AdminPageHeader title={t('form.createTitle')} subtitle={t('form.createHint')} backHref="/admin/products" />
      <ProductForm mode="create" values={EMPTY_PRODUCT} categories={categoryOptions(options.categories, locale)} brands={brandOptions(options.brands, locale)} action={createProductAction} />
    </>
  );
}
