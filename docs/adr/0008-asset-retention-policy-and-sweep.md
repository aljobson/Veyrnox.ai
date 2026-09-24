# ADR-0008 — Asset retention policy + sweep

- **Status**: Accepted (2026-09-11) — corrected 2026-09-20. It read Proposed while the decision was signed off in this document and migration 0016 is applied.
- **Date**: 2026-09-11
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0005 — Phase-0 business preconditions](0005-phase-0-business-preconditions.md), [ADR-0006 — EU residency amendment](0006-auth-and-db-amendment-eu-residency.md)

## Context

The `assets` table has an `expires_at` column (indexed) and no job that actually reads it. Every generation stores an output object into R2 and inserts a row that will, by design, never expire on its own. Two consequences today:

1. **Unbounded R2 growth.** Cost is small at Phase-1 volume but the slope is 100% write, 0% delete. Left alone this becomes a line item that only ever moves in one direction.
2. **GDPR Article 17 (right to erasure) exposure.** ADR-0005 §3 and ADR-0006 already accepted EU-only user data. GDPR does not itself impose a *maximum* retention, but it requires a stated purpose and a defensible retention period per purpose. "We keep every asset you generated, forever, because we never wrote the sweep" is not defensible under Article 5(1)(e) (storage limitation).

Two independent decisions are wrapped up here and this ADR treats them separately:

- **Policy** — what retention period applies to whom.
- **Mechanism** — where the sweep actually runs.

## Options considered — retention policy

### A. Never expire

Leave `expires_at` NULL for every row. Users can delete individually via a future "delete asset" endpoint. No automatic sweep.

- Cost: unbounded R2 storage growth.
- Compliance: weakest. Requires a bespoke "we retain indefinitely because…" justification per Article 5(1)(e), plus a DSAR-driven deletion path.
- User expectation: "my stuff is safe forever" — nice for power users, expensive for us.

### B. Tier-based (free 30d / pro 90d / ultra 365d)

Sweep uses the user's plan at asset-creation time (or at sweep time — needs sub-decision) to pick a retention window. Ties retention to willingness to pay, which is a defensible business purpose under GDPR ("we retain longer for paying customers because they explicitly purchased that").

- Cost: bounded and forecastable per tier.
- Compliance: clean — each tier is a distinct purpose with a stated period. Update the privacy notice and ToS accordingly.
- Complexity: sweep must join `assets` to `users`/`entitlements`. If a user downgrades, do their old assets get the shorter window retroactively? (Answer: probably yes, on the first sweep after downgrade — but flag this as a policy sub-question.)
- Upsell: implicit "your work expires unless you upgrade" pressure. This is a feature to some product owners and a red flag to others.

### C. Uniform 90 days for everyone

Every asset gets `expires_at = created_at + 90 days`, regardless of plan. Sweep is one query, one policy.

- Cost: bounded and predictable.
- Compliance: clean and easy to explain in the privacy notice.
- Simplicity: highest. No tier awareness in the sweep. Ledger + billing tier changes never affect asset lifecycle.
- Loses the tier-linked upsell but avoids the "downgrade nukes my old work" support ticket class.

## Options considered — sweep mechanism

Costs and blast radii are small in absolute terms; the interesting variable is *where the operational burden falls*.

### (i) Cloudflare Worker cron

A Worker cron trigger runs on schedule, calls a DB endpoint (or Supabase REST) to fetch expired rows, deletes the R2 objects, then marks the rows as reaped.

- **Pros**: single deploy target with the rest of the app. Native Cloudflare cron. No new infrastructure.
- **Cons**: no direct DB — must talk to Supabase over the network, which means either a service-role key stored as a Worker secret (large blast radius if leaked) or a bespoke SECURITY DEFINER endpoint. If R2 delete succeeds but the row-mark step fails, orphaned state is possible; sweep must be idempotent.
- **Fit with ADR-0006 (Supabase, EU region)**: fine as long as the Worker is deployed to an EU-adjacent region for latency and the traffic stays inside EU-hosted egress paths. Worth confirming with a network diagram.

### (ii) Supabase `pg_cron` + SECURITY DEFINER function

A `pg_cron` job in Supabase runs a Postgres function that (a) selects expired rows, (b) marks them, and (c) enqueues R2 deletes via `pg_net` or hands them to a small Worker that only consumes the queue.

- **Pros**: retention policy lives right next to the data. No external scheduler to babysit. Deleting the R2 object is the *only* thing that leaves Postgres — the rest is native.
- **Cons**: `pg_net` outbound is best-effort and needs error handling. Two moving parts (Postgres cron + R2-delete consumer) instead of one. Slightly heavier operational literacy required from whoever is on-call.

### (iii) External scheduler hitting `/api/admin/reap-assets`

GitHub Actions cron or an external cron service calls a signed admin endpoint on the app. The endpoint does everything inline.

