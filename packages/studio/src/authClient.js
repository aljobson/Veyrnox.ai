"use client";

/**
 * Browser-side Supabase client — singleton.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at
 * bundle time. The anon key is safe to ship in the client bundle
 * (that's what it's for) — never ship SUPABASE_SERVICE_ROLE_KEY here.
 *
 * The client sets an `sb-<project-ref>-auth-token` cookie on successful
 * sign-in, which middleware.js at the app root reads to verify JWTs
 * on /api/v1/* requests. Same-origin only — Veyrnox and the gateway
 * live at the same host.
 *
 * @supabase/supabase-js is client-side only in this codebase. Do NOT
 * import from middleware.js or app/api/*/route.js — those still use
 * plain-fetch PostgREST via packages/db/supabase-client.js.
 */

import { createClient } from "@supabase/supabase-js";

let cached = null;

export function getSupabase() {
    if (cached) return cached;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
    }
    cached = createClient(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            // Storage: default localStorage is fine — the cookie the
            // middleware reads is set separately by supabase-js when it
            // detects an SSR/browser hybrid. In pure client-only mode we
            // still hit the middleware via same-origin fetch because the
            // supabase-js client also mirrors the session into a cookie
            // named `sb-<ref>-auth-token` on sign-in.
            flowType: "pkce",
        },
    });
    return cached;
}
