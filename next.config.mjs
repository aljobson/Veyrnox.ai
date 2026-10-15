import { withReticle } from '@reticlehq/next';
import { withPostHogConfig } from '@posthog/nextjs-config';
import { buildConfig } from './packages/security/config.js';
import { oauthProvidersFor } from './packages/security/environments.js';
const identityConfig = buildConfig(process.env);

/** @type {import('next').NextConfig} */
import { contentSecurityPolicy } from './lib/contentSecurityPolicy.mjs';
import { LOCAL_SPEECH_WORKER_URL,localSpeechWorkerPolicy } from './app/veyrnox/_lib/localSpeechAssets.mjs';
import {EDITOR_VISION_PATH,editorVisionWorkerPolicy} from './app/veyrnox/_lib/editorVisionRuntime.mjs';

// All HTML uses middleware's fresh nonce policy (ADR-0060). API responses
// keep a static restrictive policy without allowing inline scripts.
const isDev = process.env.NODE_ENV === 'development';
const CSP = contentSecurityPolicy(undefined, isDev, identityConfig.appEnv);

const securityHeaders = [
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
];

const nextConfig = {
  images: {
    remotePatterns: [{ protocol: 'https', hostname: 'i.ytimg.com', pathname: '/vi/**' }],
  },
  env: {
    NEXT_PUBLIC_SUPABASE_URL: identityConfig.supabaseUrl,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: identityConfig.publishableKey,
    // Which "Continue with ..." buttons sign-in shows (environments.js).
    NEXT_PUBLIC_AUTH_PROVIDERS: oauthProvidersFor(identityConfig.appEnv).join(','),
    // Public, like the anon key. Empty = no widget and no token sent, which is
    // the pre-CAPTCHA behaviour. Never empty this while Supabase CAPTCHA is on:
    // every email/password sign-in would fail (ADR-0026).
    NEXT_PUBLIC_TURNSTILE_SITE_KEY: '0x4AAAAAAE-nahDRUDwD5HEx',
    // Public PostHog project token. Empty keeps analytics, replay, consent UI,
    // proxying and error delivery completely dormant.
    NEXT_PUBLIC_POSTHOG_KEY: process.env.NEXT_PUBLIC_POSTHOG_KEY || '',
    // Edge middleware bakes env at build time.
    SUPABASE_URL: identityConfig.supabaseUrl,
    APP_ENV: identityConfig.appEnv,
    PUBLIC_HOST: identityConfig.publicOrigin,
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: securityHeaders,
      },
      {
        // Voiceover recording is available only inside the editor. Keep the
        // default site-wide microphone denial and override it for this route.
        source: '/app/editor/:path*',
        headers: [{ key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' }],
      },
      {
        // Do not append a second CSP to middleware's nonce policy.
        source: '/api/:path*',
        headers: [{ key: 'Content-Security-Policy', value: CSP }],
      },
      {
        source: LOCAL_SPEECH_WORKER_URL,
        headers: [{key:'Content-Security-Policy',value:localSpeechWorkerPolicy(identityConfig.publicOrigin)}],
      },
      {
        source: `${EDITOR_VISION_PATH}/worker.mjs`,
        headers: [{key:'Content-Security-Policy',value:editorVisionWorkerPolicy(identityConfig.publicOrigin)}],
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
      { source: '/cinema', destination: '/social-cinema', permanent: false },
      { source: '/veyrnox/social-cinema', destination: '/social-cinema', permanent: true },
      { source: '/veyrnox/social-cinema/creator', destination: '/social-cinema/creator', permanent: true },
      { source: '/veyrnox/social-cinema/:path*', destination: '/social-cinema/:path*', permanent: true },
      { source: '/veyrnox/pricing', destination: '/pricing', permanent: true },
      { source: '/veyrnox/mcp', destination: '/mcp', permanent: true },
      { source: '/veyrnox/oauth/consent', destination: '/oauth/consent', permanent: true },
      { source: '/veyrnox/presets', destination: '/presets', permanent: true },
      { source: '/veyrnox/presets/:id', destination: '/presets/:id', permanent: true },
      { source: '/veyrnox/tools', destination: '/tools', permanent: true },
      { source: '/veyrnox/guides', destination: '/guides', permanent: true },
      { source: '/veyrnox/guides/:id', destination: '/guides/:id', permanent: true },
      { source: '/veyrnox/models', destination: '/models', permanent: true },
      { source: '/veyrnox/models/:id', destination: '/models/:id', permanent: true },
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
        { source: '/social-cinema/creator', destination: '/veyrnox/social-cinema/creator' },
        // Cinema Pass (ADR-0057) and the viewer pages (ADR-0059).
        { source: '/social-cinema/pass', destination: '/veyrnox/social-cinema/pass' },
        { source: '/social-cinema/series/:slug', destination: '/veyrnox/social-cinema/series/:slug' },
        { source: '/social-cinema/title/:id', destination: '/veyrnox/social-cinema/title/:id' },
        { source: '/social-cinema/watch/:id', destination: '/veyrnox/social-cinema/watch/:id' },
        { source: '/pricing', destination: '/veyrnox/pricing' },
        { source: '/mcp', destination: '/veyrnox/mcp' },
        { source: '/oauth/consent', destination: '/veyrnox/oauth/consent' },
        { source: '/presets', destination: '/veyrnox/presets' },
        { source: '/presets/:id', destination: '/veyrnox/presets/:id' },
        { source: '/tools', destination: '/veyrnox/tools' },
        { source: '/guides', destination: '/veyrnox/guides' },
        { source: '/guides/:id', destination: '/veyrnox/guides/:id' },
        { source: '/models', destination: '/veyrnox/models' },
        { source: '/models/:id', destination: '/veyrnox/models/:id' },
        { source: '/design-system', destination: '/veyrnox/design-system' },
        { source: '/app', destination: '/veyrnox/app' },
        { source: '/app/:path*', destination: '/veyrnox/app/:path*' },
        { source: '/m', destination: '/veyrnox/m' },
        { source: '/m/:path*', destination: '/veyrnox/m/:path*' },
      ],
    };
  },
};

const postHogSourceMapsEnabled = Boolean(
  process.env.NEXT_PUBLIC_POSTHOG_KEY?.startsWith('phc_')
  && process.env.POSTHOG_PERSONAL_API_KEY
  && process.env.POSTHOG_PROJECT_ID
);

const reticleConfig = withReticle(nextConfig);
const postHogConfig = {
  personalApiKey: process.env.POSTHOG_PERSONAL_API_KEY || '',
  projectId: process.env.POSTHOG_PROJECT_ID,
  host: 'https://eu.posthog.com',
  sourcemaps: {
    enabled: postHogSourceMapsEnabled,
    deleteAfterUpload: true,
    releaseName: 'veyrnox-web',
    releaseVersion: process.env.GITHUB_SHA,
    releaseMode: 'event',
  },
};

// PostHog must be the outermost wrapper when enabled so its production-
// compile hook can upload browser source maps. Keep the ordinary config object
// shape when credentials are absent; local builds and tests then generate and
// send nothing and existing config consumers do not become async.
export default postHogSourceMapsEnabled
  ? withPostHogConfig(reticleConfig, postHogConfig)
  : reticleConfig;
