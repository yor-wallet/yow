import { notFound } from 'next/navigation';
import { setRequestLocale } from 'next-intl/server';
import { asLocale } from '@/i18n/routing';
import { PageHeader } from '@/components/layout/PageHeader';
import { UiKitDemo } from './UiKitDemo';

/**
 * Internal component gallery (QA, screenshots, e2e of Modal/BottomSheet history behaviour).
 * Disabled in production unless ENABLE_UI_KIT=1 (the Playwright web server sets it).
 */
export const metadata = { robots: { index: false, follow: false } };

export default async function UiKitPage({ params }: { params: Promise<{ locale: string }> }) {
  if (process.env.NODE_ENV === 'production' && process.env.ENABLE_UI_KIT !== '1') notFound();
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  return (
    <div>
      <PageHeader title="UI kit" fallbackHref="/" />
      <UiKitDemo />
    </div>
  );
}
