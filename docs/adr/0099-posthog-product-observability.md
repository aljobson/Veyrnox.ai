# ADR-0099 — Consent-first PostHog product observability

- Status: Active 2026-10-15.
- Date: 2026-10-14
- Related: [ADR-0060](0060-csp-rendering-decision.md) (nonce CSP), [ADR-0016](0016-data-residency-claim-correction.md) (residency claims), [Privacy Policy](/legal/privacy).

## Context

Veyrnox has Cloudflare request logs and domain-specific recovery checks, but no joined view of page journeys, browser failures, performance or the interaction immediately before a UI bug. That leaves product questions and browser-only defects to anecdote. Session replay is useful for the latter, but the product contains prompts, chat text, private media, credentials and payment/account screens; recording the DOM without a deliberately narrow policy is unacceptable.

## Decision

Use PostHog Cloud EU for product analytics, browser and Next.js request-error tracking, Web Vitals and sampled session replay, with these boundaries:

1. Collection is off by default. A visitor can allow analytics with replay, analytics without replay, or decline. The choice remains available through a persistent Privacy choices control. Necessary sign-in and preference storage remains independent.
2. Browser traffic uses the same-origin `/ingest` proxy. The CSP admits no PostHog script or connection origin; only the replay blob worker is added. The proxy is a 404 while no valid project token is configured and never seeds identity before consent.
3. Page events contain the path only. Query strings and fragments are removed from every known URL property; autocapture stores no DOM text or attributes and is limited to links, buttons and forms.
4. Replay sampling is controlled by a build-time public value bounded from 0% to 100%; production is temporarily set to 100% for deterministic validation and explicitly overrides PostHog's sampling control at that value. Replay still requires separate consent. It masks all text and inputs, blocks images, video, audio, canvas and iframes, and captures no console output, request/response body or headers. Sign-in, account, administrator, payment and social OAuth callback routes never record.
5. A signed-in person is identified by the existing opaque Supabase user id only. Email and profile fields are not sent. Sign-out and account switching reset the PostHog identity before another person can be identified on the same browser.
6. Browser unhandled errors, rejected promises, caught gateway network/5xx failures and Next.js request errors are captured only after analytics consent. Server error messages and causes are replaced before delivery; stack locations and the framework error digest remain for grouping and source maps.
7. Production browser source maps upload only when the build has both a narrow PostHog personal key and project id. Maps are deleted from build output after upload. The personal key is never exposed as `NEXT_PUBLIC_*` or bound to the Worker.
8. No production key is committed. Removing `NEXT_PUBLIC_POSTHOG_KEY` is the collection kill switch and also removes the consent panel and closes `/ingest`.

## Consequences

- Funnels, page use, rage/dead interactions, Web Vitals, linked replay and error groups can be investigated in one system.
- Replay is intentionally less visually faithful: all text and user media are absent. That trade-off is preferable to sending creative or account content.
- Analytics cannot attribute campaigns from URL parameters because campaign and referrer persistence is disabled.
- PostHog becomes a consented subprocessor and is named in the privacy notice. The EU project, retention, access and deletion settings are activation gates, documented in `docs/operations/posthog.md`.
- Replay sampling remains explicit in deployment configuration and defaults to 20% when unset. Production can be reduced after validation without weakening consent, masking or route exclusions. Lower dashboard-side sampling still applies.

## Verification

- `tests/analyticsPrivacy.test.mjs` pins URL redaction, replay route exclusions, consent invariants and low-cardinality gateway paths.
- `tests/posthogProxy.test.mjs` pins the closed-off state and EU-only rewrite.
- `tests/securityHeaders.test.mjs` pins the blob-worker CSP without admitting a remote PostHog origin.
- Reticle verifies the visible consent choices and the persistent Privacy choices control in the running app.
