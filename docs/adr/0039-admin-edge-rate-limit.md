# ADR-0039 — Screen external admin traffic before the app handler

- Status: Proposed; activates with the Worker deployment, no SQL migration.
- Date: 2026-09-24
- Related: audit admin rate limits, Cloudflare Access and admin MFA

## Problem

The two machine-admin endpoints use Access assertions, secret comparison and
an isolate-local failed-auth throttle. The user-admin metrics endpoint verifies
Supabase JWTs, requires configured MFA, and checks admin status in the database.
None has a cross-isolate request limit before authentication work. Requests
with valid credentials can also repeat costly operations without that throttle.

## Decision

Add a Cloudflare Workers Rate Limiting binding to the outer fetch handler.
Screen /api/admin and /api/v1/admin, including descendants, before OpenNext.
Share 60 requests per 60 seconds per connecting IP across these paths and all
methods. Use only CF-Connecting-IP, never client identity headers, authorization,
query parameters or X-Forwarded-For. Missing/malformed addresses share a fallback
bucket; absence of CF-Ray never bypasses this gate. Encoded segments, repeated
slashes and dot segments are normalized for classification only.

IP screening is deliberate here: identity has not been verified yet, and these
are low-volume administrative paths. Administrators behind one NAT share quota;
changing credentials or the path cannot evade it. It is not used on normal
customer routes, Stripe/provider webhooks, assets or marketing pages. No secret,
address or token is logged. Namespace 2026092401 and an app-specific key prefix
separate this state from other rate-limit bindings.

Denied traffic returns typed 429, conservative Retry-After: 60 and no-store.
Missing, throwing or malformed bindings fail closed with typed 503 and a
30-second retry hint. Responses carry the security headers normally provided
by the app, since early responses never reach Next's header handling. Allowed
requests reach the existing Access/JWT/MFA/secret/admin checks unchanged.
The request body is not read or buffered by the limiter.

Scheduled tasks still call the generated app handler directly. In particular,
runScheduledBackfill keeps its bearer check but never spends the external IP
bucket. External callers cannot select this internal invocation path with a
header, method, query parameter or missing CF-Ray.

## Limits and rollout

[Cloudflare's rate-limit binding documentation](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/)
describes per-location, permissive and eventually consistent counters. This is
traffic screening, not an exact global quota. Many IPs/locations can exceed an
aggregate limit; proxy/subrequest arrangements can affect the connecting IP.
The returned retry hint is conservative, not a binding-provided reset timestamp.

This PR does not create a zone WAF rule or prevent Worker invocation costs. The
original pre-Worker WAF proposal remains separate operational work. Access and
all application authorization checks remain required. Do not claim this closes
all edge-abuse risk or replaces the exact per-account Postgres quotas.

Deploy code and binding together through the existing main workflow. No new
browser path or database change is introduced. Missing configuration fails
closed only on admin endpoints, while scheduled recovery continues. Roll back
the Worker deployment as a unit; do not remove the binding from active code.

## Verification

Test blocking before app/body work, both admin namespaces, encoded/normalized
paths, allowed-request forwarding, missing/malformed/failing bindings, stable
keys despite spoofed identity headers, independent IPs, fallback behavior and
unaffected public/customer/webhook paths. Exercise worker wiring with a mocked
generated handler and prove the scheduled backfill still calls that handler
without touching the limiter. Validate the binding against Wrangler and test
its real local implementation; CI and Cloudflare preview verify bundling.
