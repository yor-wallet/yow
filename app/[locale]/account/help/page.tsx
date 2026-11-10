import { setRequestLocale } from 'next-intl/server';
import { redirect } from '@/i18n/navigation';
import { asLocale } from '@/i18n/routing';

type Props = { params: Promise<{ locale: string }> };

/** `/account/help` (linked from older pages) → the public help centre `/help`. */
export default async function AccountHelpRedirect({ params }: Props) {
  const locale = asLocale((await params).locale);
  setRequestLocale(locale);
  redirect({ href: '/help', locale });
}
