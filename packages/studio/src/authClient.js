"use client";

/**
 * Browser-side Supabase client — singleton, dynamically loaded.
 *
 * `@supabase/supabase-js` is heavy and, even under "use client", Next's
 * SSR pass on Cloudflare Workers ends up pulling it into the Worker
 * bundle when imported statically. Dynamic import + ssr:false on
 * AuthGate keeps it browser-only.
 *
 * Reads NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_ANON_KEY at
 * bundle time. Anon key is safe to ship — SUPABASE_SERVICE_ROLE_KEY
 * and SUPABASE_JWT_SECRET must NEVER be mirrored to NEXT_PUBLIC_*.
 */

let cached = null;

export async function getSupabase() {
    if (cached) return cached;
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
        throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set");
    }
    // Dynamic import — never on the SSR/Worker bundle path. This runs
    // only inside a "use client" component, on first user interaction
    // with sign-in.
    const { createClient } = await import("@supabase/supabase-js");
    cached = createClient(url, anonKey, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true,
            flowType: "pkce",
        },
    });
    return cached;
}
