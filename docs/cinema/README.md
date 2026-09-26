# Veyrnox Cinema implementation

Source: [Technical Implementation Specification v1.0, September 2026](https://chatgpt.com/s/t_6ab643224f9881919a05694d64a5a7dc).
Read [REPO-ASSESSMENT.md](REPO-ASSESSMENT.md) first for the repository-specific architecture and PR sequence. The original Social Cinema 01–09 documents remain in `../social-cinema`.

## Implemented

- Existing Supabase authentication and verified Worker identity are reused.
- Existing opt-in profiles and private memberships are retained (migration 0132).
- `/social-cinema` is the public development entry; `/cinema` redirects there without duplicating a page or conflicting with generation Studio.
- Authenticated own-profile read/create with strict inputs, durable quotas and idempotent creation.
- Shared default-off server rollout controls in `lib/cinema/features.js`.
- Initial content, lifecycle, monetisation and AI disclosure domain vocabulary in `lib/cinema/domain.js`.
- Existing migration framework, typed API errors, forced RLS and tests are reused rather than replaced.

## Feature controls

`CINEMA_ENABLED` is the master switch. Each child also requires its exact string value `true`; unset, differently cased or malformed values disable it. Server flags are read per request. Local storage can expose preview UI but never authorizes an API.

| Control | Additional prerequisites |
| --- | --- |
| SOCIAL_CINEMA_PROFILES_ENABLED | Master |
| CREATOR_APPLICATIONS_ENABLED | Master + profiles |
| CREATOR_CONTENT_ENABLED | Master + profiles |
| CREATOR_UPLOADS_ENABLED | Master + profiles |
| CINEMA_SUBSCRIPTIONS_ENABLED | Master |
| CINEMA_UNLOCKS_ENABLED | Master + profiles |
| CINEMA_PUBLISHING_ENABLED | Master + profiles + content |
| CINEMA_VIEWING_ENABLED | Master |
| CREATOR_MONETISATION_ENABLED | Master + profiles + subscriptions |
| VOTING_ENABLED | Master + profiles |
| COMMENTS_ENABLED | Master + profiles |
| PPV_ENABLED | Master + profiles + subscriptions + monetisation |
| PREMIERES_ENABLED | Master + profiles + uploads |
| AI_RECOMMENDATIONS_ENABLED | Master |

Profile, creator-application and private-content endpoints consume their respective controls. Reserved controls do not mean their features are implemented. Every future route must check its applicable server control before side effects, then independently verify identity, role, account status and ownership. Feature flags grant no privileges.

All production flags remain false. Profile preview additionally requires `localStorage.veyrnox_social_cinema = 'true'`. Complete the migration/reconciliation gate and signed-in preview checks recorded in `../product/social-cinema-handoff.md` before enabling enrollment.

## Remaining

Versioned rights declarations and content submission; Stream uploads and playback; service-backed catalogue; watch history/watchlist; social/competitions; subscriptions and entitlements; creator cash ledger and Connect; moderation; queue-based analytics; complete security and end-to-end launch verification. No real films, subscription prices, revenue or payouts are fabricated by the foundation.

Provider credentials, separate preview resources, rights/age/territory policy and approved commercial settings are needed before the corresponding live features can be activated. See the assessment's explicit risks and decisions.

## Mandatory security overlay

The [security engineering brief](https://chatgpt.com/s/t_6ab644e42ac88191aaa6ea4cf6403e27) applies to every feature PR. The assessment pack in `docs/cinema/security/` (PR #327) must land before further feature implementation. Close applicable release gaps with implementation and evidence; the final launch review does not replace security work throughout delivery. No ASVS compliance is claimed.

## Creator application increment

ADR-0049 and migration 0133 add private creator applications, a scoped approval queue at `/app/admin/cinema`, fresh TOTP/Access enforcement and immutable review decisions. `CREATOR_APPLICATIONS_ENABLED` is a new default-off child of the master/profile switches. Approval grants creator only; upload/publishing and monetisation remain unavailable. Backend profile status enforcement also rejects non-active Cinema accounts. Refer to the ADR for migration, approver provisioning, preview verification and unresolved launch gates.

## Private content increment

ADR-0050 and migration 0134 add `/social-cinema/creator`: private film/short/trailer drafts and series → seasons → episodes, with metadata and structured AI disclosures. Current active creator membership is mandatory. Updates require the current revision; retries are idempotent. `CREATOR_CONTENT_ENABLED` stays false. Upload, rights clearance, review and publication remain later steps; no content is exposed publicly.

## Stream upload increment

ADR-0052 and migration 0137 add bounded creator upload reservations, direct resumable transfers, private processing status and verified Stream callbacks. Creator workspace video controls use existing draft ownership. All flags remain off. Live Stream credentials/testing, provider cleanup/replacement, rights and moderation remain launch gates; encoding success never publishes a draft.

## Viewer paywall increment (Phase 1)

ADR-0057 and migration 0142 add Free Episodes and Episode Unlock, modelled on ReelShort. Shorts and trailers are free, the first five episodes of a series are free, and every other episode or film costs 6 credits, taken from the existing balance by `ledger_unlock` (Free Credits first, Frozen accounts denied, replay-safe). `cinema_prices` is the only source of the numbers. `GET /api/v1/cinema/entitlement`, `POST /api/v1/cinema/unlocks` and `POST /api/v1/cinema/play` sit behind the new default-off `CINEMA_UNLOCKS_ENABLED` child switch. Playback tokens are RS256 Stream JWTs bound to one video and valid for 15 minutes, signed with `CINEMA_STREAM_SIGNING_KEY_ID` + `CINEMA_STREAM_SIGNING_JWK` (secret) for `CINEMA_STREAM_CUSTOMER_CODE`; the player host is not yet in CSP. `reverse_cinema_unlocks` is the Operator suspension reversal. `cinema_content` now admits `PUBLISHED`/`PUBLIC` but nothing writes them: the publication slice (own ADR) is still the gate before any viewer sees or pays for anything. Cinema Pass (Phase 2) is not built.

## Cinema Pass increment (Phase 2)

ADR-0057 and migration 0143 add the Cinema Pass: recurring Stripe subscriptions at $14.99 weekly ($11.99 first week, once per account, decided by `start_cinema_pass`), $49.99 monthly and $199.99 yearly, priced from `cinema_pass_plans` and sold through Checkout in subscription mode with inline recurring `price_data` and a deterministic once-only Coupon for the intro. A Pass grants viewing only: `cinema_entitlement` now answers `pass` for a live Pass whose period end is in the future, and no Pass path writes a ledger row. `/api/v1/cinema/pass` (read/start), `/pass/plans`, `/pass/return` (records the session and applies the subscription Stripe already shows, so a lost webhook cannot lose a paid Pass), `/pass/cancel` (within 14 days: cancel now and refund the unused share pro rata; after: stop renewing at the period end) and `/pass/portal` sit behind `CINEMA_SUBSCRIPTIONS_ENABLED`. The Stripe webhook handles `customer.subscription.*`, `invoice.paid` and `invoice.payment_failed` by re-reading the subscription; a `charge.refunded` on a subscription invoice ends the Pass, and a `charge.dispute.created` whose charge is on an invoice ends it and Freezes the account. `/social-cinema/pass` is the page, visible only with the `veyrnox_social_cinema` preview flag. Phase 3 (Pass plays and the 3,000-minute ceiling) is not built.

## Pass Plays increment (Phase 3)

ADR-0057 and migration 0144 add Pass Plays: `POST /api/v1/cinema/play/heartbeat` records up to 60 seconds per call for a viewer whose access to the title is `pass` (free, unlocked and locked viewing record nothing), a Pass can never log more seconds than wall-clock time, and `cinema_prices.pass_ceiling_minutes` (3,000) is now enforced: at the ceiling `cinema_entitlement` answers `locked` with reason `pass_ceiling` and the unlock price, so the viewer can still pay per episode. `GET /api/v1/admin/cinema/earnings?month=YYYY-MM` is the Operator read of Unlock credits and Pass seconds per title, behind the same identity, fresh-MFA and Cloudflare Access gates as the creator review queue, with `is_admin` re-checked in the database. Nothing is paid out; a creator revenue share is its own ADR.

## Publication increment (ADR-0059)

Migration 0147 adds submissions, reviews and moderation actions. A creator submits a title from the workspace with the Rights Declaration (`rights-2026-09-26`) once every episode's video is ready; `/app/admin/cinema/submissions` is the queue, behind the same fresh-MFA and Cloudflare Access gate as creator applications, with approve, reject-with-note and suspend. Withdrawal and suspension of a published title reverse its Unlocks in the same transaction. `/api/cinema/titles` and `/api/cinema/titles/{id}` are the anonymous, cached public reads; `/api/v1/cinema/titles/{id}` is the signed-in variant with per-episode access. `/social-cinema` shows the catalogue, `/social-cinema/title/{id}` the seasons and episodes with Free, Unlock and Pass, and `/social-cinema/watch/{id}` the Stream player with token renewal and heartbeats. Switches: `CINEMA_PUBLISHING_ENABLED`, `CINEMA_VIEWING_ENABLED`, both off. `frame-src` now admits `https://*.cloudflarestream.com`.
