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

## Amendment 1 (2026-10-09): four follow-ups from the review of this change

Built in a second change, after the first was reviewed. No SQL migration, no feature flag.

1. **A rotated Access key is picked up by the first request that carries it.** `verifyAccessJwt` kept the key set for an hour and answered `kid` for a key it did not hold, so a warm isolate could refuse valid assertions for up to an hour after Access rotated its signing key. A miss now fetches the key set once more, at most once a minute per isolate (`CERTS_MISS_REFRESH_MS`), the way `lib/supabaseJwt.js` does. A failed refetch keeps the set already held. A key the fresh set does not hold is still refused. This covers every caller: the machine endpoints, the dashboard routes and the Cinema administrator routes.
   - The minute is taken before the fetch, whether or not it succeeds, so that misses cannot become a stream of fetches while the key endpoint is down. Two limits follow. A miss that arrives while the refetch is in flight is refused once and passes on retry. After a refetch that failed, a rotated key waits for the next minute. Both were an hour before.
   - The one extra fetch is on top of the ordinary load, so a cold isolate that meets an unknown key fetches twice in that request.
2. **`normalizedPath` always answers.** It is called for every request. The URL parser drops a tab or a newline wherever one sits, and the function collapsed slashes before the parser did that, so a path that decodes to one of those next to a slash could have its next segment read as a host name. The parser refused some of those and the Worker answered with the platform's error page. Tabs and newlines are now dropped first, so such a path is classified by what is left, like any other. If no path can be produced at all the function returns `null`, and each caller reads `null` as a match for the prefix it screens: the admin rate limiter counts the request as an admin one, and the data-path guard answers 404. No string could do that for both, because the two prefixes are different. The admin rate limiter now also tests the path as sent, as the data-path guard already did, so a path under the admin prefix is counted as one whatever the rest of it normalises to. A path that names an admin route or a data file is never classified less strictly than before.
3. **The deploy reads the two hostname settings back.** `wrangler deploy` is the only thing that applies `workers_dev` and `preview_urls`, and a deploy from a checkout older than this ADR turns both back on without saying so. After each production deploy, `scripts/check-workers-dev.mjs` reads `GET /accounts/{id}/workers/scripts/{name}/subdomain` and expects `enabled` and `previews_enabled` to be `false`.
   - It is the last step of the deploy job, after the smoke test and its rollback, and it cannot fail the job. By then the release is live, and a rollback restores the code, not these two settings, so a red job would describe something that did not happen and would change nothing.
   - If either setting is on, or the answer cannot be read, the `report-workers-dev` job comments on the open `deploy-failure` issue or opens one. An unreadable answer is reported too, so the check cannot go quiet.
   - It sees what this workflow's own deploy left behind. A deploy made some other way, from an older checkout, is not seen until the next run here.
4. **The dashboard routes take a person's login.** Access issues two kinds of assertion for one application: to a person who logged in, and to a service token. Its application token reference gives the two payloads: a login carries `email` and the user's id in `sub`; a service token carries its client id in `common_name` and an empty `sub`. `requireDashboardAccess` now passes only the first kind (`email` and `sub` both non-empty text) and answers `403 access_required` to any other validly signed assertion. `common_name` is not read: a policy can also ask a person for a client certificate, and the reference does not say that a login then carries none. `requireAccess` is unchanged: the machine endpoints are what the service token is for. The Cinema administrator routes were left as they were in this change and still took either kind; Amendment 2 gives them the same rule.

### Verification

- `tests/accessGate.test.mjs`: a rotated key verifies after one refetch, for both gates; five misses in a row make one fetch; the window reopens after a minute; a failed refetch keeps the old keys and uses up the minute; three misses at once make one fetch; the machine endpoints take both kinds of assertion.
- `tests/adminEdgeRateLimit.test.mjs` and `tests/nextDataGuard.test.mjs`: paths that decode to a tab or newline are screened or refused like their plain spellings; the paths that used to throw reach the app; a parser that refuses the path outright gives the closed answer in both callers.
- `tests/workersDevCheck.test.mjs`: the API answer is read as documented; anything unclear is unknown, never off; the token is never in the output; the step sits after the smoke test and rollback and cannot fail the job.
- `tests/adminDashboardAccess.test.mjs`: each dashboard route refuses a service token's assertion before anything reaches Supabase; the documented login payload passes.

