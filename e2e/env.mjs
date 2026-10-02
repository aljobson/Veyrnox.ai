// Staging by default. Production is refused: these tests sign in, and a
// mistake there costs real money and real users' data.
export const BASE_URL = (process.env.E2E_BASE_URL || 'https://veyrnox-ai-staging.al-jobson.workers.dev').replace(/\/$/, '');
if (/^https:\/\/(www\.)?veyrnox\.ai$/.test(BASE_URL)) throw new Error('e2e: refusing to run against production');

// Staging's public Supabase values (wrangler.jsonc env.staging.vars).
export const SUPABASE_URL = process.env.E2E_SUPABASE_URL || 'https://yrqzwqywxfesmbvhzjgj.supabase.co';
export const SUPABASE_ANON_KEY = process.env.E2E_SUPABASE_ANON_KEY || 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish';

// A confirmed staging account the owner created for these tests.
export const E2E_EMAIL = process.env.E2E_EMAIL || '';
export const E2E_PASSWORD = process.env.E2E_PASSWORD || '';
export const HAS_ACCOUNT = Boolean(E2E_EMAIL && E2E_PASSWORD);
