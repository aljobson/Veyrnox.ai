/** Approved AI project identities. The separate wallet projects are never valid here. */
export const AI_ENVIRONMENTS = Object.freeze({
    // oauthProviders: the "Continue with ..." buttons the sign-in dialog shows
    // in this environment (components/AuthGate.jsx). The live Supabase setting
    // can still hide one that has been switched off; a failed read of it no
    // longer hides them all. scripts/check-auth-providers.mjs checks
    // production's live setting against this list every hour.
    staging: Object.freeze({
        supabaseUrl: 'https://yrqzwqywxfesmbvhzjgj.supabase.co',
        publishableKey: 'sb_publishable_bAxQiodzBhI6bV7lmo9gMQ_Hlg9_Ish',
        // Apple is not configured on the staging project (2026-10-02).
        oauthProviders: Object.freeze(['google']),
    }),
    production: Object.freeze({
        supabaseUrl: 'https://xdxdzmsztyzbnzeforxx.supabase.co',
        publishableKey: 'sb_publishable_HwEQqi6FXJOmWpy5eqR9-A_Zvy8_ii1',
        oauthProviders: Object.freeze(['apple', 'google']),
    }),
});

/** Sign-in providers for a build environment; local development has none. */
export function oauthProvidersFor(appEnv) {
    const env = AI_ENVIRONMENTS[appEnv];
    return env ? [...env.oauthProviders] : [];
}
