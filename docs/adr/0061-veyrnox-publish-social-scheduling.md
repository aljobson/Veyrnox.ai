# ADR-0061 — Veyrnox Publish: native multi-platform social scheduling

- **Status**: **Accepted 2026-09-28.** Product owner approved Option A (build native
  adapters) in "Decision" and the v1 platform scope (Instagram, X, TikTok, LinkedIn,
  YouTube) in "Scope and rollout", both as proposed, no changes. Research/spec-only —
  no code, migration, or OAuth app registration exists yet; implementation can now
  proceed under this ADR's design.
- **Date**: 2026-09-28
- **Deciders**: Product owner (sole) — accepted
- **Related**: [ADR-0062 — Veyrnox Publish entitlement model](0062-veyrnox-publish-entitlement-model.md)
  (the deferred credit-vs-subscription billing decision, drafted separately),
  [ADR-0031 — Stripe replaces LemonSqueezy](0031-stripe-replaces-lemonsqueezy.md)
  (vendor-category-rejection precedent), [ADR-0032 — Passkeys, hand-rolled against the
  GoTrue REST API](0032-passkeys.md) (precedent for "adapter over SDK" on the SSR graph),
  [ADR-0026 — Turnstile CAPTCHA](0026-turnstile-captcha-on-auth.md) and
  [ADR-0060 — Nonce CSP rendering](0060-csp-rendering-decision.md) (CSP-change precedent),
  `docs/social-publisher/` (the full spec pack this ADR summarizes: product spec,
  technical spec, design style guide, user flows, and
  [security baseline](../social-publisher/05-security-baseline.md) — the OWASP/NIST/ISO/NCSC
  control mapping referenced in "Security & compliance baseline" below).

## Context

Veyrnox.ai generates images, video and voice, but a creator has to leave the product to
post the result anywhere. Every competing "generate" tool has this same gap, and every
competing scheduling tool (Metricool, Buffer, Hootsuite) has no generation capability of
its own — nobody in the category currently closes this loop. `docs/social-publisher/`
is a spec pack built by researching Metricool live (its public marketing/product pages,
plus its own MCP connector's API contracts — the real per-network validation rules, the
full analytics metric taxonomy, the best-time-to-post data shape) and syntx.ai's live
CSS (colors, type) for the visual system the user asked us to apply. That pack answers
*what to build*. This ADR is the decision record for *whether and how* to build it,
scoped the way this repo's ADRs are meant to be scoped: options, drivers, trade-offs,
and a recommendation the product owner can accept or reject — this is a cost and
vendor-lock-in decision, not just an engineering one.

The core question: does Veyrnox **build native adapters** against each platform's own
API (Meta Graph API, TikTok Content Posting API, X API v2, LinkedIn API, YouTube Data
API v3, Pinterest API, ...), or does it **integrate a third-party unified social-posting
API** that already handles those relationships, and skip straight to a UI on top of it?

## Options considered

### A — Build native adapters per platform (the spec pack's assumption)
Each network gets a thin `fetch`-based adapter in `packages/adapters/social/`, following
the existing `fal.js`/`lemonsqueezy.js`/`r2.js` pattern (no vendor SDK on the SSR graph,
matching the `jose`/`@supabase/supabase-js` bundler-trap history in `CLAUDE.md`). Veyrnox
owns every OAuth app registration, every token, every publish call.

### B — Integrate a unified social-posting API vendor (e.g. Ayrshare or a comparable
aggregator)
One vendor exposes a single REST API that already has approved developer apps on every
major network; Veyrnox calls one API instead of eleven. The vendor handles OAuth consent
screens (often co-branded), token refresh, and absorbs each platform's own app-review
process.

### C — White-label or partner with Metricool (or a similar incumbent) directly
The MCP connector used to research this pack is live and authorized *for the user's own
personal Metricool account* — it is not evidence of any commercial B2B partnership or
white-label offering, and no such offering was found during this research. Included here
only to rule it out explicitly.

