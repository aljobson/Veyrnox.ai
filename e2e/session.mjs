import { SUPABASE_URL, SUPABASE_ANON_KEY, E2E_EMAIL, E2E_PASSWORD } from './env.mjs';

// Same key and shape as app/lib/authClient.js.
const STORAGE_KEY = 'veyrnox_supabase_session';

let cached = null;

// Password grant against staging Auth, outside the browser: staging has no
// CAPTCHA on sign-in, and the Turnstile widget cannot be solved headless.
async function signIn() {
    if (cached && cached.expires_at - 120 > Date.now() / 1000) return cached;
    const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: 'POST',
        headers: { apikey: SUPABASE_ANON_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({ email: E2E_EMAIL, password: E2E_PASSWORD }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.access_token) throw new Error(`e2e sign-in failed: ${res.status} ${data.error_code || data.code || ''}`);
    cached = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || Math.floor(Date.now() / 1000) + (data.expires_in || 3600),
        user: data.user || null,
    };
    return cached;
}

/** Start the page signed in as the e2e account. */
export async function signedIn(page) {
    const session = await signIn();
    await page.addInitScript(([key, value]) => {
        try { localStorage.setItem(key, value); } catch { /* storage blocked: the test will fail on its own assertions */ }
    }, [STORAGE_KEY, JSON.stringify(session)]);
}
