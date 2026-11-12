import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const api = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';
const here = dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  outputFileTracingRoot: join(here, '../../'),
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@f1archive/shared'],
  experimental: { proxyTimeout: 600_000 },
  async rewrites() {
    return [
      { source: '/api/:path((?!internal(?:/|$)).*)', destination: `${api}/api/:path` },
      { source: '/media/:path*', destination: `${api}/media/:path*` },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
        ],
      },
    ];
  },
  images: { unoptimized: true },
  webpack(config) {
    config.resolve.extensionAlias = { '.js': ['.ts', '.tsx', '.js'], ...(config.resolve.extensionAlias ?? {}) };
    return config;
  },
};

export default nextConfig;
