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
