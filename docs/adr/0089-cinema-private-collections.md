# ADR-0089 — Private Cinema saved titles and follows

- Status: Accepted implementation; activation pending
- Date: 2026-10-11

Cinema viewers can privately save public root titles and follow their creators or series. These are personal collections, not watch entitlements or notification consent. No email, public follower list, credits, subscriptions or payouts are created.

Migration 0283 adds three bounded collections and seven-day idempotency receipts. Every table forces RLS and denies direct access to browser and service roles. Only three narrow service-only RPCs accept the middleware-verified Supabase subject. Actor activity is rechecked under serialized mutations; callers cannot supply an owner. Mutations set an explicit desired state, deduplicate retries, reject changed payloads and cap each collection at 1,000 entries, with 30 writes/minute and 500/day. Replayed acknowledgments describe the original request; the UI then rereads current state.

Adding requires a currently public, published root and ready media (or a series with a currently public ready episode). Creator follows require at least one such title and refuse self-following. Lists and status recompute current visibility, creator role/status and Auth existence on every read. Withdrawal, suspended/frozen creators and withdrawn series ancestors remove content from projections immediately. Removing a previously known reference remains possible after withdrawal. Lists use actor-scoped stable cursor pairs and 20-item pages, with no-store responses and whitelisted output fields. No signed playback URLs, emails or audience identities are projected.

The UI mounts private state by account and collection identity, discards obsolete responses, disables overlapping writes and refreshes after acknowledgments. Signing out removes the collection from the screen.

`CINEMA_RETENTION_ENABLED=false` in both environments. Activation requires exact migration receipts, retained clean checks and real-account acceptance: viewer save/remove/reload, creator/series follow/unfollow, another account seeing an empty private collection, account switching during delayed requests, current content withdrawal and mobile navigation. Notifications and creator analytics remain separate roadmap work; following alone authorizes neither messages nor third-party publishing.
