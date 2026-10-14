// Publish controls share one binding to stay within Cloudflare's 128 text-binding limit.
const KEYS = Object.freeze({
    PUBLISH_PLANS_ENABLED: 'plans',
    PUBLISH_VIDEO_DESTINATIONS_ENABLED: 'videoDestinations',
    PUBLISH_INBOX_ENABLED: 'inbox',
});

export function publishRuntimeFeatureEnabled(name, env = process.env) {
    if (!Object.hasOwn(KEYS, name) || !env || typeof env !== 'object') return false;
    // Retain the individual variables for local tests and emergency rollback.
    if (Object.hasOwn(env, name)) return env[name] === 'true';
    const raw = env.PUBLISH_RUNTIME_FLAGS;
    if (typeof raw !== 'string' || raw.length > 1024) return false;
    try {
        const flags = JSON.parse(raw);
        if (!flags || typeof flags !== 'object' || Array.isArray(flags) ||
            Object.keys(flags).some((key) => !Object.values(KEYS).includes(key) || !['true', 'false'].includes(flags[key]))) return false;
        return flags[KEYS[name]] === 'true';
    } catch { return false; }
}
