"use client";

/**
 * Browser-side Supabase auth via plain fetch — no library dep.
 *
 * Lives under `app/lib/` (Next.js first-class client code) rather than
 * `packages/studio/src/` because the workspace's transpiled bundle
 * kept dragging any new auth file into the Workers Builds SSR path
 * — bisected across three implementations in PR #38.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at
 * bundle time. Anon key is safe to ship — never mirror
 * SUPABASE_SERVICE_ROLE_KEY or SUPABASE_JWT_SECRET into NEXT_PUBLIC_*.
 *
 * Session stored in localStorage. gatewayClient sends the access
 * token as Authorization: Bearer on every /api/v1/* call;
 * middleware.js reads Bearer first.
 */

/**
 * @typedef {object} VeyrnoxSession
 * @property {string} access_token   raw Supabase JWT (ES256, forwarded as
 *                                   `Authorization: Bearer` on /api/v1/*)
 * @property {string|null} refresh_token
 * @property {number} expires_at     unix seconds
 * @property {any|null} user         Supabase user record (may be null)
 */

const STORAGE_KEY = "veyrnox_supabase_session";
const listeners = new Set();

function cfg() {
    return {
        url: process.env.NEXT_PUBLIC_SUPABASE_URL,
        anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    };
}
function ensureCfg() {
    const c = cfg();
    if (!c.url || !c.anonKey) throw new Error("Supabase env vars missing");
    return c;
}

/**
 * Read the persisted session from localStorage. Returns null if the session
 * is missing, malformed, or has expired past the 5-second skew window.
 * @returns {VeyrnoxSession|null}
 */
export function getSession() {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s?.access_token || !s.expires_at) return null;
        if (s.expires_at * 1000 < Date.now() - 5000) return null;
        return s;
    } catch {
        return null;
    }
}
/**
 * Convenience wrapper. Returns the raw JWT string, or null if no valid
 * session. Use as: `Authorization: Bearer ${getAccessToken()}` on every
 * /api/v1/* fetch.
 * @returns {string|null}
 */
export function getAccessToken() {
    return getSession()?.access_token || null;
}
function setSession(s) {
    if (typeof localStorage === "undefined") return;
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
    for (const cb of listeners) cb(s);
}
/**
 * Subscribe to session changes (sign-in, sign-out, expiry). Fires with the
 * new session (or null) whenever setSession is called from any code path.
 * @param {(session: VeyrnoxSession|null) => void} cb
 * @returns {() => boolean} unsubscribe
 */
export function onSessionChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

async function post(path, body) {
    const { url, anonKey } = ensureCfg();
    const res = await fetch(new URL(path, url), {
        method: "POST",
        headers: { apikey: anonKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new Error(data?.error_description || data?.msg || `HTTP ${res.status}`);
        e.status = res.status;
        e.code = data?.error || data?.code;
        throw e;
    }
    return data;
}

function normalise(data) {
    const now = Math.floor(Date.now() / 1000);
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || now + (data.expires_in || 3600),
        user: data.user || null,
    };
}

/**
 * Email + password sign-in. Persists the session on success.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<VeyrnoxSession>}
 */
export async function signInWithPassword(email, password) {
    const data = await post("/auth/v1/token?grant_type=password", { email, password });
    const s = normalise(data);
    setSession(s);
    return s;
}
/**
 * Create a new account. If Supabase requires email confirmation the returned
 * session is null and needsConfirmation is true; otherwise session is set.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{session: VeyrnoxSession|null, needsConfirmation: boolean}>}
 */
export async function signUp(email, password) {
    const data = await post("/auth/v1/signup", { email, password });
    if (data?.access_token) {
        const s = normalise(data);
        setSession(s);
        return { session: s, needsConfirmation: false };
    }
    return { session: null, needsConfirmation: true };
}
/**
 * Send an email OTP / magic-link. `create_user: true` so a new address
 * signs the user up on their first click.
 * @param {string} email
 */
export async function sendMagicLink(email) {
    await post("/auth/v1/otp", { email, create_user: true });
}
/**
 * Redirect to Supabase's OAuth authorize endpoint. Provider must be one
 * enabled in the Supabase dashboard. redirectTo defaults to the app's
 * /auth/callback route.
 * @param {"apple"|"google"} provider
 * @param {string} [redirectTo]
 */
export function signInWithOAuth(provider, redirectTo) {
    const { url } = ensureCfg();
    const back = redirectTo || `${window.location.origin}/auth/callback`;
    const authorize = new URL("/auth/v1/authorize", url);
    authorize.searchParams.set("provider", provider);
    authorize.searchParams.set("redirect_to", back);
    window.location.assign(authorize.toString());
}
/**
 * Parse tokens out of a `#access_token=...` URL fragment (called by the
 * /auth/callback page). Persists the session and returns it; null when
 * the fragment doesn't carry tokens.
 * @returns {VeyrnoxSession|null}
 */
export function completeOAuthFromHash() {
    if (typeof window === "undefined") return null;
    const h = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
    if (!h) return null;
    const p = new URLSearchParams(h);
    const access_token = p.get("access_token");
    if (!access_token) return null;
    const now = Math.floor(Date.now() / 1000);
    const s = {
        access_token,
        refresh_token: p.get("refresh_token"),
        expires_at: Number(p.get("expires_at")) || now + Number(p.get("expires_in") || 3600),
        user: null,
    };
    setSession(s);
    return s;
}
/**
 * Revoke the Supabase session server-side and clear localStorage.
 * Both steps always run; server errors are swallowed so the client is
 * never wedged in a signed-in-but-can't-sign-out state.
 */
export async function signOut() {
    const s = getSession();
    if (s?.access_token) {
        const { url, anonKey } = ensureCfg();
        await fetch(new URL("/auth/v1/logout", url), {
            method: "POST",
            headers: { apikey: anonKey, Authorization: `Bearer ${s.access_token}` },
        }).catch(() => {});
    }
    setSession(null);
}
