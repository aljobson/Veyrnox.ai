// Provider consent controls share one binding to stay within Cloudflare's
// 128 text-binding limit. Individual variables remain valid for local tests
// and emergency rollback, and take precedence when explicitly present.
const KEYS = Object.freeze({
    INSTAGRAM_INSIGHTS_SCOPE_ENABLED: 'instagramInsights',
    INSTAGRAM_ENGAGEMENT_SCOPE_ENABLED: 'instagramEngagement',
    FACEBOOK_ENGAGEMENT_SCOPE_ENABLED: 'facebookEngagement',
    TIKTOK_ANALYTICS_SCOPE_ENABLED: 'tiktokAnalytics',
});

export function publishScopeFeatureEnabled(name, env = process.env) {
    if (!Object.hasOwn(KEYS, name) || !env || typeof env !== 'object') return false;
    if (Object.hasOwn(env, name)) return env[name] === 'true';
    const raw = env.PUBLISH_SCOPE_FLAGS;
    if (typeof raw !== 'string' || raw.length > 512) return false;
    try {
        const flags = JSON.parse(raw);
        if (!flags || typeof flags !== 'object' || Array.isArray(flags) ||
            Object.keys(flags).some((key) => !Object.values(KEYS).includes(key) || !['true', 'false'].includes(flags[key]))) return false;
        return flags[KEYS[name]] === 'true';
    } catch { return false; }
}
