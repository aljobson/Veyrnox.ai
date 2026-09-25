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

// The library and create pages put a presigned R2 GET straight into
// <img>/<video>/<audio>, so img-src and media-src have to name that host.
// It is our own account's S3 endpoint (packages/adapters/r2.js#endpointHost);
// both jurisdictions are listed because R2_JURISDICTION is a Worker secret
// this build cannot read, and ADR-0021 moves media to the EU bucket.
// The account id is already public in .github/workflows/deploy-production.yml
// — it is an identifier, not a credential; R2_SECRET_ACCESS_KEY is the secret.
// Hardcoded, like SUPABASE_URL below: reading it from env at build time would
// silently drop the host (it is a wrangler secret) and break every thumbnail.
const R2_ACCOUNT = 'fb18d9f7052afbea5a5e0eae69948af2';
const R2_ENDPOINTS = [
  `https://${R2_ACCOUNT}.r2.cloudflarestorage.com`,
  `https://${R2_ACCOUNT}.eu.r2.cloudflarestorage.com`,
].join(' ');

// Cloudflare Turnstile (ADR-0026): its script and its challenge iframe. That
// host in script-src and frame-src only; connect-src stays as it is.
const TURNSTILE = 'https://challenges.cloudflare.com';

const CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ''} ${TURNSTILE}`,
  `frame-src ${TURNSTILE}`,
  "style-src 'self' 'unsafe-inline'",
  // Not `https:`. The session — refresh token included — lives in
  // localStorage, and `script-src 'unsafe-inline'` is still here for RSC
  // hydration, so a wildcard img/media host is a one-line exfil beacon for
  // any future injection. Everything we render is either same-origin, a
  // data:/blob: URL we built, or a presigned R2 object on the account's own
  // S3 endpoint. A new media host needs an ADR, like connect-src.
  `img-src 'self' data: blob: ${R2_ENDPOINTS}`,
  `media-src 'self' data: blob: ${R2_ENDPOINTS}`,
  "font-src 'self' data:",
  // Generation traffic goes through /api/v1/*. The one other host is our own
  // R2 S3 endpoint: the create page PUTs a start image there on a 15-minute
  // URL /api/v1/uploads signed for one key and one Content-Type (ADR-0028).
  `connect-src 'self' https://xdxdzmsztyzbnzeforxx.supabase.co ${R2_ENDPOINTS}`,
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
    // Public, like the anon key. Empty = no widget and no token sent, which is
    // the pre-CAPTCHA behaviour. Never empty this while Supabase CAPTCHA is on:
    // every email/password sign-in would fail (ADR-0026).
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAE-nahDRUDwD5HEx',
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
      { source: '/veyrnox/social-cinema', destination: '/social-cinema', permanent: true },
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
        { source: '/social-cinema', destination: '/veyrnox/social-cinema' },
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
