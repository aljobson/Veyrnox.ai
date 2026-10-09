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
3. **Unchanged:** `verifyAccessJwt` and `requireAccess`, so the machine endpoints under `/api/admin/*` still take the service token. The creator-facing modes of the same handlers (apply, submit, withdraw) never asked for an assertion and still do not. Nothing in this repository calls a Cinema administrator route with a service token: its one user is `.github/workflows/top-up-backfill.yml`, which calls `/api/admin/top-up-backfill`.

### Consequences

- A Cinema administrator who works through `/app/admin/cinema` sees no change, as long as their login has the documented shape (owner check 1): the edge adds the assertion of their own login to those requests.
- Every route under `/api/v1/admin/*` now takes a person's login and nothing else. A machine caller for one of them would need its own design, not the service token.

### Verification

- `tests/adminDashboardAccess.test.mjs`: each of the eight Cinema administrator exports is called as the route file exports it, with the Access key set and Supabase stubbed. The documented service-token payload answers 403 with nothing reaching Supabase; the documented login payload answers 200; a missing, malformed, wrongly signed or wrong-audience assertion still answers 403. `verifyAccessLogin` is tested on its own, including that an assertion which does not verify is refused for that reason first.
- The walk of `app/api/v1/admin` in the same file now also fails for a Cinema administrator export that is not in that list, and for a route file that names a method anywhere but in a one-line `export const`, so a new export is either called with both kinds of assertion or fails the test. A route file that calls `requireDashboardAccess` is still passed as a whole, as before.

### Owner checks

1. The check from Amendment 1 covers this change too: the owner's own `CF_Authorization` payload, decoded locally, shows a non-empty `email` and a non-empty `sub`. Anyone else who is to review Cinema submissions or run operator actions needs the same of their own login.
2. On staging, where the Cinema switches are on, and again when they are first turned on in production: sign in through Access, open `/app/admin/cinema`, and confirm the review queue loads. A 403 `access_required` there says the assertion was refused, not why: these handlers give one answer for a missing, invalid or expired assertion and for one that is not a login, and they do not log which. Check 1 tells the last case from the others.