### D — Do not build; keep the status quo
Users keep leaving Veyrnox to post. No engineering cost, no new vendor risk, no new OAuth
surface — and no closing of the one gap this product uniquely could close.

## Decision drivers (ranked)

1. **Differentiation.** The "Generate → Schedule" handoff (§1.5/§4.3 of the spec pack) is
   only possible, and only valuable, if Veyrnox controls the composer and publish path
   end to end. A thin UI in front of a third-party aggregator can still offer this, but
   the aggregator becomes a second point of failure between "generate" and "post."
2. **Vendor category risk.** ADR-0031 is a live lesson: LemonSqueezy rejected this
   account outright because "AI media generation" is a category exclusion for them, not
   an appeal that could be won. A social-posting aggregator vendor doing its own
   Instagram/TikTok/Meta app-review compliance could plausibly apply the same kind of
   blanket exclusion to an AI-generation platform's traffic, or restrict it later — this
   needs diligence *before* Option B is picked, not after integration work starts.
3. **Time to first shippable version.** Option B is materially faster: one vendor
   integration instead of five-to-eleven separate OAuth app reviews running in parallel
   external timelines Veyrnox doesn't control.
4. **Ongoing maintenance cost.** Option A means Veyrnox owns every platform API's
   breaking changes forever. Option B pushes that maintenance to the vendor, in exchange
   for a recurring per-account or per-post vendor bill and a new dependency to track
   (alongside fal.ai, kie.ai, BytePlus, Stripe — this repo already carries several
   external provider dependencies with their own outage/pricing/ToS risk).
5. **Data exposure surface.** Option A means Veyrnox's own token-encryption and
   service-role boundary (§2.7 of the technical spec) is the only place user social
   tokens live. Option B means a second company holds live posting credentials for every
   connected account — a materially larger blast radius if that vendor is breached, and a
   second company's privacy/ToS posture to underwrite.
6. **OAuth app-review lead time.** External and largely fixed either way once a given
   platform is in scope — Option A pays this cost directly and up front; Option B may
   still pay a version of it if the vendor requires Veyrnox to register its own app under
   their multi-tenant setup rather than fully absorbing it (this varies by vendor and
   needs confirming before Option B could be recommended over A).

## Trade-off table