- **Pros**: fewest moving parts inside the platform; the endpoint is code you can read and test locally.
- **Cons**: adds a third-party dependency on the sweep path. The endpoint becomes the highest-value target in the app (delete-your-database energy) — every abuse of it needs solid auth. If the scheduler goes down (or the credential expires), the sweep silently stops.

## Trade-offs — policy

| Driver / Option | A. Never expire | B. Tier-based (30/90/365) | C. Uniform 90d |
|---|---|---|---|
| R2 growth | Unbounded | Bounded, per-tier | Bounded, uniform |
| GDPR fit | Weak | Strong (per-purpose) | Strong |
| Sweep complexity | N/A | Joins users, downgrade rules | One query |
| User surprise potential | Low ("my stuff never disappears") | High (downgrade edge cases) | Medium (everyone loses stuff at 90d) |
| Upsell lever | None | Yes | None |

## Trade-offs — mechanism

| Driver / Option | (i) Worker cron | (ii) pg_cron + Worker consumer | (iii) External scheduler |
|---|---|---|---|
| Moving parts | 1 | 2 | 2 (incl. external) |
| Failure blast radius | Medium (needs service key) | Low (Postgres native) | Medium (auth on public endpoint) |
| EU-residency story | OK if Worker region-pinned | Strongest (data never leaves DB until R2 delete) | OK, similar to (i) |
| Operational literacy needed | Cloudflare + JS | Postgres + a small consumer | Any cron tool |
| Fits Phase-1 stack | Yes | Yes (Supabase already chosen in ADR-0006) | Yes |

## Recommendation

**Policy: Option C — Uniform 90 days.**
**Mechanism: (ii) Supabase `pg_cron` + a tiny R2-delete consumer.**

One-line reason: C removes the "downgrade nukes my old work" support-ticket class that B invites, and (ii) keeps the retention rule adjacent to the data it governs — which is the shape ADR-0006 already argued for when it consolidated auth + DB on Supabase.

If the product owner strongly wants retention as an upsell, revisit as B and accept the downgrade-policy sub-decision that comes with it.

## Decision

Approved by Al 2026-09-11 — 90d uniform + pg_cron sweep. Migration 0016 applied. Worker consumer at /api/admin/reap-assets guarded by ADMIN_REAP_TOKEN env.

## Consequences (if C + (ii) is accepted)

- **Backfill migration**: every existing `assets` row needs `expires_at = created_at + 90d` (or NULL for a small allowlist if any). One-off SQL migration, ~10 lines.
- **Privacy notice**: state 90-day retention for generated assets, with the exception of any explicit "keep this" action a user takes (if we build one). Legal counsel review before publishing.
- **DSAR path** still needs an on-demand deletion route separate from the sweep — GDPR Article 17 does not accept "wait 90 days" as a response.
- **User-visible affordance**: at some point users will want to download or "pin" an asset before it expires. Not required for this ADR, but flagged as the natural next feature.
- **Sweep observability**: `pg_cron` job needs a log destination; failures must page someone. Fold into whatever monitoring ADR eventually lands.

## Open questions

- Does Cloudflare R2 lifecycle policies solve any of this natively (per-object TTLs)? If yes, mechanism (i)/(ii)/(iii) collapse into "just tag the object" and the DB row is the only thing we sweep. Requires a small spike.
- What is the "user asks for erasure" latency SLA we want to promise? Common answers: 30 days (statutory maximum for DSARs), 7 days (better), 24 hours (aggressive). Drives whether the sweep needs an ad-hoc trigger path.
- If a user's payment fails and they get suspended, does their retention window keep counting or freeze? Small policy decision, needs an answer before the sweep ships.

## 2026-09-24 — refresh expired preview links

A 15-minute signed link expiring does not mean the stored file expired. Library,
Create and Clip Editor previews now request a fresh link from the existing
owner-scoped `/api/v1/jobs/:id/asset` endpoint on a media-load error. The signed
URL lifetime and 90-day retention policy are unchanged; no asset is recreated.

Each preview permits one automatic signing request per returned URL lifetime
and shares simultaneous error events. If the refreshed file still cannot load,
it stops and offers Retry. Failed signing requests need an explicit retry;
404 means unavailable, not a claim that retention caused deletion. Switching
jobs or unmounting ignores late responses. No timers poll settled previews,
and refreshed URLs stay in component memory rather than localStorage.

## 2026-09-24 — show retention deadlines in the Library

Migration 0109 adds `asset_expires_at` to the existing owner-scoped list and
asset lookup RPCs. The deadline comes from `assets.expires_at`, never from job
submission time. For a job with multiple assets, the list shows the earliest
non-null deadline; the individual asset response carries its own deadline.
The existing job-id index serves these bounded lookups. No rows, sweep policy,
signing lifetime, or permissions change.

Library notices show the local date and time, highlight the final seven days,
and identify elapsed retention without claiming that a sweep already ran.
Missing assets say unavailable, since absence does not prove expiry. An older
RPC or null deadline shows the existing 90-day policy without inventing a date.
Hydration merges by job id to preserve server metadata across cache races and
hydrates server-listed jobs on devices with no local history.

