/** @type {import('next').NextConfig} */

// Enforced CSP. `unsafe-inline` on script-src is retained for Next 15 RSC
// streaming hydration (see vercel/next.js#50659 — nonce propagation to
// inline flight/hydration scripts is still gated; adding a nonce alone
// breaks hydration under App Router + OpenNext-Cloudflare). `unsafe-eval`
// has been dropped.
//
// The blocker is not only that issue. A nonce has to be minted per request,
// and almost every route here is statically prerendered (`next build` marks
// them `○ (Static)`), so the inline <script> tags are baked into the HTML at
// build time. A per-request nonce from middleware.js would never match the
// baked ones and hydration would die silently — every onClick inert. Adopting
// a nonce therefore means forcing dynamic rendering site-wide, turning every
// marketing page view into a Worker SSR invocation. That is an architecture
// decision with a real cost, not a header change: it needs an ADR.
//
// So `unsafe-inline` stands, and the control that actually protects the
// session token in localStorage is that first-party code contains no
// HTML/code-from-string sink at all. That is enforced by the "Grep gates"
// step in .github/workflows/ci.yml, not left to review. tests/
// securityHeaders.test.mjs pins everything below so it cannot drift.
//
// ponytail: revisit only with an ADR that accepts full dynamic rendering, or
// when Next can nonce a prerendered page's inline scripts.
// `next dev` ships its HMR / React Refresh runtime through eval(); without
// 'unsafe-eval' hydration dies silently in local dev and every onClick is
// inert. Production builds contain no eval, so the directive is dev-only.
const isDev = process.env.NODE_ENV === 'development';

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "font-src 'self' data:",
  // Same-origin only: generation traffic goes through /api/v1/* and assets
  // through presigned R2 URLs fetched from our own origin.
  "connect-src 'self' https://xdxdzmsztyzbnzeforxx.supabase.co",
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
    NEXT_PUBLIC_SUPABASE_URL: 'https://xdxdzmsztyzbnzeforxx.supabase.co',
    NEXT_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_HwEQqi6FXJOmWpy5eqR9-A_Zvy8_ii1',
    // Edge middleware bakes env at build time.
    SUPABASE_URL: 'https://xdxdzmsztyzbnzeforxx.supabase.co',
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
    ];
  },
  // Marketing site lives at the root, sourced from app/veyrnox/* so the
  // design peer's tree stays intact. /api and /auth stay first-class.
  // /studio, /agents and /workflow were removed with the legacy studio
  // (ADR-0015) and now 404.
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