| | A. Native adapters | B. Unified API vendor | C. Metricool partnership | D. Do nothing |
|---|---|---|---|---|
| Differentiation (Generate→Schedule) | Full — owns the whole path | Partial — UI differentiation only, publish path depends on vendor | Not viable — no partnership exists | None |
| Time to first version | Slowest — N platform integrations in parallel | Fastest — one integration | N/A, ruled out | Instant (nothing ships) |
| Vendor category risk | None (no new vendor) | Real — see ADR-0031 precedent; needs diligence | N/A, ruled out | None |
| Ongoing maintenance | Veyrnox owns every platform API change | Vendor owns it, for a recurring fee | N/A, ruled out | None |
| Data exposure | One boundary (Veyrnox's own) | Two boundaries (Veyrnox + vendor) | N/A, ruled out | None |
| New recurring cost | Engineering time only | Engineering time + per-account/per-post vendor fee | N/A, ruled out | None |
| Closes the product gap | Yes | Partially | No | No |

## Decision

**Accepted: Option A — build native adapters — phased, starting with five platforms.**
The product owner approved this on 2026-09-28, as recommended below, with no changes.
The differentiation this feature exists to deliver (Generate → Schedule, §4.3 of the
spec pack) is the whole reason to build it at all; routing the actual publish call
through a third-party aggregator undercuts that story and adds a second vendor with its
own category-risk profile right after this exact risk cost a live billing provider
(ADR-0031). Option A costs more engineering time up front, which is an acceptable trade
for owning the full path and not repeating the LemonSqueezy lesson with a new vendor.

This recommendation is contingent on the product owner accepting a slower v1 timeline
than Option B would offer. If time-to-market outweighs differentiation and vendor risk
in the product owner's judgment, Option B is the fallback — but it needs its own
follow-up ADR with a named vendor, a read of that vendor's terms of service for AI-
generated-content restrictions, and confirmed pricing, none of which this research pass
did (this pack's research budget went into Metricool's *feature* contract, not into
scoring aggregator vendors).

Every adapter follows the "adapter, not SDK" pattern already established by
ADR-0032 (passkeys hand-rolled against GoTrue's REST API rather than pulling in
`@supabase/supabase-js`): plain `fetch`, no platform SDK, until a specific SDK is
independently confirmed safe for the Workers Builds SSR bundle — this is the same
bundler-trap lesson (`CLAUDE.md` §Bundler traps) that has already cost three build
outages (`tsx`, `jose`, `@supabase/supabase-js`).

## Scope and rollout

Per the spec pack's phasing (§1.7 of the product spec):

- **v1 platforms:** Instagram, X (Twitter), TikTok, LinkedIn, YouTube — chosen for
  mainstream creator overlap and comparatively well-documented OAuth app-review paths.
  Facebook, Pinterest, Threads, Bluesky, Twitch and Google Business Profile follow once
  the adapter pattern is proven.
- **v1 features:** connect accounts, composer with per-network overrides, calendar
  (month/week/list) with drag-to-reschedule, auto-publish scheduling engine, best-time-
  to-post (static heuristic until enough per-account history exists), basic per-network
  analytics (evolution + per-post).
- **Deferred:** approval workflow (a draft-and-approve step was later added for
  automated brand posts; see the 2026-10-02 amendment below), competitor tracking, SmartLinks (link-in-bio),
  unified inbox, automation rules ("Flows"), ads dashboard, exportable reports — all
  specified in the pack's §1.5 Phase 2/3 lists, none scoped for this ADR's v1.
- **No credit-ledger change in v1.** Whether Publish draws from the existing
  generation-credit ledger or is a separate subscription entitlement is explicitly
  **not decided here** (spec pack §1.8) — it needs its own ADR before any billing code
  is written, consistent with `CLAUDE.md`'s money-spine rules.

## What each platform is expected to require of us (not independently verified today)

Unlike the BytePlus provider ADR (0058), which quotes directly from terms documents
fetched and saved into `docs/pricing/`, this research pass did not fetch and read each
platform's current developer/API terms of service. The items below are known
category-level requirements from general familiarity with these platforms' developer
programs, flagged explicitly as **unverified** and as pre-work that must happen before
implementation starts on each platform, not as confirmed facts this ADR is asserting:

- **Meta (Instagram/Facebook) Graph API** — app review is required for any scope beyond
  a developer's own test accounts; Instagram content publishing requires a Business or
  Creator account, not a personal one; Meta's Platform Terms and Developer Policies
  likely impose their own restrictions on AI-generated-content posting tools that need
  reading before app submission.
- **TikTok Content Posting API** — new apps typically start in an audited/restricted
  mode (private-only posting, forced watermark) until TikTok approves full production
  access; this affects v1 launch messaging for TikTok specifically, independent of
  engineering readiness.
- **YouTube Data API v3** — subject to YouTube's own API Services Terms and a daily
  quota; the `isAiGeneratedContent` disclosure field referenced in the technical spec
  reflects YouTube's existing synthetic-media disclosure requirement and should be
  treated as mandatory, not optional, in the adapter.
- **X (Twitter) API v2** — posting access sits behind a paid API tier as of general
  knowledge at time of writing; the actual current tier and pricing must be confirmed
  directly from X's developer portal before this platform is greenlit for v1, since a
  wrong assumption here would block launch late rather than early.
- **LinkedIn API** — organization-page posting requires the connecting user to be an
  admin of that LinkedIn Page and the app to be approved for the relevant Marketing/
  Community Management API product.

**Action before implementation starts:** file a short verification pass per v1 platform
(mirroring the BytePlus ADR's "what X requires of us" research discipline) into
`docs/compliance/` before opening any OAuth developer app, not after.

## Security & compliance baseline

Because this feature's entire surface is new external integrations (OAuth tokens for eleven
third-party platforms, inbound webhooks, media handling) rather than internal logic, security
controls are specified up front, not deferred to implementation review. The full control mapping
against named external frameworks — **OWASP Top 10 (2021)**, **OWASP API Security Top 10 (2023)**,
**NIST Cybersecurity Framework 2.0**, **ISO/IEC 27001:2022 Annex A**, and **UK NCSC** guidance
(14 Cloud Security Principles, OAuth guidance, 10 Steps to Cyber Security) — lives in
[`docs/social-publisher/05-security-baseline.md`](../social-publisher/05-security-baseline.md).
The headline decisions it documents, all already folded into §2.7–§2.11 of the technical spec:

- **No server-side fetch of caller-supplied URLs in v1** — media only comes from Veyrnox's own R2
  library or a direct browser upload, which removes an entire class of SSRF risk by construction
  (Metricool's own API, by contrast, fetches arbitrary public/Drive/Dropbox URLs server-side; that
  pattern is explicitly *not* copied here, and is gated behind a dedicated hardening design if
  Phase 3's Drive/Dropbox import ever ships).
- **OAuth hardening beyond the baseline state-param check**: PKCE on every code exchange,
  exact-match redirect URIs, single-use CSRF-bound state, refresh-token rotation with reuse
  detection treated as a compromise signal, minimum-necessary scope per phase, tokens never
  logged/returned to the client.
- **Authorization defense in depth beyond RLS**: object-, property-, and function-level checks in
  every API handler, matching this repo's existing `get_user_asset` ownership-check pattern rather
  than relying on the database layer alone.
- **Named, unfilled gaps** rather than implied coverage: no incident-response plan yet for a
  compromised platform token, no vulnerability disclosure process confirmed, no penetration test
  has happened (this is a pre-implementation spec), no formal threat model diagram yet. See
  `05-security-baseline.md` §5.6–5.7 for the explicit gap list and pre-implementation checklist.

## Consequences

- Five to eleven new OAuth client secrets become Worker secrets (`wrangler secret put`),
  none in `wrangler.jsonc`, matching existing secret-handling rules.
- CSP (`connect-src`) should **not** need to widen, because every platform API call is
  server-side only (§2.7 of the technical spec) — this is a design constraint carried
  into implementation, not a hope; any deviation (e.g. a client-side platform SDK) needs
  its own ADR amendment, the same discipline ADR-0026 and ADR-0060 already established
  for CSP changes in this repo.
- Ten new tables land in `packages/db/schema/supabase/`, all `FORCE ROW LEVEL SECURITY`,
  next free migration numbers taken at implementation time (check open PRs first, per
  `CLAUDE.md` — this ADR does not reserve numbers; take the next free one when the first
  implementation PR opens).
- A new class of user data (third-party social account tokens) enters the system,
  encrypted at rest via Web Crypto under a dedicated Worker secret never reused from any
  other subsystem, with its own rotation runbook to write before launch.
- Ongoing engineering cost: each connected platform's API can change under us; this is
  the accepted cost of Option A and should be weighed against Option B's recurring
  vendor fee when the product owner reviews this ADR.

## Amendment 2026-10-02: draft posts and batch approval

The owner asked for Veyrnox's own brand accounts to be fed automatically, on the
condition that nothing generated is published without their review. Migration
`0182_social_post_drafts.sql` adds the minimum the schema needs for that:

- `social_posts.status` gains `draft`, and a draft always carries a
  `draft_batch_id`. Every function that moves a post towards a network filters
  `status = 'scheduled'` (claim, settle, sweep health, due index), so a draft is inert.
- `create_social_post_draft` runs `create_social_post` unchanged (same ownership,
  account, media and idempotency checks), then parks the new row as a draft in the
  same transaction.
- `approve_social_post_batch` schedules a batch's drafts, never earlier than the
  approval time. It settles each one, so a draft whose accounts were disconnected
  meanwhile becomes `failed`, not `scheduled` with nothing left to send.
  `discard_social_post_drafts` cancels one draft or the rest of a batch. Both are
  limited to the brand owner and logged in `social_account_actions`.
- All four new functions are service-role only. There is no ledger or entitlement
  change, and publishing still needs `PUBLISH_ENABLED` and live platform approvals.

Out of scope: editing or rescheduling a draft (discard and regenerate instead),
multi-person approval, and the generator and review UI, which follow in their own
changes on top of these functions.

## Amendment 2026-10-03: analytics storage and the first dashboard

The v1 scope above includes "basic per-network analytics (evolution + per-post)".
Migration `0188_social_analytics.sql` and the analytics sweep are the first part of it:

- Three tables, closed to browser roles like the rest of Publish: one evolution
  snapshot per account per day, one row per post the network reports, and a sync row
  saying when each account is next due. `get_social_analytics` is the only read and
  returns an account's numbers to its owner alone.
- `lib/socialAnalyticsSweep.js` runs on the existing five-minute cron behind
  `PUBLISH_ANALYTICS_ENABLED` (off). Each account is fetched every six hours. A failed
  fetch is kept on that account's sync row; it is **not** appended to
  `social_account_actions` as §2.5 of the technical spec first proposed, because a
  broken account would then add a permanent audit row every few hours.
- Instagram was the first network fetched. With the scopes the connect flow has
  always requested it reads followers, following, post count, and likes and comments
  per post.
- Reach, views, saves and shares need `instagram_business_manage_insights`. The owner
  approved adding it (2026-10-03). The connect flow requests it only when
  `INSTAGRAM_INSIGHTS_SCOPE_ENABLED` is "true"; it ships "false" because Meta must
  approve the permission in app review first. An account connected before the switch
  keeps its old grant until it reconnects, and the sweep asks for insights only for
  accounts whose stored grant includes the permission. Insights are refreshed for the
  ten newest posts each round; stored metrics are merged, so older posts keep theirs.
- `/app/publish/analytics` shows followers over time, posts, interactions and
  engagement (interactions per post, per 1,000 followers) for 7, 30 or 90 days.

No ledger or entitlement change. Analytics are not gated by plan yet; ADR-0063 decides
whether they should be.

YouTube follow-up (2026-10-03): basic channel and video statistics use the existing
`youtube.readonly` grant, with the same analytics storage and switch. Each round reads
the connected channel, its latest 50 uploads and one batched video-statistics response.
Expired/expiring tokens are refreshed with the existing Google adapter and encrypted
before the existing account-token RPC stores them. The dashboard labels subscribers
and videos separately and shows views without requiring Instagram reach. Subscribers
are rounded; channel/video views, likes and comments are lifetime counters, with the
post date range selecting publication dates. No YouTube Analytics API scope is added.

TikTok follow-up (2026-10-03): the owner approved proceeding with TikTok analytics.
`TIKTOK_ANALYTICS_SCOPE_ENABLED` adds `user.info.stats` and `video.list` only when "true";
it ships "false" until Display API/scopes approval. The callback stores actual granted
scopes, including partial consent. The sweep reads connected-account statistics and
up to 50 recent public videos (three pages maximum), only under the relevant grants.
Videos store lifetime views, likes, comments and shares; account snapshots store
followers, following, total likes and public video count. Publication-date filtering
is explicit in the dashboard. No reach or private-video statistics are implied.

TikTok access tokens expire daily and refresh tokens may rotate. Additive migration
`0190_tiktok_token_rotation.sql` atomically persists both encrypted tokens, expiry and
actual scopes only on an active TikTok connection whose old token pair still matches.
A disconnect, reconnect or competing update makes stale work stop before fetching.
YouTube's existing access-only RPC and scope behavior stay as implemented above.
Apply 0190 before TikTok collection; production switches remain off.

Not built yet: X and LinkedIn analytics, best time to post, and the calendar.

## Open questions

**Resolved at acceptance (2026-09-28):** Option A (build native) and the v1 platform
scope (Instagram, X, TikTok, LinkedIn, YouTube) were both approved as proposed by the
product owner — see Status above. Remaining open items, none of which block starting
implementation but all of which should close before GA:

1. Credit vs. subscription entitlement model for Publish — drafted as
   drafted and now **Accepted** as [ADR-0062](0062-veyrnox-publish-entitlement-model.md):
   an independent "Publish Plan" modelled on Cinema Pass (ADR-0057),
   never touching the credit ledger.
2. Confirm current X API v2 posting-tier pricing and TikTok Content Posting API audit
   requirements before the X and TikTok adapters ship — both are flagged above as
   unverified against live documentation.
3. Who owns the OAuth app-review submissions (Meta, TikTok, YouTube) and when do they
   start — these can run in parallel with engineering but are on an external clock this
   team doesn't control. Start these immediately given the ADR is now accepted.
4. Confirm no conflict with the Veyrnox/Veyrnox-wallet hard wall (`CLAUDE.md` §HARD
   WALL): Publish is a Veyrnox.ai feature for Veyrnox.ai users' own social accounts; it
   must never surface wallet-brand copy or be positioned as a wallet-adjacent feature.
5. Does the org have an existing vulnerability disclosure process / `security.txt`? If not,
   this feature — about to hold live posting credentials for external platforms — is a
   reasonable forcing function to add one before launch (security baseline §5.6).
6. Extend the existing incident-response runbook to name a compromised social-platform
   token as its own scenario, distinct from the generation/billing scenarios it already
   covers (security baseline §5.3 "Gap, stated plainly").


## Posting insights implementation (2026-10-03)

Migration **0191_social_posting_insights.sql** adds weekly cached timing and posting-frequency
aggregates. `PUBLISH_POSTING_INSIGHTS_ENABLED` defaults to `"false"`; apply 0191 through the
protected main migration workflow before enabling it. Publish and analytics collection must
also be enabled. No additional platform permission or external API is required.

The implementation uses publication timestamps and counters in `social_analytics_posts`,
not daily account snapshots. One JSON aggregate per account updates timing, frequency and
empty-history metadata atomically. It covers twelve complete weeks in the brand timezone,
independent of the dashboard's date filter. Invalid timezones fall back to UTC.

Measured posts need numeric likes and comments and must be at least 48 hours old. Timing
recommendations need ten measured posts spanning fourteen days and three posts in a slot.
Unknown scores stay null; sparse histories receive no generic recommendation. Frequency
counts every stored post and weights averages by measured posts. Lifetime counters favour
older posts; these observations do not establish causation or audience availability, and
collection may omit older/private/deleted posts. These choices amend the original heatmap
schema and generic cold-start proposal in technical spec §2.5.

Owner-only reads, service-only functions, RLS/FORCE RLS and denied direct table grants match
analytics security. Cache failure does not block successful ingestion or other dashboard
analytics. Next engineering slice: the calendar view. X/LinkedIn analytics and live account
verification remain dependent on owner API-access and permission decisions. Staging Publish
schema provisioning remains outstanding; this change does not enable any remote switches.

## Calendar and rescheduling (2026-10-04)

Migration 0192 implements owner-only range reads and compare-and-set rescheduling, behind
`PUBLISH_CALENDAR_ENABLED` (default false). The calendar uses the viewer's local timezone,
matching the composer, with month/week/list modes, status/network filters and explicit
100-post pagination. Drafts stay in batch review until approved. Dragging opens the same
confirmation form as the keyboard-accessible Reschedule button; it does not persist a move.

Only scheduled posts with exclusively pristine pending targets may move. Lock targets
before the parent, with NOWAIT to avoid waits against a worker or multi-target disconnect.
Set both the parent schedule and every target's next-attempt time. Updating the target's
own due predicate prevents a claim using an older parent snapshot from dispatching early.
A timestamp precondition rejects stale edits; a repeated desired timestamp is a no-op.
Append one post_rescheduled audit entry on a real change. No credit ledger is involved.

## Device uploads (2026-10-06)

The owner requires posting media from their device even when their generation library
is empty. Migration 0223 adds a separate, owner-scoped Publish upload library; no fake
generation job, ledger mutation or external provider call is made. The composer accepts
one existing job or one completed upload ID. Both resolve storage at dispatch time.

Uploads use the existing R2 SigV4 client with exact Content-Length, Content-Type and
If-None-Match signatures. A dedicated `social-uploads/{auth_id}/{uuid}.{ext}` prefix
keeps permanent Publish files outside Transform-source cleanup. Before completion the
Worker reads at most 16 bytes, checks the total size from Content-Range and verifies the
file signature. No arbitrary URL or client-supplied storage path is accepted.

Each account has ten slots and a 200 MiB combined budget, serialized by the user row
lock. JPG/PNG/WebP images are limited to 20 MiB and MP4 video to 100 MiB. Completed
files persist for reuse; unused files can be removed. Drafts, scheduled posts and any nonterminal target block removal. Completed/canceled
posts retain an upload metadata receipt after removal, without holding storage capacity.
Scheduling and removal share the user lock. The cleanup sweep claims abandoned uploads
older than 24 hours, or removed files after the signed PUT's expiry safety window.
Only confirmed R2 deletion releases the database reservation; failures retain the budget.

`PUBLISH_UPLOADS_ENABLED` defaults false in both environments until 0223 is applied.
Routes also require the overall Publish flag. Existing generated-media dispatch remains
available while device uploads are disabled. Upload consent and retention copy appear
before selecting a device file; uploading alone never creates a post. Activation requires
exact-origin R2 CORS allowing PUT, Content-Type and If-None-Match, and a real staging
browser upload/second-PUT rejection check. Keep the upload switch enabled for cleanup
while files are held; the overall Publish switch can close entry points independently.

## Amendment 2026-10-08: all-network tester implementation

The owner requested all integrations be built for testing by other people and
explicitly does not want a personal Meta account. Extend the native adapter
pattern to Facebook Pages, Threads, Pinterest boards, Bluesky, Twitch and
Google Business Profile locations. A company app administrator supplies
credentials and invites testers; the owner's own Meta login is not required.

Initial additional publishing scope is single-image posts. Twitch supports
OAuth connection and recent-video statistics, not a general media-upload
destination. Bluesky uses a dedicated app password for Bluesky-hosted PDSs;
custom PDS discovery and federated OAuth are outside this tester slice.
These are explicit capability limits, not claims of full Metricool parity.

New connections and post creation require the server switch
`PUBLISH_EXTENDED_NETWORKS_ENABLED` (false by default). The original five
adapters and their consent switches remain separate. The one-account cap,
Publish plan decision and generation-credit ledger are unchanged.

Migration 0228 adds encrypted, identity-bound, single-use destination
selections; atomic token rotation; and a durable pre-submission marker.
Facebook Pages, Pinterest boards and business locations require explicit
selection. No candidate credential is returned to the browser, even encrypted.
Uncertain provider results require reconciliation before another public post.

Automated contract tests and local database acceptance do not establish app
approval or real-account success. Existing live YouTube evidence remains
valid; each new provider needs separate live tester evidence.
See [tester handover](../social-publisher/INTEGRATIONS-TESTING-2026-10-08.md)
for setup, capabilities, rollout and the acceptance checklist.
