# ADR-0241: Security-audit callback, telemetry and purchase-ordering boundaries

Status: Proposed 2026-10-21; accepted by merging. Production rollout requires the protected migration and deployment workflows.

## Context

The owner requested remediation of the seven findings in the 2026-10-21 read-only security audit. Tests must not generate paid media or deliver social posts. A lost temporary worktree required reconstruction in a durable checkout with incremental committed checkpoints.

## Decisions

- A01: reject and scrub implicit access/refresh/ID-token fragments before all callback branches. Never adopt a session from a bearer-only URL. Signup now starts S256 PKCE, like other emailed/OAuth flows; keep the browser-bound, expiring verifier. Previously issued implicit links require a fresh sign-in.
- A02: share a canonical, route-aware telemetry URL boundary across PostHog and Sentry. Remove capability suffixes, credentials, queries and fragments, including localized/encoded paths and nested SDK fields; clone Date timestamps without losing SDK semantics. Explicitly blank incoming Referer/referrer headers at the analytics proxy as well: same-origin SDK requests otherwise carry the signed page URL independently of the sanitized body, and OpenNext overlays SET values rather than honoring omission/deletion. Exclude capability pages from session replay. This does not remove historical events.
- A03: a refused job transition is not proof that storage/refund completed. Reread the authoritative job using job, user, provider and task identity. Only STORED, REFUNDED and CANCELLED are settled dedup no-ops. Recover unfinished SUCCEEDED copies and FAILED refunds, even if a previous delivery prematurely marked its webhook processed. Do not mark rejected copies processed before settlement. Existing ledger and asset RPC idempotency remain required.
- A04: place the existing exact-claim TikTok submission marker immediately before photo initiation, after authorization. An uncertain marked submission needs reconciliation, never blind re-initiation. A saved publish ID still permits polling. Migration 0287 already permits this network; no new publishing SQL is needed. MEDIA_UPLOAD delivers an inbox draft, not a public post.
- A05: migration 0358 adds an opaque channel-bound order-hash refund tombstone, even before purchase arrival. Both store-purchase and refund RPCs take the order advisory lock before user/balance locks. A later purchase grants zero after a refund. Existing capped clawback/free-credit protection/freeze behavior is retained. The table is append-only, forced-RLS, without personal foreign keys or direct application-role grants; only service-executable definer RPCs write it. Keep store billing disabled until separately approved. Pre-migration missing-order responses must retry, not be acknowledged as final.
- A06: keep Privacy choices reachable after every choice, navigation, reload and account change. Blocked local-storage access must not prevent the control from rendering or an in-memory withdrawal.
- A07: disclose necessary Sentry server-error processing separately from optional PostHog analytics/replay in all 11 privacy locales, without asserting unverified vendor retention, location or legal arrangements.

## Verification and limits

See [the operational closure record](../operations/security-audit-remediation-2026-10-21.md) for current evidence and release state. Offline transport fixtures establish application behavior, not real provider delivery. PostgreSQL acceptance must establish ordering, concurrency, idempotency, role permissions and replay. Browser journeys must verify the real consent UI. Production verification is read-only/no-charge and bound to a visible deployed revision.

Remaining distinct risks: historical telemetry exposure/retention cannot be inferred from the source audit; discarded historical store refunds cannot be reconstructed from type-only webhook records. Store Publish subscription terminal-event ordering is separate from the credit-pack tombstone and remains gated/unresolved; retrying a missing subscription is not durable ordering. No paid/provider or public publishing acceptance is claimed by this release.

## Rollout and rollback

Merge only after required CI and security review. Apply 0358 through `apply-migrations` with the required production-database owner review, then verify the deployed Worker revision and read-only smoke checks. Preserve newer concurrent releases. The additive SQL keeps old signatures and is safe ahead of the Worker; a Worker rollback does not undo the migration. Do not delete tombstones or roll back ledger/refund data. Keep billing/feature flags unchanged. Investigate any failed gate before retrying; never bypass environment protection.
