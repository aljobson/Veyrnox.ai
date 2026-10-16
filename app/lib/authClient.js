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
 * Access tokens live in tab memory; refresh credentials live only in the
 * same-origin Secure HttpOnly cookie. localStorage holds display metadata,
 * never new access/refresh tokens. Product APIs remain Bearer-only.
 */

/**
 * @typedef {object} VeyrnoxSession
 * @property {string} access_token   raw Supabase JWT (ES256, forwarded as
 *                                   `Authorization: Bearer` on /api/v1/*)
 * @property {null} refresh_token  never retained in live browser sessions
 * @property {number} expires_at     unix seconds
 * @property {any|null} user         Supabase user record (may be null)
 */

import { clearJobHistory } from "../veyrnox/_lib/jobHistory.js";
import { clearChatLocal } from "../veyrnox/_lib/chatLocal.js";
import { clearFilmLocal } from "../veyrnox/_lib/filmStudioStorage.js";
import { keepOAuthVerifier, keepMagicVerifier, takeVerifier } from "./pkceVerifier.js";
import { browserSessionRequest } from './browserSessionClient.js';

const STORAGE_KEY = "veyrnox_supabase_session";
const SIGNED_OUT_KEY = 'veyrnox_session_signed_out';
// Refresh when this close to expiry (seconds). Matches the 5s server skew
// with room for a slow round trip.
const REFRESH_AHEAD_SEC = 60;
const listeners = new Set();
let refreshInFlight = null;
let memorySession = null;
// A failed storage write must not let a readable stale record override a
// completed local sign-in/logout. A later cross-tab session event resets this.
let storageFallback = false;
let sessionEpoch = 0;
let storageListenerInstalled = false;
const ADOPTED_SESSION = Symbol('adopted-browser-session');
function assertSessionEpoch(epoch) {
    if (sessionEpoch !== epoch) throw Object.assign(new Error('Your session changed. Please try again.'), { status: 409, code: 'account_changed' });
}
async function persistTokenResponse(data, epoch) {
    if (!data?.access_token || !data?.refresh_token) return data;
    assertSessionEpoch(epoch);
    return browserSessionRequest({ action: 'establish', refresh_token: data.refresh_token }, {
        beforeRequest: () => assertSessionEpoch(epoch),
        onResponse: persisted => {
            assertSessionEpoch(epoch);
            setSession(normalise(persisted));
            return { ...persisted, [ADOPTED_SESSION]: true };
        },
    });
}

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
 * Read the live memory session. A previous-release localStorage session is
 * accepted only until the next hydration migrates it. Expired tokens are null.
 * @returns {VeyrnoxSession|null}
 */
export function getSession() {
    const s = readStored();
    if (!s?.access_token) return null;
    if (s.expires_at * 1000 < Date.now() - 5000) return null;
    return s;
}
// Display metadata survives expiry; legacy credentials are migration input only.
function readStored() {
    if (storageFallback) return memorySession;
    if (typeof localStorage === "undefined") return memorySession;
    try {
        if (localStorage.getItem(SIGNED_OUT_KEY) === '1') return null;
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return memorySession;
        const s = JSON.parse(raw);
        if (!s?.expires_at) return memorySession;
        // Tokens written by the previous release are read once for migration.
        // Successful establishment replaces this record with metadata only.
        if (s.access_token) return s;
        return memorySession || (s.cookie_session ? s : null);
    } catch {
        return memorySession;
    }
}
/**
 * The stored session whether or not its access token has expired, or null when
 * signed out. A page that only shows who is signed in should read this and let
 * getFreshAccessToken() do the refresh: getSession() says null for the hour
 * between expiry and the next refresh, and a nav that read it showed "Log in"
 * to someone whose refresh token was still live in this browser (audit
 * 2026-10-09, A-03). Never use its access_token for a request.
 * @returns {VeyrnoxSession|null}
 */
