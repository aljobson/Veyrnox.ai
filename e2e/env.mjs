// Staging by default. Production is refused: these tests sign in, and a
// mistake there costs real money and real users' data.
function stagingOrigin(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('e2e: refusing invalid target origin'); }
  // Validate the original spelling too: URL parsing normalizes dot paths,
  // whitespace and backslashes, which must never silently change the target.
  if (/[\u0000-\u0020\u007f]/.test(value) || !/^https?:\/\/[^/?#\\\s]+\/?$/i.test(value) ||
      !['https:', 'http:'].includes(url.protocol) || url.username || url.password ||
      url.pathname !== '/' || url.search || url.hash) {
    throw new Error('e2e: refusing non-origin target');
  }
  const hostname = url.hostname.toLowerCase().replace(/\.+$/, '');
  if (hostname === 'veyrnox.ai' || hostname.endsWith('.veyrnox.ai')) {
    throw new Error('e2e: refusing to run against production');
  }
  return url.origin;
}
export const BASE_URL = stagingOrigin(process.env.E2E_BASE_URL || 'https://veyrnox-ai-staging.al-jobson.workers.dev');

// Staging's public Supabase values (wrangler.jsonc env.staging.vars).
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'https://yrqzwqywxfesmbvhzjgj.supabase.co';
export const SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY || 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish';

// A confirmed staging account the owner created for these tests.
export const E2E_EMAIL = process.env.E2E_EMAIL || '';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || '';
export const HAS_ACCOUNT = Boolean(E2E_EMAIL && E2E_PASSWORD);
