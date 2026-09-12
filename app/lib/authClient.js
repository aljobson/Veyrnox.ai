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
 * middleware.js reads Bearer first. Access tokens live ~1h; gatewayFetch
 * calls getFreshAccessToken(), which swaps the refresh token for a new
 * pair shortly before expiry so a working session never dies mid-task.
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
// Refresh when this close to expiry (seconds). Matches the 5s server skew
// with room for a slow round trip.
const REFRESH_AHEAD_SEC = 60;
const listeners = new Set();
let refreshInFlight = null;

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
    const s = readStored();
    if (!s) return null;
    if (s.expires_at * 1000 < Date.now() - 5000) return null;
    return s;
}
// Stored session regardless of expiry — refresh needs the refresh_token
// of an already-expired access token.
function readStored() {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s?.access_token || !s.expires_at) return null;
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
/**
 * Access token that is good for at least REFRESH_AHEAD_SEC more seconds,
 * refreshing via the Supabase refresh grant when needed. Concurrent callers
 * share one in-flight refresh. Resolves null (and clears the session) when
 * there is nothing to refresh with or the refresh is rejected.
 * @returns {Promise<string|null>}
 */
export async function getFreshAccessToken() {
    const s = readStored();
    if (!s) return null;
    const now = Math.floor(Date.now() / 1000);
    if (s.expires_at - now > REFRESH_AHEAD_SEC) return s.access_token;
    if (!s.refresh_token) return getAccessToken();
    if (!refreshInFlight) {
        const startedWith = s.refresh_token;
        refreshInFlight = post("/auth/v1/token?grant_type=refresh_token", { refresh_token: startedWith })
            .then((data) => {
                // Signed out or switched account while this was in flight:
                // do not resurrect the old session from a stale response.
                const current = readStored();
                if (!current || current.refresh_token !== startedWith) return null;
                const next = normalise(data);
                setSession(next);
                return next.access_token;
            })
            .catch((err) => {
                // Only a definitive rejection (invalid_grant: revoked, reused,
                // or unknown refresh token) ends the session. A 429 from the
                // token endpoint, network errors and 5xx are Supabase's
                // problem; keep whatever access token is still valid.
                const status = err && err.status;
                const code = err && err.code;
                if ((status === 400 || status === 401) && (code === "invalid_grant" || code === "refresh_token_not_found")) {
                    setSession(null);
                    return null;
                }
                return getAccessToken();
            })
            .finally(() => { refreshInFlight = null; });
    }
    return refreshInFlight;
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
export async function signInWithOAuth(provider, redirectTo) {
    const { url } = ensureCfg();
    const back = redirectTo || `${window.location.origin}/auth/callback`;
    // PKCE: the callback carries a one-time `code` that only this browser
    // can exchange, because only this browser holds the verifier. A pasted
    // or attacker-planted callback URL has no verifier and fails.
    const verifier = randomVerifier();
    sessionStorage.setItem(PKCE_KEY, verifier);
    const authorize = new URL("/auth/v1/authorize", url);
    authorize.searchParams.set("provider", provider);
    authorize.searchParams.set("redirect_to", back);
    authorize.searchParams.set("code_challenge", await s256(verifier));
    authorize.searchParams.set("code_challenge_method", "s256");
    window.location.assign(authorize.toString());
}

const PKCE_KEY = "veyrnox_pkce_verifier";

function randomVerifier() {
    const bytes = new Uint8Array(32);
    crypto.getRandomValues(bytes);
    return b64url(bytes);
}
async function s256(input) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
    return b64url(new Uint8Array(digest));
}
function b64url(bytes) {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/**
 * Finish the PKCE flow on /auth/callback: exchange `?code=` plus the
 * verifier this browser stored for a session. Returns null when there is
 * no code or no verifier (a callback this browser did not start). Never
 * overwrites a still-valid session.
 * @returns {Promise<VeyrnoxSession|null>}
 */
export async function completeOAuthFromCode() {
    if (typeof window === "undefined") return null;
    const code = new URL(window.location.href).searchParams.get("code");
    if (!code) return null;
    const verifier = sessionStorage.getItem(PKCE_KEY);
    sessionStorage.removeItem(PKCE_KEY);
    if (!verifier) return null;
    if (getSession()) return getSession();
    const data = await post("/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
    const s = normalise(data);
    setSession(s);
    return s;
}
/**
 * Revoke the Supabase session server-side and clear localStorage.
 * Both steps always run; server errors are swallowed so the client is
 * never wedged in a signed-in-but-can't-sign-out state.
 */
/** Drop the local session without a server round-trip (gateway said 401). */
export function clearSession() {
    setSession(null);
}

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
