/** Approved AI project identities. The separate wallet projects are never valid here. */
export const AI_ENVIRONMENTS = Object.freeze({
    // oauthProviders: the "Continue with ..." buttons the sign-in dialog shows
    // in this environment (components/AuthGate.jsx), an upper bound: the live
    // Supabase setting can hide one that is switched off, and turning a new
    // one on takes a change here and a deploy. A failed read of the setting no
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
        // The Sign in with Apple client secret (a JWT signed with the .p8
        // key, ADR-0030) stops working on this date and nothing live reports
        // it: /auth/v1/settings still says apple:true. The hourly check warns
        // 30 days ahead. Update this on every rotation.
        appleSecretExpiresOn: '2027-03-24',
    }),
});

/**
 * Sign-in providers for a build environment; local development has none.
 * @param {string} appEnv
 * @returns {string[]}
 */
export function oauthProvidersFor(appEnv) {
    if (appEnv === 'production' || appEnv === 'staging') return [...AI_ENVIRONMENTS[appEnv].oauthProviders];
    return [];
}
