import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { getAdminProduct, productFormOptions } from '@/lib/admin/products';
import { localize } from '@/lib/localized';
import { ImageManager } from '@/components/admin/ImageManager';
import { ImportNotes } from '@/components/admin/ImportNotes';
import { readImportMeta } from '@/lib/admin/catalogue-import';
import { ProductForm } from '@/components/admin/ProductForm';
import { ProductStatusBar } from '@/components/admin/ProductStatusBar';
import { VariantEditor } from '@/components/admin/VariantEditor';
import { brandOptions, categoryOptions, imageToItem, productToFormValues, variantToFormValues } from '@/components/admin/options';
import { VariantPriceGrid, type GridRow } from '@/components/admin/VariantPriceGrid';
import { AdminPageHeader, Section } from '@/components/admin/ui';
import { saveVariantGridAction, updateProductAction } from '../actions';

type Props = { params: Promise<{ locale: string; id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: asLocale(locale), namespace: 'admin' });
  return { title: t('form.editTitle'), robots: { index: false } };
}

export default async function EditProductPage({ params }: Props) {
  const { locale: rawLocale, id } = await params;
  const locale = asLocale(rawLocale);
  setRequestLocale(locale);
  const ctx = await requireAdmin('catalog:write', `/admin/products/${id}`);
  const [t, product, options] = await Promise.all([getTranslations('admin'), getAdminProduct(id), productFormOptions()]);
  if (!product) notFound();

  const name = localize(product.name, locale, product.sku);
  const importMeta = readImportMeta(product.importMeta);
  const images = product.images.map((img) => imageToItem(img, product.variants, locale, name)).filter((i): i is NonNullable<typeof i> => i !== null);

  const omr = (b: number | null) => (b === null ? '' : `${Math.floor(b / 1000)}.${String(b % 1000).padStart(3, '0')}`);
  const gridRows: GridRow[] = product.variants.map((v) => ({
    id: v.id,
    sku: v.sku,
    label: [v.capacity, v.color].filter(Boolean).join(' · ') || v.sku,
    colorHex: v.colorHex,
    capacity: v.capacity ?? '',
    price: omr(v.priceBaisa),
    compareAt: omr(v.compareAtBaisa),
    cost: omr(v.costBaisa),
    stock: String(v.stock),
    reserved: v.reserved,
    isActive: v.isActive,
  }));

  return (
    <>
      <AdminPageHeader title={name} subtitle={`SKU ${product.sku}`} backHref="/admin/products" />
      <ProductStatusBar productId={product.id} slug={product.slug} status={product.status} activeVariants={product.variants.filter((v) => v.isActive).length} />
      <div className="flex flex-col gap-6">
        {importMeta ? <ImportNotes meta={importMeta} /> : null}
        {gridRows.length > 0 ? (
          <Section id="prices" title={t('pricing.gridTitle')} description={t('pricing.gridText')}>
            <VariantPriceGrid productId={product.id} rows={gridRows} canPrice={ctx.can('prices:write')} canStock={ctx.can('stock:write')} action={saveVariantGridAction} />
          </Section>
        ) : null}
        <ProductForm mode="edit" values={productToFormValues(product)} categories={categoryOptions(options.categories, locale)} brands={brandOptions(options.brands, locale)} action={updateProductAction} />
        <VariantEditor productId={product.id} variants={product.variants.map(variantToFormValues)} canPrice={ctx.can('prices:write')} canStock={ctx.can('stock:write')} />
        <ImageManager productId={product.id} images={images} variantOptions={product.variants.map((v) => ({ value: v.id, label: v.sku }))} />
      </div>
    </>
  );
}
