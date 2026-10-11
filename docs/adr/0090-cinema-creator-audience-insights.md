# ADR-0090 — Private creator audience insights

- Status: Accepted implementation; activation pending
- Date: 2026-10-11

Active creators can read aggregate insights for their own currently public, published root titles. The dashboard selects from their existing private creator catalogue; viewers, other creators, frozen actors and withdrawn titles cannot retrieve these insights. A verified middleware subject is the only identity input. The read-only service RPC has an empty search path and browser execution denied; no audience identities, emails, playback URLs, follower lists or money fields are projected.

The fixed period covers the last 28 completed UTC calendar days. A composite watch-session target/time index supports the bounded period, and the existing account read budget applies. Current ready uploads, active unfrozen viewers with Auth/profile records and current publication are rechecked. Replayed or overlapping watch ranges merge; own activity, less than 30 seconds (or the full shorter media duration) and events outside the period do not qualify. Viewers are signed-in accounts, not independently verified humans.

All five metrics are withheld below five qualified viewers. Otherwise the projection contains qualified viewers, viewers completing at least 90% of watched media, and distinct qualified viewers who voted, used a copy/share action or authored a currently approved comment without an open report. Series aggregates cover currently public ready episodes the account actually watched; they do not assert full-series completion. Shares do not prove external delivery. These counts do not calculate ranking scores, revenue or entitlements. Small-cohort suppression is not a formal anonymity guarantee; changing source eligibility can change daily aggregates.

The dashboard resets on account identity and title selection, ignores superseded responses, clears stale counts on errors and exposes retry. The API validates the period, threshold, count bounds and privacy state, rejects unknown/duplicate query fields, whitelists metrics and uses no-store responses. Logs contain request ID, outcome and status, without user identity or response bodies.

Migration 0284 changes an index and one read-only RPC. `CINEMA_CREATOR_ANALYTICS_ENABLED=false` in both environments, requiring existing creator-content, profiles, audience and viewing gates. Activation still needs exact receipts, retained clean checks, hosted creator ownership/withdrawal/account-switch and mobile acceptance, and representative load measurements. Queue-materialized analytics, earnings, notifications and additional dimensions remain separate work.