The notice is opt-in via `localStorage.veyrnox_asset_expiry = '1'`, pending the
normal migration and rollout gate. Production application of 0109 still needs
the owner's approval through `apply-migrations` on main. The UI and API tolerate
the old RPC response during deployment. This does not implement pinning or
change retention.

## 2026-09-24 — bound signed asset-link requests

The authenticated asset endpoint gains a per-account limit of 120 requests per
fixed 60-second window. This leaves room for the Library's 12-card initial load,
pagination, retries, and multiple tabs. It is a fixed window, not a sliding
window: a boundary can admit two bursts. Missing/foreign asset requests consume
the same account quota, preventing job-id rotation from bypassing the control.
The ownership check and 15-minute signing lifetime remain unchanged.

Migration 0110 uses an atomic upsert keyed by user ID, shared across all Workers.
It stores one reusable row per account and caps denied attempts at 121; denied
requests do not extend the window. These counters intentionally count every
HTTP attempt, including retries, rather than using money-RPC idempotency keys.
They are operational metadata, never ledger entries. The table forces RLS,
revokes direct access (including service_role), and exposes one service-role-only
SECURITY DEFINER function with an empty search path. Account deletion removes
its counter. No cron or unbounded per-request log is needed.

When enabled, quota denial returns 429 with bounded Retry-After and no-store;
missing users get 404, and a failed/malformed limiter returns 503 before asset
lookup or signing. Preview recovery explains 429 and requires manual retry;
it does not automatically hammer the endpoint. Clip Editor's internal ownership
lookups are unchanged. This protects URL minting, not subsequent R2 downloads,
unauthenticated traffic, or the remaining API endpoints; edge controls remain
separate audit work.

Initial rollout staged `ASSET_LINK_RATE_LIMIT_ENABLED` as false in wrangler.jsonc.
The sequence was merge, obtain owner approval for 0110 through apply-migrations,
verify the migration and rollout checks, then enable the server switch in a
follow-up PR (recorded below). No client setting can bypass an enabled limiter. Disabling the server switch
is the application rollback; counter rows can remain. While false, protection
is staged and the audit item is not yet closed in production.

### Activation follow-up

Migration 0110 was owner-approved and applied by `apply-migrations` run
35989167997 at 2026-09-24 10:47:43 UTC. The migration ledger accounts for all
85 applied migrations. At 10:52 UTC, a fresh production reconciliation returned
zero balance, free-credit, Top-up and failed-refund drift. PR #285's production
deployment and CI completed successfully.

The follow-up sets `ASSET_LINK_RATE_LIMIT_ENABLED` to `true`; enforcement begins
when that configuration is deployed. This is a security control on an existing
authenticated endpoint, with no new browser path, so the new-user-path 24-hour
browser-flag gate does not apply. This check does not claim 24 hours of clean
reconciliation. The separate asset-expiry notice remains behind its browser
rollout gate. Rollback is a deployment setting this server flag back to `false`;
the additive migration does not need reverting.

## 2026-09-24 — shared quota for job metadata reads

Migration 0115 bounds the Library list, individual job status, and provenance
reads at 600 per account per fixed 60-second window. A twelve-card Library page
polling every three seconds uses at most 240 status requests per minute; this
leaves headroom for initial hydration, pagination and another tab. Two bursts
can straddle a fixed-window boundary; this is not a rolling quota.

Both owner-scoped read RPCs resolve the account first, then atomically consume
one shared counter before reading job data. Changing job IDs, cursors, or
switching between the three routes does not create a new bucket. Missing or
foreign jobs consume the caller's quota without revealing their existence.
Unknown identities preserve the existing empty-list/NOT_FOUND behavior and
allocate no counters. List fields, expiry dates, pagination, and job ownership
predicates remain unchanged. Signed asset URLs retain their separate 120/minute
quota; generation attempts retain their separate 20/minute quota.

The counter table has one row per account, forced RLS, and no direct privileges
for browser roles or service_role. A service-role-only helper accepts the UUID
already resolved by the trusted RPCs; clients never supply it to an app route.
The functions use empty search paths. Denied counts saturate at 601 without
extending the window. No ledger entry, balance, job or asset is changed.

The three gateway routes translate the new RATE_LIMITED verdict into 429 with
bounded Retry-After and no-store, before any provenance catalog/asset lookup.
They remain compatible with the old RPC response while deploying. Existing
clients receive the gateway's typed 429 error; this change does not redesign
their retry UI or protect the remaining API routes or unauthenticated traffic.

**Rollout order matters:** merge and wait for successful production deployment
of the 429-aware handlers, then obtain owner approval and apply 0115 through
apply-migrations. Applying 0115 activates enforcement immediately. No additional
flag or browser opt-in exists for this control on existing authenticated reads.
Rollback requires an approved forward migration restoring the prior read RPCs;
leave the applied migration ledger intact.
