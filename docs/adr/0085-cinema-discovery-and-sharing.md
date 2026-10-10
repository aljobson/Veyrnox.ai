# ADR-0085 — Public Cinema discovery and sharing

Status: implemented; rollout requires migration 0277 and the existing viewing/voting acceptance gates. The owner selected the full weighted ranking model on 10 October 2026; this change prepares discovery and sharing, while watch signals, scoring, approved winners and social retention remain separate unfinished work.

## Behavior

Series lists published series with at least one ready public episode. Vote lists ready published titles and episodes eligible for an open competition, with qualified aggregate counts and watch links. The initial For You tab lists published titles chronologically; it does not claim personalized recommendations. Categories filter on the root title. Pagination retains PostgreSQL microseconds plus a UUID tie-breaker. Late category responses cannot replace a newer selection; a failed next page preserves the inventory and offers a retry.

Episode watch links carry an optional validated public title UUID for the return link. That value grants no viewing permission. A standalone episode share has a functioning Cinema return link without treating the episode UUID as a root title.

Native sharing and copying use canonical production title/episode URLs, without account identifiers, query strings or signed media tokens. Clipboard denial exposes the public URL for manual copying. A completed share request does not establish delivery, unique reach or an external social conversion. This change records no ranking share metric or audience analytics.

## Boundary and rollout

`/api/cinema/discovery` is an explicitly allowlisted anonymous read. It never uses inbound identity headers, returns a whitelisted projection and sends no-store responses. Viewing must be enabled; voting discovery also requires the voting/profile gates. The RPC has an empty search path and service-only execute permission. Public content and every ancestor must remain published/public, with a current active, unfrozen creator and Auth record. Qualified counts exclude held/rejected ballots and voters whose account/Auth/profile is no longer eligible. There are no credit, billing or award writes.

The public inventory is bounded to 24 titles and 25 current competitions per title. Its new publication index supports deterministic paging. Migration numbering was checked against main and the pending admin release. Migrations 0271–0276 must be deployed before 0277 in production; lower-numbered migration receipts cannot be backfilled after a higher migration has applied.

## Verification

The exact source rebuilt 251 migrations and passed all 58 actual PostgreSQL acceptance scripts, including discovery publication/ancestor/readiness privacy, category/type/window filtering, current account/Auth vote counts, tied pagination, repeated migration application, service-only privileges and unchanged ledger counts. API tests cover rollout gates, forged identity headers, malformed queries/results and public-field whitelisting. Full unit tests passed 2,860 with one intentional skip; security type-check, client import boundaries, migration numbering and production build passed.

Reticle returned verified yes for Series, Vote, pagination, delayed category responses, failure/retry recovery and the episode-to-series return journey. These ran the actual UI/API/RPC against synthetic data in an owned local PostgreSQL database, with a small loopback transport adapter; they do not establish real staging Auth/MFA/Access/Stream acceptance. A denied-clipboard fallback returned verified yes at presence grade, with the canonical URL visible and no false success message. Successful clipboard and native share-sheet use remain unverified: the leased browser denied clipboard access and could not provide trusted input. No permission prompt was bypassed.

The saved local flows retain their intents and require the corresponding local fixture setup. The clipboard fallback has presence-only coverage. The initial clipboard-success attempt failed and is not counted as a pass. Reticle's step digests sometimes reported an in-flight request before the declared network wait completed; the final declared predicates passed. Both instrumentation limitations were reported through Reticle feedback. Temporary SDK wiring, development CSP changes and fixture services were removed before the production build. Shared developer servers were untouched.
