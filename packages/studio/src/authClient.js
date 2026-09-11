"use client";

/**
 * Browser-side Supabase auth via plain fetch — no library dep.
 *
 * @supabase/supabase-js kept getting pulled into the Cloudflare
 * Workers bundle even under "use client" + dynamic import (bisected
 * on PR #38: root dep, workspace dep, and dynamic import all failed
 * Workers Builds). Same failure class as Slice 1 tsx and Slice 3b
 * jose — heavy libraries land on the SSR/Worker path regardless of
 * import strategy in this stack.
 *
 * The Supabase REST endpoints under /auth/v1/* handle everything
 * we need — sign in, sign up, magic link — in ~200 lines. Sessions
 * are stored in localStorage and sent as `Authorization: Bearer`
 * on every /api/v1/* call. `middleware.js` reads the Bearer header
 * first (before the cookie fallback), so the flow works end-to-end.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at
 * bundle time. Anon key is safe to ship; never mirror SERVICE_ROLE
 * or JWT_SECRET into NEXT_PUBLIC_*.
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
    if (!c.url || !c.anonKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
    }
    return c;
}

/** @returns {{access_token, refresh_token, expires_at, user} | null} */
export function getSession() {
    if (typeof localStorage === "undefined") return null;
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || !s.access_token || !s.expires_at) return null;
        if (s.expires_at * 1000 < Date.now() - 5_000) return null;
        return s;
    } catch {
        return null;
    }
}

function setSession(session) {
    if (typeof localStorage === "undefined") return;
    if (session) localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    else localStorage.removeItem(STORAGE_KEY);
    for (const cb of listeners) cb(session);
}

/** Subscribe to session changes. Returns an unsubscribe fn. */
export function onSessionChange(cb) {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

async function post(path, body, extraHeaders = {}) {
    const { url, anonKey } = ensureCfg();
    const res = await fetch(new URL(path, url), {
        method: "POST",
        headers: {
            apikey: anonKey,
            "Content-Type": "application/json",
            ...extraHeaders,
        },
        body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data?.error_description || data?.msg || `HTTP ${res.status}`);
        err.status = res.status;
        err.code = data?.error || data?.code;
        throw err;
    }
    return data;
}

/** Email + password sign-in. Returns session or throws. */
export async function signInWithPassword(email, password) {
    const data = await post(`/auth/v1/token?grant_type=password`, { email, password });
    const session = normaliseSession(data);
    setSession(session);
    return session;
}

/** Email + password sign-up. Depending on project settings the user may
 *  need to confirm via email before a session is returned. */
export async function signUp(email, password) {
    const data = await post(`/auth/v1/signup`, { email, password });
    if (data && data.access_token) {
        const session = normaliseSession(data);
        setSession(session);
        return { session, needsConfirmation: false };
    }
    return { session: null, needsConfirmation: true };
}

/** Passwordless email — Supabase sends a magic link that redirects
 *  back to the app with a session token. Requires the redirect URL
 *  to be allow-listed in the Supabase project's Auth settings. */
export async function sendMagicLink(email) {
    await post(`/auth/v1/otp`, { email, create_user: true });
}

/** Sign out — invalidates the refresh token server-side and clears
 *  the local session. */
export async function signOut() {
    const session = getSession();
    if (session?.access_token) {
        const { url, anonKey } = ensureCfg();
        await fetch(new URL(`/auth/v1/logout`, url), {
            method: "POST",
            headers: {
                apikey: anonKey,
                Authorization: `Bearer ${session.access_token}`,
            },
        }).catch(() => { /* server-side revoke is best-effort */ });
    }
    setSession(null);
}

/** Get the current session's access token, or null. Used by
 *  gatewayClient.js to add the Bearer header. */
export function getAccessToken() {
    return getSession()?.access_token || null;
}

function normaliseSession(data) {
    // Supabase's token endpoints return { access_token, refresh_token, expires_in, expires_at?, user }.
    const now = Math.floor(Date.now() / 1000);
    return {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_at: data.expires_at || now + (data.expires_in || 3600),
        user: data.user || null,
    };
}
