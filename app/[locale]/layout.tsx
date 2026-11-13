import '../globals.css';
import type { ReactNode } from 'react';
import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import { notFound } from 'next/navigation';
import { hasLocale, NextIntlClientProvider } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';
import { getDirection, routing, type Locale } from '@/i18n/routing';
import { THEME_COOKIE } from '@/lib/cookies';
import { getHeaderCounts } from '@/lib/nav';
import { plexArabic, plexSans } from '../fonts';
import { THEME_COLORS, ThemeProvider, type Theme } from '@/components/layout/ThemeProvider';
import { ToastProvider } from '@/components/ui/Toast';
import { Suspense } from 'react';
import { NavigationTracker } from '@/components/layout/NavigationTracker';
import { NavigationProgress } from '@/components/layout/NavigationProgress';
import { AmbientBackground } from '@/components/layout/AmbientBackground';
import { SpotlightTracker } from '@/components/layout/SpotlightTracker';
import { SiteChrome } from '@/components/layout/SiteChrome';
import { Header } from '@/components/layout/Header';
import { Footer } from '@/components/layout/Footer';
import { MobileBottomNav } from '@/components/layout/MobileBottomNav';
import { ServiceWorkerRegister } from '@/components/layout/ServiceWorkerRegister';

type Props = { children: ReactNode; params: Promise<{ locale: string }> };

// Every page is request-time rendered: the chrome reads the session, cart and theme cookies.
// Light is the default look (the approved design); a visitor who switches to dark keeps it (cookie).
async function readTheme(): Promise<Theme> {
  return (await cookies()).get(THEME_COOKIE)?.value === 'dark' ? 'dark' : 'light';
}

const OG_LOCALE: Record<Locale, string> = { ar: 'ar_OM', en: 'en_US', fr: 'fr_FR' };

export async function generateViewport(): Promise<Viewport> {
  const theme = await readTheme();
  // Never maximumScale / userScalable (SPEC: zoom must stay possible).
  return {
    width: 'device-width',
    initialScale: 1,
    viewportFit: 'cover',
    interactiveWidget: 'resizes-content',
    themeColor: THEME_COLORS[theme],
    colorScheme: theme,
  };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const safeLocale: Locale = hasLocale(routing.locales, locale) ? locale : routing.defaultLocale;
  const t = await getTranslations({ locale: safeLocale, namespace: 'common' });
  return {
    metadataBase: new URL(process.env.APP_URL || 'http://localhost:3000'),
    title: { default: 'DOOM | دوم', template: '%s · DOOM | دوم' },
    description: t('meta.description'),
    applicationName: 'DOOM | دوم',
    manifest: '/manifest.webmanifest',
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/icons/icon-32.png', type: 'image/png', sizes: '32x32' },
        { url: '/icons/icon-192.png', type: 'image/png', sizes: '192x192' },
        { url: '/icons/icon-512.png', type: 'image/png', sizes: '512x512' },
      ],
      apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180' }],
    },
    appleWebApp: { capable: true, title: 'DOOM | دوم', statusBarStyle: 'black-translucent' },
    formatDetection: { telephone: false, email: false, address: false },
    alternates: { languages: { ar: '/ar', en: '/en', fr: '/fr', 'x-default': '/ar' } },
    openGraph: {
      type: 'website',
      siteName: 'DOOM | دوم',
      title: t('meta.ogTitle'),
      description: t('meta.description'),
      locale: OG_LOCALE[safeLocale],
      images: [{ url: '/brand/doom-logo-vertical-1024.png', width: 1024, height: 1024, alt: 'DOOM | دوم' }],
    },
    twitter: { card: 'summary', title: t('meta.ogTitle'), description: t('meta.description') },
  };
}

export default async function LocaleLayout({ children, params }: Props) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  const [theme, counts, t] = await Promise.all([readTheme(), getHeaderCounts(), getTranslations('common.a11y')]);

  return (
    <html
      lang={locale}
      dir={getDirection(locale)}
      data-theme={theme}
      className={`${plexSans.variable} ${plexArabic.variable}`}
      suppressHydrationWarning
    >
      <body className="flex min-h-dvh flex-col">
        <AmbientBackground />
        <NextIntlClientProvider>
          <ThemeProvider initialTheme={theme}>
            <ToastProvider>
              <a href="#main" className="skip-link">
                {t('skipToContent')}
              </a>
              <NavigationTracker />
              <Suspense fallback={null}>
                <NavigationProgress />
              </Suspense>
              <SpotlightTracker />
              <SiteChrome header={<Header />} footer={<Footer />} bottomNav={<MobileBottomNav cartCount={counts.cart} />}>
                {children}
              </SiteChrome>
              <ServiceWorkerRegister />
            </ToastProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
