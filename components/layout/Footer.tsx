import { getLocale, getTranslations } from 'next-intl/server';
import { Link } from '@/i18n/navigation';
import { getNavCategories } from '@/lib/nav';
import { localize } from '@/lib/localized';
import { Logo } from '@/components/ui/Logo';
import { LocaleSwitcher } from './LocaleSwitcher';

const linkClass = 'inline-flex min-h-11 items-center text-sm text-muted transition-colors duration-(--dur-btn) hover:text-fg';

/**
 * Full footer. Always rendered on a dark surface (`data-theme="dark"` re-scopes the
 * tokens), so the transparent logo is correct in both themes. No social links
 * (none exist yet — never fake them).
 */
export async function Footer() {
  const [t, locale, categories] = await Promise.all([getTranslations('nav'), getLocale(), getNavCategories()]);
  const year = new Date().getFullYear();
  const methods = ['wallet', 'card', 'ooredoo', 'omantel', 'crypto', 'giftCard', 'flex'] as const;

  return (
    <footer
      data-theme="dark"
      className="relative mt-16 bg-night/85 text-fg backdrop-blur-sm max-lg:pb-[calc(var(--bottom-nav-h)+var(--safe-bottom)+8px)]"
      data-testid="site-footer"
    >
      <span aria-hidden="true" className="doom-hairline top-0" />
      <div className="page-container grid grid-cols-1 gap-10 py-12 md:grid-cols-2 lg:grid-cols-12">
        <section className="lg:col-span-4" aria-labelledby="footer-about">
          <Logo surface="dark" height={56} />
          <h2 id="footer-about" className="mt-5 text-sm font-bold uppercase tracking-wider text-fg">
            {t('footer.about')}
          </h2>
          <p className="mt-2 max-w-sm text-sm text-muted">{t('footer.aboutText')}</p>
        </section>

        <nav className="lg:col-span-2" aria-labelledby="footer-shop">
          <h2 id="footer-shop" className="text-sm font-bold uppercase tracking-wider">
            {t('footer.shop')}
          </h2>
          <ul className="mt-2">
            {categories.map((c) => (
              <li key={c.id}>
                <Link href={`/category/${c.slug}`} className={linkClass}>
                  {localize(c.name, locale)}
                </Link>
              </li>
            ))}
            <li>
              <Link href="/promotions" className={linkClass}>
                {t('promotions')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav className="lg:col-span-3" aria-labelledby="footer-help">
          <h2 id="footer-help" className="text-sm font-bold uppercase tracking-wider">
            {t('footer.help')}
          </h2>
          <ul className="mt-2">
            <li>
              <Link href="/delivery" className={linkClass}>
                {t('footer.delivery')}
              </Link>
            </li>
            <li>
              <Link href="/flex" className={linkClass}>
                {t('footer.flex')}
              </Link>
            </li>
            <li>
              <Link href="/orders" className={linkClass}>
                {t('footer.trackOrder')}
              </Link>
            </li>
            <li>
              <Link href="/account/support" className={linkClass}>
                {t('footer.support')}
              </Link>
            </li>
          </ul>
        </nav>

        <nav className="lg:col-span-3" aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="text-sm font-bold uppercase tracking-wider">
            {t('footer.legal')}
          </h2>
          <ul className="mt-2">
            <li>
              <Link href="/legal/terms" className={linkClass}>
                {t('footer.terms')}
              </Link>
            </li>
            <li>
              <Link href="/legal/privacy" className={linkClass}>
                {t('footer.privacy')}
              </Link>
            </li>
            <li>
              <Link href="/legal/returns" className={linkClass}>
                {t('footer.returns')}
              </Link>
            </li>
          </ul>
        </nav>
      </div>

      <div className="border-t border-border">
        <div className="page-container grid grid-cols-1 gap-8 py-8 lg:grid-cols-2">
          <section aria-labelledby="footer-payments">
            <h2 id="footer-payments" className="text-sm font-bold uppercase tracking-wider">
              {t('footer.payments')}
            </h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {methods.map((m) => (
                <li key={m} className="rounded-lg border border-border bg-night-2 px-2.5 py-1 text-xs font-medium text-muted">
                  {t(`paymentMethods.${m}`)}
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-muted">{t('footer.paymentsNote')}</p>
          </section>
          <section aria-labelledby="footer-languages" className="lg:justify-self-end">
            <h2 id="footer-languages" className="text-sm font-bold uppercase tracking-wider">
              {t('footer.languages')}
            </h2>
            <LocaleSwitcher variant="inline" className="mt-3" />
          </section>
        </div>
      </div>

      <div className="border-t border-border">
        <p className="page-container py-5 text-xs text-muted">{t('footer.rights', { year })}</p>
      </div>
    </footer>
  );
}