export function getStoredSession() {
    return readStored();
}
/**
 * Who the stored session belongs to, or null when signed out. Unlike
 * getSession() this still answers while an expired access token waits on its
 * refresh, so per-user browser data is not dropped once an hour.
 * @returns {string|null}
 */
export function getStoredUserId() {
    const id = readStored()?.user?.id;
    return typeof id === "string" && id ? id : null;
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
 * Access token good for REFRESH_AHEAD_SEC more seconds, restored/refreshed
 * through the HttpOnly-cookie BFF. Concurrent callers share one operation.
 * Definitive rejection clears metadata; transient failures preserve it.
 * @returns {Promise<string|null>}
 */
export async function getFreshAccessToken() {
    // HttpOnly cookies cannot be deleted by JS during a network outage. Keep
    // the user's logout intent across reloads and retry deletion, never restore.
    try {
        if (logoutPending()) {
            const epoch = sessionEpoch;
            await browserSessionRequest({ action: 'clear' }, { beforeRequest: () => {
                assertSessionEpoch(epoch);
                if (!logoutPending()) throw Object.assign(new Error('session changed'), { code: 'account_changed' });
            } }).catch(() => {});
            return null;
        }
    } catch { /* blocked storage: memory state and server revocation still apply */ }
    const s = readStored();
    const now = Math.floor(Date.now() / 1000);
    if (s?.access_token && !s.refresh_token && s.expires_at - now > REFRESH_AHEAD_SEC) return s.access_token;
    if (!refreshInFlight) {
        const epoch = sessionEpoch;
        const pending = browserSessionRequest(s?.refresh_token
            ? { action: 'establish', refresh_token: s.refresh_token } : { action: 'refresh' }, {
            beforeRequest: () => assertSessionEpoch(epoch),
            onResponse: data => {
                assertSessionEpoch(epoch);
                setSession(normalise(data), { broadcast: false });
                return data;
            },
        })
            .then((data) => {
                // Signed out or switched account while this was in flight:
                // do not resurrect the old session from a stale response.
                return getSession()?.access_token === data.access_token ? data.access_token : null;
            })
            .catch((err) => {
                if (sessionEpoch !== epoch) return null;
                // Only a definitive rejection (invalid_grant: revoked, reused,
                // or unknown refresh token) ends the session. A 429 from the
                // token endpoint, network errors and 5xx are Supabase's
                // problem; keep whatever access token is still valid.
                const status = err && err.status;
                const code = err && err.code;
                if ((status === 400 || status === 401) && (code === "invalid_grant" || code === "no_session")) {
                    if (sessionEpoch === epoch && s) setSession(null);
                    return null;
                }
                return getAccessToken();
            })
            .finally(() => { if (refreshInFlight === pending) refreshInFlight = null; });
        refreshInFlight = pending;
    }
    return refreshInFlight;
}
// False once a write has failed, so the UI can explain why a sign-in will not
// survive a reload instead of silently forgetting the user.
let storagePersisted = true;
export function sessionIsPersisted() { return storagePersisted; }

function logoutPending() {
    if (storageFallback) return !memorySession;
    return typeof localStorage !== 'undefined' && localStorage.getItem(SIGNED_OUT_KEY) === '1';
}

function persistMetadata(operation) {
    try {
        operation();
        return true;
    } catch (err) {
        console.error("[auth] could not persist session metadata:", err && err.name);
        storagePersisted = false;
        return false;
    }
}

function setSession(s, { broadcast = true } = {}) {
    const previous = readStored();
    // Session ended or a different user: nothing the last one left in this
    // browser (job history, unsent chat text, starred replies) is kept.
    if (!s || readStored()?.user?.id !== s.user?.id) {
        clearJobHistory();
        if (typeof localStorage !== 'undefined') {
            clearChatLocal(localStorage);
            clearFilmLocal(localStorage);
        }
    }
    memorySession = s ? { ...s, refresh_token: null, cookie_session: true } : null;
    sessionEpoch += 1;
    refreshInFlight = null;
    // Quota/blocked storage can permit reads or removals while refusing writes.
    // Attempt each operation independently; memory remains authoritative if
    // either fails, including logout when the legacy record cannot be removed.
    let persisted = true;
    if (typeof localStorage !== 'undefined') {
        if (s) {
            persisted = persistMetadata(() => localStorage.removeItem(SIGNED_OUT_KEY));
            if (broadcast || previous?.refresh_token || !previous || storageFallback) {
                persisted = persistMetadata(() => localStorage.setItem(STORAGE_KEY, JSON.stringify({ cookie_session: true,
                    expires_at: s.expires_at, user: s.user, revision: crypto.randomUUID() }))) && persisted;
            }
        } else {
            // Removing the larger legacy record first can free enough quota for
            // the tiny marker that prevents offline logout revival on reload.
            persisted = persistMetadata(() => localStorage.removeItem(STORAGE_KEY));
            persisted = persistMetadata(() => localStorage.setItem(SIGNED_OUT_KEY, '1')) && persisted;
        }
    }
    storageFallback = !persisted;
    for (const cb of listeners) cb(memorySession);
}

/**
 * Subscribe to session changes (sign-in, sign-out, expiry). Fires with the
 * new session (or null) whenever setSession is called from any code path.
 * @param {(session: VeyrnoxSession|null) => void} cb
 * @returns {() => boolean} unsubscribe
 */
export function onSessionChange(cb) {
    listeners.add(cb);
    if (typeof window !== "undefined" && !storageListenerInstalled) {
        window.addEventListener('storage', onStorage);
        storageListenerInstalled = true;
    }
    return () => {
        listeners.delete(cb);
        if (typeof window !== "undefined" && listeners.size === 0 && storageListenerInstalled) {
            window.removeEventListener('storage', onStorage);
            storageListenerInstalled = false;
        }
    };
}
function onStorage(event) {
    if (event.key !== STORAGE_KEY && event.key !== null && !(event.key === SIGNED_OUT_KEY && event.newValue === '1')) return;
    memorySession = null;
    storageFallback = false;
    sessionEpoch += 1;
    refreshInFlight = null;
    for (const listener of listeners) listener(getStoredSession());
    if (event.key === STORAGE_KEY && event.newValue) getFreshAccessToken().catch(() => null);
}

/**
 * Authenticated call against GoTrue with the current access token. Used by
 * the MFA factor endpoints, which act on the signed-in user.
 */
async function authed(path, { method = "POST", body } = {}) {
    const { url, anonKey } = ensureCfg();
    const token = await getFreshAccessToken();
    if (!token) throw Object.assign(new Error("not signed in"), { status: 401 });
    const epoch = sessionEpoch;
    const res = await fetch(new URL(path, url), {
        method,
        headers: {
            apikey: anonKey,
            Authorization: `Bearer ${token}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const e = new Error(data?.error_description || data?.msg || `HTTP ${res.status}`);
        e.status = res.status;
        e.code = data?.error || data?.code;
        throw e;
    }
    return persistTokenResponse(data, epoch);
}

async function post(path, body) {
    const epoch = sessionEpoch;
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
    return persistTokenResponse(data, epoch);
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
 * @param {string} [captchaToken]  Turnstile token (ADR-0026)
 * @returns {Promise<VeyrnoxSession>}
 */
export async function signInWithPassword(email, password, captchaToken) {
    const data = await post("/auth/v1/token?grant_type=password", withCaptcha({ email, password }, captchaToken));
    return adoptSession(data);
}
/**
 * Create a new account. If Supabase requires email confirmation the returned
 * session is null and needsConfirmation is true; otherwise session is set.
 * @param {string} email
 * @param {string} password
 * @param {string} [captchaToken]  Turnstile token (ADR-0026)
 * @returns {Promise<{session: VeyrnoxSession|null, needsConfirmation: boolean}>}
 */
export async function signUp(email, password, captchaToken) {
    const data = await post("/auth/v1/signup", withCaptcha({ email, password }, captchaToken));
    if (data?.access_token) {
        const s = adoptSession(data);
        return { session: s, needsConfirmation: false };
    }
    return { session: null, needsConfirmation: true };
}
/**
 * Send an email OTP / magic-link. `create_user: true` so a new address
 * signs the user up on their first click.
 * @param {string} email
 * @param {string} [captchaToken]  Turnstile token (ADR-0026)
 */
export async function sendMagicLink(email, captchaToken, redirectTo) {
    const verifier = randomVerifier();
    keepMagicVerifier(verifier);
    const redirect = redirectTo || `${window.location.origin}/auth/callback`;
    await post(`/auth/v1/otp?redirect_to=${encodeURIComponent(redirect)}`, withCaptcha({
        email, create_user: true, code_challenge: await s256(verifier), code_challenge_method: 's256',
    }, captchaToken));
}

// GoTrue reads the CAPTCHA token from here when Attack Protection is on and
// ignores it when off, so it is sent whenever the widget produced one.
function withCaptcha(body, captchaToken) {
    return captchaToken ? { ...body, gotrue_meta_security: { captcha_token: captchaToken } } : body;
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
    // or attacker-planted callback URL has no verifier and fails. Where the
    // verifier is kept, and for how long, is in pkceVerifier.js.
    const verifier = randomVerifier();
    keepOAuthVerifier(verifier);
    const authorize = new URL("/auth/v1/authorize", url);
    authorize.searchParams.set("provider", provider);
    authorize.searchParams.set("redirect_to", back);
    authorize.searchParams.set("code_challenge", await s256(verifier));
    authorize.searchParams.set("code_challenge_method", "s256");
    window.location.assign(authorize.toString());
}

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
 * The error Supabase put on the callback URL when the provider or Auth config
 * refused the sign-in (e.g. `invalid_client`, `server_error`). It arrives in
 * the query or the fragment instead of `?code=`. Null when there is none.
 */
export function oauthCallbackError(href) {
    let u;
    try { u = new URL(href); } catch { return null; }
    const hash = new URLSearchParams(u.hash.replace(/^#/, ""));
    const code = u.searchParams.get("error") || hash.get("error");
    return code ? code.slice(0, 64) : null;
}

/**
 * Finish the PKCE flow on /auth/callback, for an OAuth redirect or an emailed
 * link: exchange `?code=` plus the verifier this browser stored for a
 * session. Returns null when there is no code or no usable verifier (a
 * callback this browser did not start, or a link opened after its verifier
 * expired). Never overwrites a still-valid session.
 * @returns {Promise<VeyrnoxSession|null>}
 */
export async function completeOAuthFromCode() {
    if (typeof window === "undefined") return null;
    const code = new URL(window.location.href).searchParams.get("code");
    if (!code) return null;
    const verifier = takeVerifier();
    if (!verifier) return null;
    if (getSession()) return getSession();
    const data = await post("/auth/v1/token?grant_type=pkce", { auth_code: code, code_verifier: verifier });
    return adoptSession(data);
}
/**
 * Finish a flow that returned tokens in the URL fragment (`#access_token=…`):
 * the email-confirmation link, which is sent without a PKCE challenge, and any
 * provider still on the implicit flow. The fragment never reaches a server,
 * but it stays in the tab's history and in whatever reads the URL, so it is
 * taken into the session and cleared from the address bar in the same step
 * (audit 2026-10-09, A-05). Returns null when the fragment holds no tokens.
 * Never overwrites a still-valid session; the fragment is cleared either way.
 * @returns {Promise<VeyrnoxSession|null>}
 */
export async function completeFromFragment() {
    if (typeof window === "undefined") return null;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    if (!accessToken) return null;
    const clean = new URL(window.location.href);
    clean.hash = "";
    try { window.history.replaceState(null, "", clean.toString()); } catch { /* nothing to clear from */ }
    const live = getSession();
    if (live) return live;
    const epoch = sessionEpoch;
    const expiresIn = Number(hash.get("expires_in"));
    const expiresAt = Number(hash.get("expires_at"));
    const s = normalise({
        access_token: accessToken,
        refresh_token: hash.get("refresh_token") || null,
        ...(Number.isFinite(expiresAt) && expiresAt > 0 ? { expires_at: expiresAt } : {}),
        ...(Number.isFinite(expiresIn) && expiresIn > 0 ? { expires_in: expiresIn } : {}),
    });
    // The fragment carries no user; ask who the token belongs to, so the account
    // menu has a name. A failure here leaves user null, which every reader allows.
    try {
        const { url, anonKey } = ensureCfg();
        const res = await fetch(new URL("/auth/v1/user", url), { headers: { apikey: anonKey, Authorization: `Bearer ${accessToken}` } });
        if (res.ok) s.user = await res.json();
    } catch { /* user stays null */ }
    return adoptSession(await persistTokenResponse(s, epoch));
}
/** Drop local state immediately and expire the HttpOnly credential. */
export function clearSession() {
    setSession(null);
    if (typeof window !== 'undefined') void browserSessionRequest({ action: 'clear' }).catch(() => {});
}

/**
 * Revoke this device's Supabase session server-side and clear localStorage.
 * Local state is always cleared; server errors are swallowed so the client is
 * never wedged in a signed-in-but-can't-sign-out state. /logout only accepts
 * a live access token, so an expired one is refreshed first: sent as it was,
 * the 401 was swallowed and the refresh token stayed valid at Supabase.
 * `scope=local` ends this session only, as the confirmation says; "Sign out
 * everywhere" on /app/account ends the others (accountSecurity.js).
 */
export async function signOut() {
    let token = null;
    try { token = await getFreshAccessToken(); } catch { /* still sign out here */ }
    setSession(null);
    await browserSessionRequest({ action: 'clear' }).catch(() => {});
    if (!token) return;
    const { url, anonKey } = ensureCfg();
    await fetch(new URL("/auth/v1/logout?scope=local", url), {
        method: "POST",
        headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
    }).catch(() => {});
}

// Supabase OAuth 2.1 authorization-server consent. These endpoints act on
// the signed-in resource owner; the MCP client never receives the browser's
// Veyrnox session token.
export function getOAuthAuthorizationDetails(authorizationId) {
    return authed(`/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}`, { method: 'GET' });
}

export function respondToOAuthAuthorization(authorizationId, action) {
    if (action !== 'approve' && action !== 'deny') throw new Error('invalid OAuth consent action');
    return authed(`/auth/v1/oauth/authorizations/${encodeURIComponent(authorizationId)}/consent`, {
        body: { action },
    });
}

/** List the OAuth applications this user has authorized. */
export function listOAuthGrants() {
    return authed('/auth/v1/user/oauth/grants', { method: 'GET' });
}

/** Revoke one client grant and every session/refresh token issued for it. */
export function revokeOAuthGrant(clientId) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId || '')) {
        throw new Error('invalid OAuth client id');
    }
    return authed(`/auth/v1/user/oauth/grants?client_id=${encodeURIComponent(clientId)}`, { method: 'DELETE' });
}

// ─── MFA (TOTP) ─────────────────────────────────────────────────────────────
//
// Supabase issues an aal1 token for password/OAuth and an aal2 token only
// after a factor is satisfied. middleware.js forwards the `aal` claim as
// x-veyrnox-auth-aal, and /api/v1/admin/metrics refuses anything but aal2
// once ADMIN_REQUIRE_AAL2 is on. Enrolment has to exist before that flag can
// be turned on, which is why it lives here rather than in a later phase.
//
// Supabase returns a raw SVG string, which must never be injected into the
// page. MfaPanel instead renders a QR code from this otpauth:// URI through
// React-owned SVG elements and retains the URI and secret as text fallbacks.

/** The current session's assurance level: "aal1", "aal2", or null. */
export function getAal() {
    const token = getAccessToken();
    if (!token) return null;
    try {
        const [, payload] = token.split(".");
        const json = JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/")));
        return typeof json.aal === "string" ? json.aal : null;
    } catch {
        return null;
    }
}

/** Display-only freshness. Server signature/MFA checks remain authoritative. */
export function getMfaFreshUntil(now = Date.now()) {
    const token = getAccessToken();
    if (!token) return null;
    try {
        const payload = token.split('.')[1];
        const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
        if (claims.aal !== 'aal2' || !Array.isArray(claims.amr) || !Number.isFinite(claims.exp)) return null;
        const times = claims.amr.filter((entry) => entry?.method === 'totp'
            && Number.isFinite(entry.timestamp) && entry.timestamp <= now / 1000 + 5)
            .map((entry) => entry.timestamp);
        if (!times.length) return null;
        const until = Math.min(Math.max(...times) + 300, claims.exp) * 1000;
        return until > now ? until : null;
    } catch { return null; }
}

/**
 * The signed-in user's MFA factors.
 * @returns {Promise<Array<{id: string, status: string, friendly_name?: string}>>}
 */
export async function listFactors() {
    const user = await authed("/auth/v1/user", { method: "GET" });
    return (user?.factors || []).filter((f) => f.factor_type === "totp");
}

/**
 * Begin TOTP enrolment. The factor is created `unverified` and does nothing
 * until verifyFactor succeeds with a code from the app.
 * @returns {Promise<{factorId: string, secret: string, uri: string}>}
 */
export async function enrollTotp(friendlyName = "Authenticator") {
    const data = await authed("/auth/v1/factors", {
        body: { factor_type: "totp", friendly_name: friendlyName },
    });
    return { factorId: data.id, secret: data?.totp?.secret || "", uri: data?.totp?.uri || "" };
}

/**
 * Satisfy a factor with a 6-digit code — both to finish enrolment and to step
 * an existing aal1 session up to aal2. Supabase returns a fresh token pair on
 * success, so the stored session becomes the aal2 one.
 * @param {string} factorId
 * @param {string} code
 */
export async function verifyFactor(factorId, code) {
    const challenge = await authed(`/auth/v1/factors/${encodeURIComponent(factorId)}/challenge`);
    const data = await authed(`/auth/v1/factors/${encodeURIComponent(factorId)}/verify`, {
        body: { challenge_id: challenge.id, code },
    });
    if (data?.access_token) adoptSession(data);
    return getAal();
}

/** Remove a factor. Requires an aal2 session, which Supabase enforces. */
export async function unenrollFactor(factorId) {
    await authed(`/auth/v1/factors/${encodeURIComponent(factorId)}`, { method: "DELETE" });
}

// ─── Shared with app/lib/passkeys.js ────────────────────────────────────────
//
// The passkey ceremony lives in its own file (this one is already at the
// 500-line ceiling), but it talks to the same GoTrue with the same error
// mapping and writes to the same session. Exporting the three pieces it needs
// keeps one implementation of each rather than a second copy that drifts.

export { post as gotruePost, authed as gotrueAuthed, b64url, withCaptcha };

/**
 * Take a GoTrue token response and make it the live session — same path
 * sign-in uses, so listeners fire and the gate closes.
 * @param {any} data
 * @returns {VeyrnoxSession}
 */
export function adoptSession(data) {
    if (data?.[ADOPTED_SESSION]) {
        if (memorySession?.access_token !== data.access_token) {
            throw Object.assign(new Error('Your session changed. Please try again.'), { status: 409, code: 'account_changed' });
        }
        return memorySession;
    }
    const s = normalise(data);
    setSession(s);
    return memorySession;
}
