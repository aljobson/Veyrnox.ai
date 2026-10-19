import { scrubBreadcrumb, scrubEvent } from './sentryScrub.js';

// The DSN only allows sending events, so it is public by design (like INSTAGRAM_CLIENT_ID). It lives here, not
// in wrangler.jsonc, because production is at its text-binding cap (tests/workerBindingBudget.test.mjs).
// Empty means nothing is sent. The owner fills it in by pull request once the Sentry project exists (ADR-0170).
export const SENTRY_DSN = '';

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
