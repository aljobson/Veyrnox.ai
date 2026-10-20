import { scrubBreadcrumb, scrubEvent } from './sentryScrub.js';

// The DSN only allows sending events, so it is public by design (like INSTAGRAM_CLIENT_ID). It lives here, not
// in wrangler.jsonc, because production is at its text-binding cap (tests/workerBindingBudget.test.mjs).
// Empty means nothing is sent. Set 2026-10-20 to the veyrnox-worker project (ADR-0170); set it back to '' to turn reporting off.
export const SENTRY_DSN = 'https://79d559290cf27c7d775c351a985e8e1c@o4512286770855936.ingest.de.sentry.io/4512286859460688';

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
