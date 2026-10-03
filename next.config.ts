import type { NextConfig } from 'next';

const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Permissions-Policy', value: 'camera=(self), microphone=(), geolocation=(), payment=()' },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Native / WASM packages are loaded with Node's require instead of being bundled.
  serverExternalPackages: ['@electric-sql/pglite', 'sharp', 'pg'],
  // Lets a phone on the same Wi-Fi open the dev server (http://<pc-ip>:3100).
  allowedDevOrigins: ['192.168.*.*', '10.*.*.*', '*.local'],
  experimental: {
    // Cloudflare quick tunnels ("Share Kept.bat") put the app behind *.trycloudflare.com
    serverActions: { bodySizeLimit: '2mb', allowedOrigins: ['*.trycloudflare.com'] },
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};

export default nextConfig;
