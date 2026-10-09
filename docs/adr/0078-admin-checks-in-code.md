# ADR-0078 — Admin checks that hold whichever way a request arrives

- Status: Proposed 2026-10-09; built in the same change. Takes effect with the Worker deployment. No SQL migration, no feature flag. Owner sign-off is not yet recorded.
- Date: 2026-10-09
- Related: [ADR-0039](0039-admin-edge-rate-limit.md) (admin edge rate limit), [ADR-0049](0049-cinema-creator-onboarding.md) and [ADR-0059](0059-cinema-publication.md) (Cinema administrator routes, which already verify the assertion in code), [ADR-0060](0060-csp-rendering-decision.md) (the middleware's page branch). Follows the 2026-10-09 audit; the report is kept out of this repository.

## Problem

Two controls on the admin surface lived in one layer each.

**Cloudflare Access.** One Access application covers `/app/admin`, `/api/v1/admin/*` and `/api/admin/*`. It is an edge rule: it applies to one hostname and to the path that was asked for. It says nothing about a request that reaches the same Worker under another hostname, or under a path the framework maps onto an admin route afterwards. The machine endpoints and the Cinema administrator routes verify the Access assertion in code. The three dashboard routes (`metrics`, `violations`, `users/lookup`) did not: the edge rule was their only Access check, with the Supabase token, the second factor and `users.is_admin` behind it.

**Identity headers.** `middleware.js` removed inbound `x-veyrnox-*` headers by deleting them, then set the ones it had a value for. Next's own router applies a middleware's deletions. OpenNext, which production runs on, forwards the headers the middleware set on top of the caller's own and does not apply a deletion. `x-veyrnox-auth-id` was always set, so who the caller is was never in question. The other four were set only when the token carried the claim, so their absence depended on the deletion.

## Decision

1. **The dashboard routes verify the Access assertion in code.** `requireDashboardAccess` in `lib/accessJwt.js` runs after the identity and second-factor gates and before anything reaches Supabase.
   - Access configured (`ACCESS_TEAM_DOMAIN` and `ACCESS_AUD`, set for both deployed Workers): a valid assertion or `403 access_required`. There is no exemption for a request without `cf-ray`. A key set that cannot be fetched also answers 403, never 500.
   - Access not configured: a request that came through the edge answers `503 access_not_configured`. One that did not is local development or a unit test, and passes.
   - `requireAccess`, which the two machine endpoints call, is unchanged. Its exemption for the Worker's own cron call stays, because that call still has to present the endpoint's token.
2. **`worker.js` answers `/_next/data/*` with 404** before the rate limiter and the framework. That prefix belongs to the pages router and the app has none (`tests/nextDataGuard.test.mjs` fails if a `pages/` directory appears). The path is tested as sent and as normalised. A refusal whose path names an API route is logged, without the path; the rest are not, so a crawler cannot fill the log.
3. **The production Worker answers on its custom domain only.** `workers_dev` and `preview_urls` are `false` in `wrangler.jsonc`. Both keys are inherited by environments, so staging sets `workers_dev: true`: it has no custom domain. Preview URLs are off on staging too.
4. **Every identity header is set on every request.** The middleware sets all five to `''` on both branches, then to the verified value. The assurance level is forwarded as `aal2` or `aal1` and nothing else. `stripContext` blanks any other `x-veyrnox-*` name the caller sent instead of deleting it. Handlers read `''` as absent, and may read only the five names the middleware sets; a test scans `app/`, `lib/` and `packages/` for any other.

## Consequences

- An administrator who reaches the dashboard through the site sees no change: the edge already adds the assertion on those paths. Staging is covered the same way; Access already sits in front of `/app/admin` and `/api/v1/admin/*` on the staging hostname (checked 2026-10-09).
- `next dev` has no Access values and no edge, so the dashboard works locally as before. `wrangler dev` loads the Access values from `wrangler.jsonc`, so the dashboard routes answer 403 there, as the Cinema administrator routes already do.
- Removing either Access value from a deployed Worker closes the dashboard routes (503) instead of opening them.
- Workers Builds still uploads a version for every branch, but no preview URL is issued for it. Nothing in this repository uses one. A branch is looked at by deploying it to staging.
- The workers.dev and preview settings are not part of a Worker version. A rollback restores the code, not these two settings; to bring either back, set the key and deploy.
- One RS256 verification is added to each dashboard request. The Access key set is cached for an hour.
- A handler can no longer tell "the client sent nothing" from "the middleware blanked it". No handler relied on the difference.

## Verification

- `tests/adminDashboardAccess.test.mjs`: each dashboard route, with no assertion, seven kinds of invalid assertion, an unreachable key set, a valid assertion, and Access unconfigured. It also walks `app/api/v1/admin` and fails for any route that has no in-code Access check, so a new admin route cannot ship without one.
- `tests/nextDataGuard.test.mjs`: the prefix and its other spellings answer 404 before the rate limiter and the app; static assets and ordinary paths pass through.
- `tests/identityHeaders.test.mjs`: builds the forwarded request the way OpenNext does (`{ ...inbound, ...set }`) and shows that nothing a client sent in an identity header reaches a handler, on the page branch and the API branch; then calls the handlers that read those headers.

## Owner checks

Neither is visible from this repository.

1. After the deploy, the `veyrnox-ai` Worker's settings show the workers.dev route and Preview URLs as disabled, and `https://veyrnox.ai` still serves.
2. Whether anyone was opening preview URLs for the production Worker. If so, set `preview_urls` back to `true` only together with an Access policy on those hostnames.

## Amendment 1 2026-10-09: the framework's internal request headers are removed at the Worker

A review of the change above found one more place where the request the middleware is meant to see is decided by the caller. It predates this ADR.

**Problem.** OpenNext's routing layer reads a few request headers as its own instructions, and reads them from any request:

- `x-isr` with `x-prerender-revalidate` is what its revalidation queue sends to mark a request as the framework's own, and such a request is not routed the way a client's is. The value the pair must carry is fixed at build time and no leak of it is known. The gate on `/api/v1` should not rest on that value staying private.
- `x-open-next-city`, `-country`, `-region`, `-latitude` and `-longitude` carry the geolocation it derives from `request.cf`, and it copies them to the matching `x-vercel-ip-*` names. Where Cloudflare supplied none, a value sent by the client was used instead, and a malformed city made the routing layer answer 500 before the middleware ran.

**Decision.** `dropInternalHeaders` in `lib/internalRequestHeaders.js` removes `x-isr`, `x-prerender-revalidate`, `x-prerender-revalidate-if-generated` and every `x-open-next-*` and `x-vercel-ip-*` header. `worker.js` calls it on every request, after the three refusals it already makes (data path, admin edge rate limit, body size) and immediately before the app. The Worker's `Request` is what OpenNext builds its event from, so a header removed here is really gone, which is not true of a deletion made in the middleware (decision 4).

- A request carrying none of them is handed on as the same object. Otherwise a new request is built from it and only the headers differ: method, URL, body, redirect mode, abort signal and `cf` carry over.
- The framework sets the geolocation headers itself afterwards, from `request.cf`, so real values are unaffected.
- A revalidation header arriving from outside is logged in one fixed line, never with its value. The geolocation names are not logged. The line is not rate limited: any caller can cause it, as any caller can already cause the middleware's own refusal line.

**No revalidation queue is configured**, so nothing legitimate sends the pair today: `open-next.config.ts` is `defineCloudflareConfig()` with no `queue`, `incrementalCache` or `tagCache`, and `wrangler.jsonc` has no `WORKER_SELF_REFERENCE` service binding and no queue Durable Object. Both of OpenNext's Cloudflare queues deliver their requests to this Worker's own `fetch` through that binding, carrying exactly these two headers. They would be removed like anyone else's, and revalidation would never report success. Configuring a queue therefore means changing this first: give the queue's requests their own entrypoint on the binding instead of trusting the headers from every caller again.

**Also checked, no change needed** (`@opennextjs/aws` 4.1.7, `@opennextjs/cloudflare` 1.20.8, `next` 16.3.8). The list is a list of names, so it is only as good as the version it was read against, and patch and minor dependency updates merge on green checks. A test therefore pins the parts of the installed OpenNext code this rests on (see Verification); when it fails, repeat the reading below.

- OpenNext removes Next's internal headers from every inbound request before routing: `x-middleware-rewrite`, `-redirect`, `-set-cookie`, `-skip`, `-override-headers`, `-next`, `x-now-route-matches`, `x-matched-path`, `x-nextjs-data`, `x-next-resume-state-length`, and anything starting `x-opennext-` or `x-middleware-response-`.
- `x-matched-path` and `next-resume` are honoured by Next only in minimal mode, which OpenNext does not use. `x-middleware-subrequest` and the `x-invoke-*` names are not read by this Next version at all.
- `x-middleware-prefetch`, `x-forwarded-host`, `x-deployment-id` (skew protection is off), `next-action` and the router prefetch headers do not affect whether the middleware runs.
- `x-next-revalidate-tag-token` is compared with the same build value but only marks cache tags as stale. It is what a forwarded server action sends; the app has none, and the header is left alone.
- An error thrown inside the routing layer (the malformed geolocation value above was the one found) is answered with a 500, not passed on to a route.

**Verification.** `tests/internalRequestHeaders.test.mjs` sends requests through `worker.js` and checks what the app is handed: none of the internal headers, in any spelling, with every other header, the method, the URL and the body as sent; the same object when there was nothing to remove; the earlier refusals still first; the log line without the value. Its last test reads the installed `@opennextjs/aws` and fails if the two header names change, if the routing layer gains another reason to hand a request on before it looks for a middleware, if a name leaves OpenNext's own strip list, if the geolocation names change, or if OpenNext starts running Next in minimal mode. The same was exercised against a local `wrangler dev` build before and after: of 25 requests sent to a `/api/v1` route with no token, each with a different set of framework headers, one was answered by the route before the change and none after. Pages, a route outside the gate and requests with a body behaved as before.
