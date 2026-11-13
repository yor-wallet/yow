import Link from 'next/link';

/**
 * Fallback for non-localised URLs that escaped the middleware (rare). Localised
 * 404s are rendered by app/[locale]/not-found.tsx inside the full site chrome.
 */
export default function RootNotFound() {
  return (
    <html lang="ar" dir="rtl">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#FDFAF6',
          color: '#0A1937',
          fontFamily: 'Tahoma, Arial, sans-serif',
          textAlign: 'center',
          padding: 24,
        }}
      >
        <main>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/doom-logo-horizontal-transparent-320.webp" width={240} height={68} alt="DOOM | دوم" />
          <h1 style={{ fontSize: 22, margin: '24px 0 8px' }}>الصفحة غير موجودة · Page not found</h1>
          <p style={{ color: '#475569', margin: '0 0 24px' }}>Page introuvable</p>
          <p style={{ display: 'flex', gap: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
            <Link href="/ar" style={{ color: '#0A1937', fontWeight: 600, padding: 12 }}>
              العربية
            </Link>
            <Link href="/en" style={{ color: '#0A1937', fontWeight: 600, padding: 12 }}>
              English
            </Link>
            <Link href="/fr" style={{ color: '#0A1937', fontWeight: 600, padding: 12 }}>
              Français
            </Link>
          </p>
        </main>
      </body>
    </html>
  );
}
