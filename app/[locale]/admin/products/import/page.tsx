import type { Metadata } from 'next';
import { Download } from 'lucide-react';
import { getFormatter, getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { catalogueGaps } from '@/lib/admin/products';
import { buttonClasses } from '@/components/ui/Button';
import { CatalogueImportForm } from '@/components/admin/CatalogueImportForm';
import { VariantImport } from '@/components/admin/VariantImport';
import { VerifiedCatalogueForm } from '@/components/admin/VerifiedCatalogueForm';
import { VisualPackImport } from '@/components/admin/VisualPackImport';
import { VISUAL_PACKS, visualPackSummary } from '@/lib/admin/visual-pack-import';
import { AdminPageHeader, Section } from '@/components/admin/ui';
import { applyImportAction, applyVerifiedCatalogueAction, previewImportAction } from './actions';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('import.title'), robots: { index: false } };
}

/** Catalogue & prices: verified 2026 catalogue, price/stock CSV (export, dry run, apply) and JSON packs. */
export default async function ImportCataloguePage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('catalog:write', '/admin/products/import');
  const [t, format, gaps] = await Promise.all([getTranslations('admin'), getFormatter(), catalogueGaps()]);
  const packs = await Promise.all(VISUAL_PACKS.map((p) => visualPackSummary(p.key)));
  const rules = ['drafts', 'noVariants', 'noPrices', 'idempotent'] as const;

  return (
    <>
      <AdminPageHeader
        eyebrow={t('nav.groups.commerce')}
        title={t('import.title')}
        subtitle={t('import.subtitle')}
        backHref="/admin/products"
        crumbs={[{ label: t('products.title'), href: '/admin/products' }, { label: t('import.title') }]}
      />
      <div className="flex flex-col gap-6">
        <Section id="verified" title={t('verified.title')} description={t('verified.text')}>
          <VerifiedCatalogueForm action={applyVerifiedCatalogueAction} />
        </Section>

        <Section id="visual-packs" title={t('import.packs.title')} description={t('import.packs.text')}>
          <ul className="flex flex-col gap-4">
            {packs.map((p) => (
              <li key={p.key}>
                <VisualPackImport packKey={p.key} models={p.models} images={p.images} verifiedOn={p.verifiedOn} />
              </li>
            ))}
          </ul>
        </Section>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
          <Section id="prices-export" title={t('pricing.exportTitle')} description={t('pricing.exportText')}>
            <div className="grid gap-3">
              <a href={`/api/admin/variants/export?filter=needs-price&locale=${locale}`} className={buttonClasses({ variant: 'primary', fullWidth: true })} download data-testid="export-needs-price">
                <Download size={16} aria-hidden="true" />
                {t('pricing.exportNeedsPrice', { count: gaps.variantsWithoutPrice })}
              </a>
              <a href={`/api/admin/variants/export?locale=${locale}`} className={buttonClasses({ variant: 'outline', fullWidth: true })} download data-testid="export-all">
                <Download size={16} aria-hidden="true" />
                {t('pricing.exportAll')}
              </a>
              <p className="text-xs text-muted">{t('pricing.exportNote', { products: format.number(gaps.needsPrice) })}</p>
            </div>
          </Section>
          <Section id="prices-import" title={t('pricing.importStep')} description={t('pricing.importText')}>
            <VariantImport previewAction={previewImportAction} applyAction={applyImportAction} />
          </Section>
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
          <Section id="import" title={t('import.formTitle')}>
            <CatalogueImportForm />
          </Section>
          <Section id="import-rules" title={t('import.rulesTitle')}>
            <ul className="flex list-disc flex-col gap-2 ps-5 text-sm text-muted" data-testid="import-rules">
              {rules.map((r) => (
                <li key={r}>{t(`import.rules.${r}`)}</li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </>
  );
}
