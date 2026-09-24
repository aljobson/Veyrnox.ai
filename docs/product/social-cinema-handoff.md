# Social Cinema implementation handoff

## Source and status

The [specification pack](../social-cinema/README.md) contains the ten original
Markdown files from `Veyrnox_AI_Site_Technical_Docs_v1.0.zip`, supplied through
the “Top App Downloads Compare” conversation on 2026-09-24. The files are
imported unchanged. This is a proposed MVP baseline, not a description of
features already deployed. In particular, the public overview is draft website
copy and must be checked against shipped functionality before publication.

## Fit with this repository

This repository already runs a Next.js AI generation application with Supabase
identity, a server API, migration workflows, and a credit ledger. Social Cinema
is additive product work. Preserve existing generation, billing, and auth flows.
Read [CONTEXT.md](../../CONTEXT.md), [CLAUDE.md](../../CLAUDE.md), and the
[architecture decisions](../adr/README.md) before implementing.

Resolve these differences explicitly in implementation ADRs:

- The pack proposes a new mobile/admin monorepo layout. Keep the existing
  application layout and `packages/db/schema/supabase/` migration location;
  choose an additive mobile location without moving unrelated code.
- The pack suggests direct RLS-safe CRUD. Current repository rules route
  application data through the server API with service-role-only grants.
  Reuse that boundary unless an ADR deliberately changes it. RLS alone does
  not protect service-role calls: server operations must enforce ownership.
- Reuse existing Supabase identity and user provisioning. Public profiles
  must not expose account email, billing data, or grant clients privileged roles.
- Cloudflare Stream is proposed for uploaded episodes; existing generated
  assets use R2. Resolve media residency against existing EU residency ADRs,
  playback revocation, and CSP requirements before integrating Stream.
- Reconcile the lifecycle terms across specs 01, 04, and 06 before defining
  enums. Media processing state and moderation visibility are distinct concerns.
- Define score normalisation, competition boundaries, eligibility thresholds,
  and tie-breaking before implementing deterministic ranking. The pack gives
  weights and options, not a complete scoring algorithm.
- The source roadmap includes story polls in MVP; the earlier conversation
  suggested them for a later release. Use the supplied pack as the baseline
  and record any deliberate scope change.

Production migrations follow [ADR-0023](../adr/0023-migrations-applied-by-workflow.md).
Importing these documents does not apply migrations or enable new public routes.

## Implementation order and verification

Use the requested dependency order below. Moderation and authorization fields
must exist early enough to protect publication even though the moderation UI
comes later. Ship focused PRs with behavior, test results, and remaining gates.

| Slice | Deliverable | Meaningful acceptance tests |
| --- | --- | --- |
| 1. Foundation/auth/schema/RLS | Additive foundation, identity mapping, role model, migration and CI plan | Invalid/expired JWT rejection, role escalation denial, cross-user isolation, actual database RLS/ACL tests, migration replay |
| 2. Creator/series/episode | Owned profiles and draft content with validated transitions | Ownership changes denied, episode uniqueness, invalid transitions, draft visibility |
| 3. Stream direct uploads | Scoped upload sessions and trusted processing completion | Ownership, duration limits, signature verification, duplicate/out-of-order callbacks, failed processing |
| 4. Vertical feed | Published playable episodes, pagination, watch events | Hidden content excluded, playback failure recovery, progress deduplication, mobile interaction checks |
| 5. Voting | Competitions, qualified votes, story polls | Concurrent duplicate votes, closed competition, invalid poll options, suspended accounts, idempotency |
| 6. Rankings | Versioned deterministic scores and approved winner snapshots | Fixed event fixtures, ties, zero samples, fraud exclusions, repeat finalisation |
| 7. Moderation | Reports, role-gated actions, audit trail | Unauthorized actions denied, content suppression, immutable audit records |
| 8. Notifications | Opt-in release/vote/winner delivery | Opt-out respected, recipient isolation, deduplication, retries and invalid device tokens |

Begin with slice 1 and a focused PR. Test database behavior against an isolated
local database, not production. Retain the full roadmap's launch security,
performance, observability, and operational gates; the sequence above does not
remove them. Defer later slices until their foundations and decisions are ready.