### Owner checks

1. Before this is deployed: the owner's own Access assertion has the login shape. Decoded locally, the payload of the `CF_Authorization` cookie on the site shows a non-empty `email` and a non-empty `sub`. If it does not, the dashboard routes would answer 403 to the owner, and item 4 must be reverted before deploying.
2. The first production deploy after this: the last step of the deploy job prints that the workers.dev route and Preview URLs are off. That step has not run against the live API before. If it reports that it could not read the setting, the deploy token may lack read access to that endpoint.

## Amendment 2 (2026-10-09): the Cinema administrator routes take a person's login

Built in a third change. No SQL migration, no feature flag. Cinema is behind `CINEMA_*` switches that are `false` in production, so these routes answer 503 there before any of this is reached. On staging the switches are on and the rule applies as soon as this is deployed there.

The Cinema administrator handlers (`creatorApi.js`, `publishApi.js`, `operatorApi.js` and `earningsApi.js` under `lib/cinema/`) verify the Access assertion themselves, after the identity and second-factor gates. They called `verifyAccessJwt`, so they passed any validly signed assertion for the application, the kind issued to a service token included. Amendment 1 item 4 closed that for the dashboard routes only.

1. **One rule, in one place.** `lib/accessJwt.js` exports `verifyAccessLogin`: it runs `verifyAccessJwt`, then refuses a payload that is not a login, with the reason `not_a_login`. The rule is the one from Amendment 1 item 4 (`email` and `sub` both non-empty text, `common_name` not read). `requireDashboardAccess` now calls it too, so there is no second copy.
2. **It is the default verifier of the four handlers** in their administrator modes: the creator review queue and decision, the submission queue, review and suspension, the two operator actions, and the earnings read. That is every route under `/api/v1/admin/cinema/`. A service token's assertion answers `403 access_required` before any RPC is made, as a missing or invalid one already did.
3. **A refusal says why, in the log.** The handlers answered `403 access_required` without recording the cause. Each now writes one `[access] refused: <reason>` line, in the form `requireDashboardAccess` uses: `not_a_login` for a service token's assertion, the verifier's own reason for one that does not verify (`expired`, `audience`, `signature` and so on), and a fixed sentence when no assertion arrived. Only the reason is written, never the assertion or anything read from it. The answer to the caller is unchanged.
4. **Unchanged:** `verifyAccessJwt` and `requireAccess`, so the machine endpoints under `/api/admin/*` still take the service token. The creator-facing modes of the same handlers (apply, submit, withdraw) never asked for an assertion and still do not. Nothing in this repository calls a Cinema administrator route with a service token: its one user is `.github/workflows/top-up-backfill.yml`, which calls `/api/admin/top-up-backfill`.

### Consequences

- A Cinema administrator who works through `/app/admin/cinema` sees no change, as long as their login has the documented shape (owner check 1): the edge adds the assertion of their own login to those requests.
- Every route under `/api/v1/admin/*` now takes a person's login and nothing else. A machine caller for one of them would need its own design, not the service token.

### Verification

- `tests/adminDashboardAccess.test.mjs`: each of the eight Cinema administrator exports is called as the route file exports it, with the Access key set and Supabase stubbed. The documented service-token payload answers 403 with nothing reaching Supabase; the documented login payload answers 200; a missing, malformed, wrongly signed or wrong-audience assertion still answers 403. Each refusal is checked for its log line, and the service-token case for a log that holds no part of the assertion; a login that passes logs nothing. `verifyAccessLogin` is tested on its own, including that an assertion which does not verify is refused for that reason first.
- The walk of `app/api/v1/admin` in the same file now also fails for a Cinema administrator export that is not in that list, and for a route file that names a method anywhere but in a one-line `export const`, so a new export is either called with both kinds of assertion or fails the test. A route file that calls `requireDashboardAccess` is still passed as a whole, as before.

