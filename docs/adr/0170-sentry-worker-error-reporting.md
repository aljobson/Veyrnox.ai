# ADR-0170: Sentry error reporting for the Worker

**Status:** Proposed 2026-10-19. DSN for the `veyrnox-worker` project committed 2026-10-20; reporting is on.

## Context

The phone app already reports crashes to Sentry (ADR-0106). The website has PostHog request-error capture
(ADR-0099), which is consent-gated for the browser and gives no alerting on Worker failures, cron tasks or
unhandled exceptions. Production is at its Cloudflare text-binding cap, so a new var or secret needs one swapped out.

## Decision

- `@sentry/cloudflare` (pinned) wraps the Worker's default export, in the new `worker-entry.js` (wrangler `main`), with `Sentry.withSentry`; `worker.js` stays the plain handler its tests call. This
  covers `fetch` and `scheduled`. Sentry's own `@sentry/nextjs` is **not** added: it needs `withSentryConfig` around
  a `next.config.mjs` that already carries PostHog and Reticle wrappers, and adds browser code, CSP hosts and consent
  work this ADR does not take on.
- Server-side Next errors reach Sentry through the existing `onRequestError` in `instrumentation.js`, after the
  same sanitising PostHog gets (message replaced, stack frames kept). `worker-entry.js` sets
  `globalThis.__veyrnoxCaptureException`; instrumentation.js cannot import the SDK because webpack bundles it for
  runtimes without `node:url`.
- The DSN is public (it only allows sending). It is a constant in `lib/sentryConfig.js`, set to the `veyrnox-worker`
  project, so there is no binding. Empty turns reporting off.
- Errors only: `tracesSampleRate` 0, `sendDefaultPii` false. `lib/sentryScrub.js` runs on every event and
  breadcrumb: no user, extra, request headers, cookies, body or query; exception messages become
  "Server request failed"; console breadcrumbs keep no text.
- **No browser SDK, no CSP change, no tunnel.** Browser errors stay with PostHog (consent-gated).

## Consequences

- Sentry becomes a data processor for stack traces and route paths. Add it to the privacy policy before the DSN lands.
- Source maps are not uploaded yet, so frames are bundled-code locations until a later change adds upload.
- A broken Sentry import would break the Worker build: verify with `npm run build:worker` and a staging deploy.
- Rollback: set `SENTRY_DSN` back to `''`.
