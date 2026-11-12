import type { Metadata } from 'next';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { requireAdmin } from '@/lib/admin/guard';
import { CatalogueImportForm } from '@/components/admin/CatalogueImportForm';
import { AdminPageHeader, Section } from '@/components/admin/ui';

type Props = { params: Promise<{ locale: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const t = await getTranslations({ locale: asLocale((await params).locale), namespace: 'admin' });
  return { title: t('import.title'), robots: { index: false } };
}

export default async function ImportCataloguePage({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  await requireAdmin('catalog:write', '/admin/products/import');
  const t = await getTranslations('admin');
  const rules = ['drafts', 'noVariants', 'noPrices', 'idempotent'] as const;

  return (
    <>
      <AdminPageHeader title={t('import.title')} subtitle={t('import.subtitle')} backHref="/admin/products" />
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
    </>
  );
}