### Owner checks

1. The check from Amendment 1 covers this change too: the owner's own `CF_Authorization` payload, decoded locally, shows a non-empty `email` and a non-empty `sub`. Anyone else who is to review Cinema submissions or run operator actions needs the same of their own login.
2. On staging, where the Cinema switches are on, and again when they are first turned on in production: sign in through Access, open `/app/admin/cinema`, and confirm the review queue loads. A 403 `access_required` there says the assertion was refused, not why: the answer is the same for a missing, invalid or expired assertion and for one that is not a login. The Worker log has the reason (`wrangler tail`, the `[access] refused:` line); `not_a_login` means that login's assertion does not have the documented shape.

## Amendment 3 (2026-10-09): the framework's internal request headers are removed at the Worker

The review of the original change found one more place where the request the middleware is meant to see is decided by the caller. It predates this ADR and is separate from the four follow-ups in amendment 1.

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

## Amendment 4 (2026-10-09): a handler only sees an identity header the middleware set

Amendment 3 closed the one known way a request could reach a route without the middleware having run. This one makes any other such way end in a refusal, whatever its cause.

**Problem.** A `/api/v1` handler reads who the caller is from `x-veyrnox-auth-id` and trusts it because the middleware set it. Decision 4 makes that true whenever the middleware runs. If the framework handed a request on without running it, the handler would receive the caller's own headers as sent. The guarantee should not depend on there being no second case like the one in amendment 3.

**Decision.** `dropInternalHeaders` (amendment 3) also removes, from every inbound request:

- every `x-veyrnox-auth-*` header: the five identity headers, and any added under that prefix later;
- every `x-middleware-response-*` and `x-opennext-*` header. These are the names OpenNext's routing half uses to hand things to its rendering half. It takes the first prefix off there and keeps the rest of the name as a request header, so a name under it could become an identity header. OpenNext already removes both from a client's request, and the test from amendment 3 pins that. They are removed here as well, so the rule does not rest on OpenNext's list.

An identity header therefore reaches a handler only if the middleware set it in that request. A request the middleware never saw arrives with none, and a handler that finds no caller id answers 401.

- Other `x-veyrnox-*` names are left alone. `/api/admin/reap-assets` reads its caller's own `x-veyrnox-admin-token`, on a route the middleware does not run on.
- The middleware still sets all five on every request (decision 4). That is what holds under `next dev`, where `worker.js` does not run and Next applies the middleware's headers itself.
- A new identity header must take the `x-veyrnox-auth-` prefix. A test reads the names from `middleware.js` and fails for one the Worker would let through.
- The log line now names the kinds removed (`revalidation`, `identity`, `framework`) in one line per request, and still no value. It replaces the line described in amendment 3.

**Signing was considered and not built.** The alternative was for the middleware to add a keyed digest over the identity headers, and for a handler to refuse a request without a valid one. It would also cover a case that is not known to exist: the framework turning some other header of the caller's into an identity header after `worker.js` has run. Against it:

- 57 files read the caller id straight from the header. Each of them, and its tests, would change.
- The key has to be the same in the middleware and in the handlers. That is either a Worker secret, whose absence would refuse every `/api/v1` request, or a value held in the isolate, which would have to be shown to be shared everywhere the app runs (the Worker, `next dev`, the tests).

Removing the headers at the one layer where a removal holds gives the property that was wanted, with no change to a handler and nothing to configure. If handlers are ever given a single reader for identity, a digest can be checked there.

**What this rests on.** Every handler that reads the caller id refuses a request without one. `/api/v1/health` is the exception: it echoes the id back, reads nothing of the caller's and changes nothing.

**Verification.**

