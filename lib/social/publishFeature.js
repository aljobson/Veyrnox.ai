/**
 * Veyrnox Publish rollout switch (docs/product/ISSUES.md P1).
 *
 * Server-side only: only the exact string "true" in PUBLISH_ENABLED opens
 * the page, the account-menu link and every /api/v1/social route. Read per
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
