import { scrubBreadcrumb, scrubEvent } from './sentryScrub.js';

// The DSN only allows sending events, so it is public by design (like INSTAGRAM_CLIENT_ID). It lives here, not
// in wrangler.jsonc, because production is at its text-binding cap (tests/workerBindingBudget.test.mjs).
// Empty means nothing is sent. Set 2026-10-20 (ADR-0170); to turn reporting off, set it back to ''.
export const SENTRY_DSN = 'https://bcf2fade1e4579597a5b1be3f088fc65@o4512286770855936.ingest.de.sentry.io/4512286817976400';

/**
 * Options for Sentry.withSentry. Errors only: no tracing, no default PII, and every event passes the scrubber.
 * @param {Record<string, any>} env
 */
export function sentryOptions(env) {
    return {
        dsn: SENTRY_DSN || undefined,
        environment: env?.APP_ENV || 'production',
        sendDefaultPii: false,
        tracesSampleRate: 0,
        beforeSend: (event) => scrubEvent(event),
        beforeBreadcrumb: (crumb) => scrubBreadcrumb(crumb),
    };
}