- `tests/internalRequestHeaders.test.mjs`: a request with forged identity headers is sent through `worker.js` and what comes out is given to the real session handler, which answers 401. The same request given to the handler directly is answered with the forged id; that is the gap the Worker's removal stands in front of. The other cases from amendment 3 now cover the identity and framework names as well, and a name that only resembles one (`x-veyrnox-admin-token`, `x-middleware-prefetch`) is kept.
- `tests/identityHeaders.test.mjs`: every file that reads the caller id has a refusal for a missing one.
- A local `wrangler dev` build, run three ways. With neither this rule nor amendment 3's, and the framework's skip triggered on purpose, the session route, the dashboard route and the generations route ran for the forged caller (the dashboard route stopped at its Access check). With this rule alone, each answered `401 not_authenticated` from the handler. With both, each answered 401 from the middleware. A real token got the same answers in all three, with or without forged headers beside it.

## Amendment 5 (2026-10-09): `worker.js` answers `/cdn-cgi/*` with 404

Built in a separate change. No SQL migration, no feature flag. Takes effect with the Worker deployment.

**Problem.** `/cdn-cgi/` is Cloudflare's prefix. Its network answers the endpoints under it before a Worker runs, and the app has no page, route or asset there. Whether a request under the prefix is ever handed to the Worker is decided at the edge, by hostname and zone settings that are not in this repository, and staging answers on a workers.dev hostname, where the answer may differ. A request that was handed on went to the framework like any other. The adapter's generated worker has a branch for one path under the prefix, meant for local preview, and assumes such a request never reaches a production Worker. That assumption is the platform's to keep; nothing here held or tested it. This is the case decision 2 was written for: what a request gets should not depend on which way it arrived.

**Decision.** `refuseCdnCgi` in `lib/cdnCgiGuard.js` answers any path under `/cdn-cgi/` with the 404 that decision 2 gives a data path: the same body and headers, for every method, with the request body unread. `worker.js` calls it next to `refuseNextData`, before the rate limiters and the framework.

- The path is tested as sent and as normalised, in any letter case, with the normaliser the other screens use (`normalizedPath`). A path that cannot be normalised is answered 404, as in amendment 1 item 2.
- The path as sent is the string the generated worker reads, so every request it would have taken under the prefix is answered here first.
- This rule logs nothing, so a scan of the prefix cannot fill the log. A path that cannot be normalised is still answered and logged by `refuseNextData`, which runs first.

**Checked, no change needed.**

- Nothing in `app/`, `components/` or `lib/` builds an address under the prefix on the site's own origin. The one mention is the Access key set in `lib/accessJwt.js`, which is fetched from the Access team domain. `next.config.mjs` has no `images` setting and nothing imports `next/image`. Turnstile is loaded from `challenges.cloudflare.com` and the Stream player and uploads use Stream's own hosts.
- The endpoints Cloudflare serves under the prefix on the site's hostname (the Access sign-in and sign-out among them) are answered at the edge. The app has no route for any of them, so nothing that works today is answered by the Worker under the prefix.
- Under `wrangler dev` the emulator answers its own endpoints under the prefix, the scheduled trigger included, before `worker.js` is called (read in the installed `miniflare`, 5.20261001.0-alpha).

**Consequence.** An image loader that builds `/cdn-cgi/image/` addresses would be served only where the edge answers them, and would get this 404 wherever the Worker is what answers, local preview included. Adopting one means changing this rule first.

**Verification.** `tests/cdnCgiGuard.test.mjs`: the prefix and its other spellings (encoded, doubled or backward slashes, a decoded tab or newline, upper case, a raw prefix whose remainder decodes to another path) answer 404 for seven methods before either rate limiter and the app, with nothing logged; before the change the same requests reached the app. Paths that only resemble the prefix pass through unchanged. The list includes a path each rate limiter would otherwise act on. Its last case fails if `app/cdn-cgi` or `public/cdn-cgi` appears, or if `next.config.mjs`, `middleware.js` or a source file under `app/`, `components/` or `lib/` names the prefix, other than the guard and `lib/accessJwt.js`.

**Owner check.** Not visible from this repository: whether either hostname's edge hands such a request on at all. After the deploy, a search of each Worker's log for a request whose address contains `cdn-cgi` shows it; with this rule every such request has status 404.
