# ADR-0160: Read-only mode when Supabase is down

**Status:** Proposed 2026-10-19.

## Context

Everything that carries state lives in Supabase: sign-in, the credit ledger, jobs, the catalog. When it is down,
the site and the phone app showed errors with no explanation. The owner asked that the site and app keep working
and that a banner say something is happening.

The credit ledger is in the same database, so anything that spends, grants or refunds credits cannot run without it.
That is a feature: nothing is charged against a balance we cannot read.

## Decision

"Keeps working" means **read-only**:

- **Still works:** public pages, the price list (`/api/catalog`, landing, `/models`), the signed-in app shell, and
  the phone app's saved Library, balance and catalog copies (`apps/mobile/src/lib/cache.ts`). Sign-in already
  survives: the JWKS key set is served stale for up to six hours (`lib/supabaseJwt.js`), and a failed token
  refresh keeps the session (`app/lib/authClient.js`).
- **Paused until Supabase returns:** creating, buying and saving. They fail as before; the banner says why.
- **Not built:** queuing writes on the device for later, and any generation that does not go through the ledger.

Pieces:

1. `GET /api/status` (outside `/api/v1`, anonymous, no identity read) returns `ok`, `degraded` or `unknown`. It
   comes from `lib/upstreamStatus.js`: a one-row read of `model_catalog` through the normal client with a 3 s
   timeout, retried once. Only a missing response, a timeout or a 5xx counts; a 4xx is reported `ok` and logged,
   because it is ours to fix. One probe per 15 s per isolate, saved in the Workers Cache API, so a flood of
   status requests is never a flood of database calls.
2. The website banner (`ServiceStatusBanner`, mounted in `app/layout.js`) and the phone strip (`ServiceBanner`)
   poll that endpoint, every 30 s, every 10 s while showing, and only while the page or app is in view. A failure
   to reach our own endpoint shows nothing: that is the device being offline, not Supabase. While it shows, the
   web sets `<html data-service="degraded">` so a screen can switch off what cannot work.
3. `readPublicCatalog` keeps its saved copy for seven days. Within five minutes it is served without a query as
   before; past that it is refreshed, and if the refresh fails the old copy is served instead of an error.
4. The banner copy is in the ten site languages (`status.degraded.*`) and English on the phone
   (`net.serviceDegraded`, `docs/mobile/I18N-NEW-KEYS.md`).

## Not proved

- Verified with unit tests only (`tests/upstreamStatus.test.mjs`, `tests/publicCatalogStale.test.mjs`,
  `apps/mobile/__tests__/serviceStatus.test.ts`). No real or simulated Supabase outage on staging, no browser or
  simulator look at the banner, and the phone tests were not run in this checkout (no install).
- The nine non-English site translations were written without a native review.
- API routes still answer 500/502 on a Supabase failure rather than a uniform 503 with `Retry-After`; making that
  one shape is a follow-up.
