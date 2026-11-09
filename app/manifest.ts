import type { MetadataRoute } from 'next';

/** PWA manifest — served at /manifest.webmanifest. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/ar',
    name: 'DOOM | دوم',
    short_name: 'DOOM',
    description: 'DOOM | دوم — premium electronics in the Sultanate of Oman.',
    lang: 'ar',
    dir: 'rtl',
    start_url: '/ar',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    theme_color: '#10052E',
    background_color: '#10052E',
    categories: ['shopping', 'business'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-256.png', sizes: '256x256', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'any' },
      { src: '/icons/maskable-192.png', sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      { src: '/icons/maskable-1024.png', sizes: '1024x1024', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
