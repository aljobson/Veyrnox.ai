/** @type {import('next').NextConfig} */

// Enforced CSP. `unsafe-inline` on script-src is retained for Next 15 RSC
// streaming hydration (see vercel/next.js#50659 — nonce propagation to
// inline flight/hydration scripts is still gated; adding a nonce alone
// breaks hydration under App Router + OpenNext-Cloudflare). Tracked in
// a follow-up issue on this repo. `unsafe-eval` has been dropped.
// ponytail: keep unsafe-inline until Next.js nonce support is stable in
// App Router SSR + OpenNext workerd runtime; then switch to per-request
// nonce via middleware.js and drop unsafe-inline.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://api.muapi.ai https://*.s3.amazonaws.com https://s3.amazonaws.com",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const securityHeaders = [
  { key: 'Content-Security-Policy', value: CSP },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  transpilePackages: ['studio', 'ai-agent', 'workflow-builder', 'design-agent'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
