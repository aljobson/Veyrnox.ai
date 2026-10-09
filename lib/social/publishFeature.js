/**
 * Veyrnox Publish rollout switch (docs/product/ISSUES.md P1).
 *
 * Server-side only: only the exact string "true" in PUBLISH_ENABLED opens
 * public access. A configured tester allowlist can open HTML shells while
 * every social API still requires a verified, allowed JWT subject. Read per
 * request; a deployment's vars can change without a rebuild. The cron sweep
 * is deliberately not gated, so anything already queued still finishes.
 *
 * @param {Record<string, string | undefined>} [env]
 * @returns {boolean}
 */
export function publishEnabled(env = process.env) {
    return env.PUBLISH_ENABLED === 'true';
}

/** @param {string} pathname */
export function isPublishApiPath(pathname) {
    return pathname === '/api/v1/social' || pathname.startsWith('/api/v1/social/');
}

/** Weekly posting insights remain off until migration 0191 is applied. */
export function postingInsightsEnabled(env = process.env) {
    return env.PUBLISH_POSTING_INSIGHTS_ENABLED === 'true';
}

/** Calendar reads and rescheduling require migration 0192. */
export function calendarEnabled(env = process.env) {
    return env.PUBLISH_CALENDAR_ENABLED === 'true';
}

const AUTH_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function testerIds(env) {
    return (env.PUBLISH_TESTER_AUTH_IDS || '').split(',').map((id) => id.trim().toLowerCase()).filter((id) => AUTH_ID.test(id));
}

/** Shells contain no account data; every API still requires verified tester identity. */
export function publishShellAvailable(env = process.env) {
    return publishEnabled(env) || testerIds(env).length > 0;
}

export function publishAllowed(authId, env = process.env) {
    return publishEnabled(env) || (typeof authId === 'string' && AUTH_ID.test(authId) && testerIds(env).includes(authId.toLowerCase()));
}

/** Enable only after the visibility RPC migration is applied. */
export function youtubeVisibilityEnabled(env = process.env) {
    return env.PUBLISH_YOUTUBE_VISIBILITY_ENABLED === 'true';
}
