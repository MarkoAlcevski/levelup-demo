import type { MetadataRoute } from 'next';
import { APP_NAME, TAGLINE } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: TAGLINE,
    id: '/today',
    start_url: '/today',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0b0c0e',
    theme_color: '#0b0c0e',
    categories: ['productivity', 'lifestyle', 'finance'],
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    shortcuts: [
      { name: 'Today', url: '/today' },
      { name: 'Log money', url: '/money' },
      { name: 'Evidence', url: '/progress/evidence' },
    ],
  };
}
