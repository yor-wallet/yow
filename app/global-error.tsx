'use client';

/** Last-resort error boundary (errors thrown by the root layout itself). */
export default function GlobalError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
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
          <h1 style={{ fontSize: 22, margin: '24px 0 8px' }}>حدث خطأ ما · Something went wrong</h1>
          <p style={{ color: '#475569', margin: '0 0 24px' }}>Une erreur s’est produite</p>
          <button
            type="button"
            onClick={reset}
            style={{
              minHeight: 44,
              padding: '0 20px',
              borderRadius: 12,
              border: '1px solid #0A1937',
              fontWeight: 600,
              color: '#0A1937',
              background: '#FEE225',
              cursor: 'pointer',
            }}
          >
            إعادة المحاولة · Try again · Réessayer
          </button>
        </main>
      </body>
    </html>
  );
}
