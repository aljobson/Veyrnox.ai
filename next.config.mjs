/** @type {import('next').NextConfig} */
import { contentSecurityPolicy } from './lib/contentSecurityPolicy.mjs';

// All HTML uses middleware's fresh nonce policy (ADR-0049). API responses
// keep a static restrictive policy without allowing inline scripts.
const isDev = process.env.NODE_ENV === 'development';
const CSP = contentSecurityPolicy(undefined, isDev);

const securityHeaders = [
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
      {
        // Do not append a second CSP to middleware's nonce policy.
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: CSP }],
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
