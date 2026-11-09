import localFont from 'next/font/local';

/**
 * Self-hosted fonts (no runtime dependency on Google Fonts):
 * Inter (variable, Latin) for en/fr and Latin glyphs, IBM Plex Sans Arabic for Arabic.
 * The font stack in globals.css puts the right family first per `lang`.
 */
export const inter = localFont({
  src: '../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  variable: '--font-inter',
  weight: '100 900',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', 'Segoe UI', 'Roboto', 'sans-serif'],
});

export const plexArabic = localFont({
  src: [
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-400-normal.woff2', weight: '400', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-500-normal.woff2', weight: '500', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-600-normal.woff2', weight: '600', style: 'normal' },
    { path: '../node_modules/@fontsource/ibm-plex-sans-arabic/files/ibm-plex-sans-arabic-arabic-700-normal.woff2', weight: '700', style: 'normal' },
  ],
  variable: '--font-plex-arabic',
  display: 'swap',
  // Only preloaded where needed: the browser fetches it on demand for Arabic glyphs.
  preload: false,
  fallback: ['Tahoma', 'Noto Sans Arabic', 'sans-serif'],
});
