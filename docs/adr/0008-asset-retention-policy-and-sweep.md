# ADR-0008 — Asset retention policy + sweep

- **Status**: Proposed (2026-09-11)
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
