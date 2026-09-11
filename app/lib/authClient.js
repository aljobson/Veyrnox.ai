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
export function getAccessToken() {
    return getSession()?.access_token || null;
}
function setSession(s) {
    if (typeof localStorage === "undefined") return;
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
    for (const cb of listeners) cb(s);
}
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

export async function signInWithPassword(email, password) {
    const data = await post("/auth/v1/token?grant_type=password", { email, password });
    const s = normalise(data);
    setSession(s);
    return s;
}
export async function signUp(email, password) {
    const data = await post("/auth/v1/signup", { email, password });
    if (data?.access_token) {
        const s = normalise(data);
        setSession(s);
        return { session: s, needsConfirmation: false };
    }
    return { session: null, needsConfirmation: true };
}
export async function sendMagicLink(email) {
    await post("/auth/v1/otp", { email, create_user: true });
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
