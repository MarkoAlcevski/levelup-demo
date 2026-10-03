import type { Metadata, Viewport } from 'next';
import { Geist_Mono, Onest } from 'next/font/google';
import { cookies } from 'next/headers';
import { APP_NAME, TAGLINE } from '@/lib/brand';
import { Providers } from '@/components/providers';
import './globals.css';

const onest = Onest({ subsets: ['latin', 'latin-ext', 'cyrillic'], variable: '--font-onest', display: 'swap' });
const geistMono = Geist_Mono({ subsets: ['latin'], variable: '--font-geist-mono', display: 'swap' });

export const metadata: Metadata = {
  title: { default: APP_NAME, template: `%s · ${APP_NAME}` },
  description: TAGLINE,
  applicationName: APP_NAME,
  appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: 'black-translucent' },
  formatDetection: { telephone: false },
  icons: { icon: '/icon.svg', apple: '/apple-icon.png' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: dark)', color: '#0b0c0e' },
    { media: '(prefers-color-scheme: light)', color: '#f2f3f5' },
  ],
};

const THEMES = new Set(['system', 'dark', 'light']);
const ACCENTS = new Set(['volt', 'ember', 'cobalt', 'ivory']);

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const jar = await cookies();
  const theme = THEMES.has(jar.get('kept_theme')?.value ?? '') ? jar.get('kept_theme')!.value : 'system';
  const accent = ACCENTS.has(jar.get('kept_accent')?.value ?? '') ? jar.get('kept_accent')!.value : 'volt';
  return (
    <html lang="en" data-theme={theme} data-accent={accent} className={`${onest.variable} ${geistMono.variable}`} suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
