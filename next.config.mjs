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
  // S3 uploads go through /api/upload-binary (same-origin) and every MuAPI
  // call is proxied through /api/* (same-origin) so the browser never needs
  // a direct connect to api.muapi.ai or any *.s3.amazonaws.com host.
  "connect-src 'self' https://yrqzwqywxfesmbvhzjgj.supabase.co",
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
  env: {
    NEXT_PUBLIC_SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish',
    // Edge middleware bakes env at build time.
    SUPABASE_URL: 'https://yrqzwqywxfesmbvhzjgj.supabase.co',
  },
  transpilePackages: ['studio', 'ai-agent', 'workflow-builder', 'design-agent'],
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  // Marketing site lives at the root, sourced from app/veyrnox/* so the
  // design peer's tree stays intact. /studio, /agents, /workflow, /api,
  // /auth stay first-class.
  // Canonicalize: /veyrnox/... becomes /...  — the /veyrnox subtree is an
  // internal implementation detail, not a public URL.
  async redirects() {
    return [
      { source: '/veyrnox', destination: '/', permanent: true },
      { source: '/veyrnox/pricing', destination: '/pricing', permanent: true },
      { source: '/veyrnox/presets', destination: '/presets', permanent: true },
      { source: '/veyrnox/design-system', destination: '/design-system', permanent: true },
      { source: '/veyrnox/app', destination: '/app', permanent: true },
      { source: '/veyrnox/app/:path*', destination: '/app/:path*', permanent: true },
      { source: '/veyrnox/m', destination: '/m', permanent: true },
      { source: '/veyrnox/m/:path*', destination: '/m/:path*', permanent: true },
    ];
  },
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/', destination: '/veyrnox' },
        { source: '/pricing', destination: '/veyrnox/pricing' },
        { source: '/presets', destination: '/veyrnox/presets' },
        { source: '/design-system', destination: '/veyrnox/design-system' },
        { source: '/app', destination: '/veyrnox/app' },
        { source: '/app/:path*', destination: '/veyrnox/app/:path*' },
        { source: '/m', destination: '/veyrnox/m' },
        { source: '/m/:path*', destination: '/veyrnox/m/:path*' },
      ],
    };
  },
};

export default nextConfig;
