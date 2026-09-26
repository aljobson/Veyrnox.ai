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

export function contentSecurityPolicy(nonce, isDev = false) {
  if (nonce !== undefined && !/^[A-Za-z0-9+/]{22}==$/.test(nonce)) throw new Error('invalid CSP nonce');
  return [
  "default-src 'self'",
  `script-src 'self' ${nonce ? `'nonce-${nonce}'` : ''}${isDev ? " 'unsafe-eval'" : ''} ${TURNSTILE}`,
  // ADR-0059: the Stream player iframe on /social-cinema/watch, and nothing else.
  `frame-src ${TURNSTILE} https://*.cloudflarestream.com`,
  "style-src 'self' 'unsafe-inline'",
  // Not `https:`. The session — refresh token included — lives in
  // localStorage, so a wildcard img/media host is an exfiltration beacon for
  // any future injection. Everything we render is either same-origin, a
  // data:/blob: URL we built, or a presigned R2 object on the account's own
  // S3 endpoint. A new media host needs an ADR, like connect-src.
  `img-src 'self' data: blob: ${R2_ENDPOINTS}`,
  `media-src 'self' data: blob: ${R2_ENDPOINTS}`,
  "font-src 'self' data:",
  // Generation traffic goes through /api/v1/*. The one other host is our own
  // R2 S3 endpoint: the create page PUTs a start image there on a 15-minute
  // URL /api/v1/uploads signed for one key and one Content-Type (ADR-0028).
  // ADR-0052: exact Stream tus upload origins, no wildcard or playback hosts.
  `connect-src 'self' https://xdxdzmsztyzbnzeforxx.supabase.co ${R2_ENDPOINTS} https://upload.videodelivery.net https://upload.cloudflarestream.com`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');
}


