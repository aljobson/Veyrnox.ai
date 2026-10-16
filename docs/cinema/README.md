# Veyrnox Cinema implementation

> **Flag values:** every flag state in this document is as of 2026-10-16. `wrangler.jsonc` is the source of truth (top-level `vars` is production, `env.staging` is staging); where this document and that file disagree, the file is right.

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
- Later increments below: uploads, publication, viewer paywall, community votes/comments/story polls, discovery, weighted rankings, private collections, creator audience insights and the quarantine/moderation gate.

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
| CINEMA_FREE_CEILING_ENABLED | Master |
| CINEMA_PUBLISHING_ENABLED | Master + profiles + content |
| CINEMA_VIEWING_ENABLED | Master |
| CREATOR_MONETISATION_ENABLED | Master + profiles + subscriptions |
| VOTING_ENABLED | Master + profiles |
| CINEMA_AUDIENCE_ENABLED | Master + profiles + viewing |
| CINEMA_RANKINGS_ENABLED | Master + profiles + viewing + voting |
| CINEMA_RETENTION_ENABLED | Master + profiles + viewing |
| CINEMA_CREATOR_ANALYTICS_ENABLED | Master + profiles + content + viewing + audience |
| COMMENTS_ENABLED | Master + profiles |
| STORY_POLLS_ENABLED | Master + profiles |
| PPV_ENABLED | Master + profiles + subscriptions + monetisation |
| PREMIERES_ENABLED | Master + profiles + uploads |
| AI_RECOMMENDATIONS_ENABLED | Master |

(`lib/cinema/features.js` is the source of this table.) Three more switches sit outside it and are read by the upload code: `CINEMA_PROXY_UPLOADS_ENABLED` (browser device uploads), `CINEMA_UPLOAD_RECOVERY_ENABLED` and `CINEMA_UPLOAD_REMOVAL_ENABLED`.

Profile, creator-application, private-content and every later endpoint consume their respective controls. A control that is on does not mean the whole feature is finished; check the increment below. Every route must check its applicable server control before side effects, then independently verify identity, role, account status and ownership. Feature flags grant no privileges.

Production state in `wrangler.jsonc` (2026-10-16): on are the master, profiles, creator applications, creator content, creator uploads, upload recovery and removal, publishing, viewing and the free-viewing ceiling. Off are device uploads (`CINEMA_PROXY_UPLOADS_ENABLED`, until a quarantine path covers them), paid Unlocks, the Cinema Pass, creator monetisation, voting, audience capture, rankings, retention, creator analytics, comments, story polls, pay-per-view, premieres and recommendations. Staging differs only in `CINEMA_UNLOCKS_ENABLED`, which is on. Profile preview additionally requires `localStorage.veyrnox_social_cinema = 'true'` for pages that are still preview-gated.

## Remaining

Creator cash ledger and Connect payouts; pay-per-view and premieres; personalised recommendations; the dedicated child-safety provider and activation of content moderation; device and cloud-drive imports through quarantine (`cloud-import-plan.md`: adapters only); live acceptance of the community, ranking and analytics features, which are built but off. No real films, subscription prices, revenue or payouts are fabricated by the foundation.

Provider credentials, rights/age/territory policy and approved commercial settings are needed before the corresponding live features can be activated. See the assessment's explicit risks and decisions.

## Mandatory security overlay

The [security engineering brief](https://chatgpt.com/s/t_6ab644e42ac88191aaa6ea4cf6403e27) applies to every feature PR. The assessment pack is in `docs/cinema/security/`. Close applicable release gaps with implementation and evidence; the final launch review does not replace security work throughout delivery. No ASVS compliance is claimed.

## Creator application increment

ADR-0049 and migration 0133 add private creator applications, a scoped approval queue at `/app/admin/cinema`, fresh TOTP/Access enforcement and immutable review decisions. `CREATOR_APPLICATIONS_ENABLED` is a new default-off child of the master/profile switches. Approval grants creator only; upload/publishing and monetisation remain unavailable. Backend profile status enforcement also rejects non-active Cinema accounts. Refer to the ADR for migration, approver provisioning, preview verification and unresolved launch gates.

## Private content increment

ADR-0050 and migration 0134 add `/social-cinema/creator`: private film/short/trailer drafts and series → seasons → episodes, with metadata and structured AI disclosures. Current active creator membership is mandatory. Updates require the current revision; retries are idempotent. `CREATOR_CONTENT_ENABLED` stays false. Upload, rights clearance, review and publication remain later steps; no content is exposed publicly.

## Stream upload increment

ADR-0052 and migration 0137 add bounded creator upload reservations, direct resumable transfers, private processing status and verified Stream callbacks. Creator workspace video controls use existing draft ownership. All flags remain off. Live Stream credentials/testing, provider cleanup/replacement, rights and moderation remain launch gates; encoding success never publishes a draft.

## Library to episode increment (ADR-0052 amendment 1)

Migration 0248 (first merged as 0246, renumbered after a collision with the content-violation migration) and `POST /api/v1/cinema/uploads/from-library` let a creator attach one of their own finished Library videos to a FILM/SHORT/TRAILER/EPISODE draft without downloading and re-uploading it. The body is `{content_id, job_id}` with a UUID `Idempotency-Key`. `reserve_cinema_library_upload` makes the same bounded `cinema_uploads` row as a browser upload (same owner, role, status and capacity checks, same lock), after checking that the job is the caller's, `STORED`, a video and not expired; the fingerprint is a hash of the job id, so a replay for the same draft and job returns the existing row and a different job is `upload_exists`. Only the request that claimed the row calls Stream: the handler presigns the R2 object for 15 minutes and hands that link to Stream's upload-via-link API (`/stream/copy`, `requireSignedURLs`), then `attach_cinema_library_upload` records the UID and puts the row straight into `processing`. No upload URL exists for it, so the transfer routes refuse it; the webhook, Refresh status and the recovery sweep carry it to `ready` or `error` as they do a browser upload, and `ready` still never publishes. The row's `source_job_id` records where the video came from and the API returns it as `upload.source_job_id`. Same switches as uploads (`CREATOR_UPLOADS_ENABLED`, `CINEMA_PROXY_UPLOADS_ENABLED` hold), no new flag. The creator workspace shows a **From Library** button beside Upload video that lists finished videos through the shared Library picker.

## Viewer paywall increment (Phase 1)

ADR-0057 and migration 0142 add Free Episodes and Episode Unlock, modelled on ReelShort. Shorts and trailers are free, the first five episodes of a series are free, and every other episode or film costs 6 credits, taken from the existing balance by `ledger_unlock` (Free Credits first, Frozen accounts denied, replay-safe). `cinema_prices` is the only source of the numbers. `GET /api/v1/cinema/entitlement`, `POST /api/v1/cinema/unlocks` and `POST /api/v1/cinema/play` sit behind the new default-off `CINEMA_UNLOCKS_ENABLED` child switch. Playback tokens are RS256 Stream JWTs bound to one video and valid for 15 minutes, signed with `CINEMA_STREAM_SIGNING_KEY_ID` + `CINEMA_STREAM_SIGNING_JWK` (secret) for `CINEMA_STREAM_CUSTOMER_CODE`; the player host is not yet in CSP. `reverse_cinema_unlocks` is the Operator suspension reversal. `cinema_content` now admits `PUBLISHED`/`PUBLIC` but nothing writes them: the publication slice (own ADR) is still the gate before any viewer sees or pays for anything. Cinema Pass (Phase 2) is not built.

## Cinema Pass increment (Phase 2)

ADR-0057 and migration 0143 add the Cinema Pass: recurring Stripe subscriptions, as first built at $14.99 weekly ($11.99 first week, once per account, decided by `start_cinema_pass`), $49.99 monthly and $199.99 yearly (replaced by 0244, below), priced from `cinema_pass_plans` and sold through Checkout in subscription mode with inline recurring `price_data` and a deterministic once-only Coupon for the intro. A Pass grants viewing only: `cinema_entitlement` now answers `pass` for a live Pass whose period end is in the future, and no Pass path writes a ledger row. `/api/v1/cinema/pass` (read/start), `/pass/plans`, `/pass/return` (records the session and applies the subscription Stripe already shows, so a lost webhook cannot lose a paid Pass), `/pass/cancel` (within 14 days: cancel now and refund the unused share pro rata; after: stop renewing at the period end) and `/pass/portal` sit behind `CINEMA_SUBSCRIPTIONS_ENABLED` (off in production). The Stripe webhook handles `customer.subscription.*`, `invoice.paid` and `invoice.payment_failed` by re-reading the subscription; a `charge.refunded` on a subscription invoice ends the Pass, and a `charge.dispute.created` whose charge is on an invoice ends it and Freezes the account. `/social-cinema/pass` is the page, visible only with the `veyrnox_social_cinema` preview flag. Phase 3 (Pass plays and the 3,000-minute ceiling) is not built.

## Pass Plays increment (Phase 3)

ADR-0057 and migration 0144 add Pass Plays: `POST /api/v1/cinema/play/heartbeat` records up to 60 seconds per call for a viewer whose access to the title is `pass` (free, unlocked and locked viewing record nothing), a Pass can never log more seconds than wall-clock time, and `cinema_prices.pass_ceiling_minutes` (3,000) is now enforced: at the ceiling `cinema_entitlement` answers `locked` with reason `pass_ceiling` and the unlock price, so the viewer can still pay per episode. `GET /api/v1/admin/cinema/earnings?month=YYYY-MM` is the Operator read of Unlock credits and Pass seconds per title, behind the same identity, fresh-MFA and Cloudflare Access gates as the creator review queue, with `is_admin` re-checked in the database. Nothing is paid out; a creator revenue share is its own ADR.

ADR-0057's amendment of 2026-10-10 is proposed, and migration 0244 is applied to production and staging (2026-10-10): it sets the monthly Pass to $9.99, withdraws the weekly and yearly plans (`active = false`, so they are no longer listed and cannot be started) and sets `cinema_prices.pass_ceiling_minutes` to 1,500. Applying it is paywall plan P7. The 30% creator share the amendment records has no code.

## Free viewing ceiling (0245)

ADR-0057 and migration 0245 add Free Plays and a monthly ceiling on free viewing, behind `CINEMA_FREE_CEILING_ENABLED` (on for staging and production; 0245 is applied to both databases). An account has `cinema_prices.free_ceiling_minutes` (300 confirmed) of free titles per calendar month, UTC. Granting playback of a free title counts one minute; after that `POST /api/v1/cinema/play/heartbeat` counts seconds with the Pass Play caps (at most 60 a heartbeat, 60 per 55 seconds of wall-clock per account), in the append-only `cinema_free_plays`. At the ceiling entitlement reports `locked` with reason `free_ceiling`, `POST /api/v1/cinema/play` returns 402 with that reason and signs nothing, and the watch page says the month's free viewing limit is reached. When `CINEMA_UNLOCKS_ENABLED` is false, this switch permits only `free` access; paid, previously unlocked and Pass access cannot mint a token, and the Unlock route stays closed. With paid Unlocks on, a Cinema Pass holder past the free ceiling may play the title under the Pass, counted toward the Pass ceiling. No credits move through the free-only path.

## Publication increment (ADR-0059)

Migration 0147 adds submissions, reviews and moderation actions. A creator submits a title from the workspace with the Rights Declaration (`rights-2026-09-26`) once every episode's video is ready; `/app/admin/cinema/submissions` is the queue, behind the same fresh-MFA and Cloudflare Access gate as creator applications, with approve, reject-with-note and suspend. Withdrawal and suspension of a published title reverse its Unlocks in the same transaction. `/api/cinema/titles` and `/api/cinema/titles/{id}` are the anonymous, cached public reads; `/api/v1/cinema/titles/{id}` is the signed-in variant with per-episode access. `/social-cinema` shows the catalogue, `/social-cinema/title/{id}` the seasons and episodes with Free, Unlock and Pass, and `/social-cinema/watch/{id}` the Stream player with token renewal and heartbeats. Switches: `CINEMA_PUBLISHING_ENABLED`, `CINEMA_VIEWING_ENABLED`, both on in production. `frame-src` now admits `https://*.cloudflarestream.com`.

Categories (0149, ADR-0059 addendum): `cinema_categories` holds the fixed genre list; a title carries one or two, required before submission; `GET /api/cinema/titles?category=<slug>` filters the catalogue and every list response carries `categories` for the tabs on `/social-cinema`.

## Financial Operator routes

ADR-0057 and migration 0150 add authenticated POST routes for manual Unlock
Reversals and full refunds of flagged duplicate Cinema Passes. Financial Operator
role, fresh MFA and Cloudflare Access are required. Requests and successful refund
receipts are append-only; retries recover the original result without moving
credits twice or issuing another refund. Existing feature switches remain off.
See [Operator actions and recovery](operator-actions.md) for request shapes and
handling pending, failed or interrupted refunds.

## Community, discovery and insight increments

All of these are built, tested against real Postgres and **off** in production (see the state above). Each has an ADR with its limits; this list only names the pieces.

- **Competition votes and comments** (ADR-0081, migrations 0266 to 0268; `VOTING_ENABLED`, `COMMENTS_ENABLED`): free ballots in administrator-run competitions (at most 31 days), plain-text comments that stay pending until a moderator approves them, reports. Routes `/api/v1/cinema/votes`, `/voting`, `/comments`; anonymous reads `/api/cinema/voting`, `/api/cinema/comments`; moderator pages under `/app/admin/cinema/voting` and `/comments`.
- **Story polls** (ADR-0084, 0270; `STORY_POLLS_ENABLED`): a moderator-curated question on a published episode, two to six answers, one immutable answer per viewer. `/api/v1/cinema/story-polls`, `/story-choices`, anonymous `/api/cinema/story-polls`, moderator page `/app/admin/cinema/story-polls`.
- **Discovery and sharing** (ADR-0085, 0277): the anonymous `/api/cinema/discovery` read behind the Series and Vote tabs of `/social-cinema`, and canonical share links.
- **Audience signals and weighted weekly rankings** (ADR-0087, 0281 and 0282; `CINEMA_AUDIENCE_ENABLED`, `CINEMA_RANKINGS_ENABLED`): conservative watch-range reporting at `/api/v1/cinema/audience`, the `weighted-v1` model (votes 40%, completion 25%, qualified audience 15%, sharing 10%, engagement 10%), moderator-approved snapshots at `/app/admin/cinema/rankings` and the public `/api/cinema/winners`. No cash prizes.
- **Private saved titles and follows** (ADR-0089, 0283; `CINEMA_RETENTION_ENABLED`): `/api/v1/cinema/retention`.
- **Creator audience insights** (ADR-0090, 0284; `CINEMA_CREATOR_ANALYTICS_ENABLED`): `/api/v1/cinema/creator-analytics`, aggregate metrics for the last 28 completed UTC days, withheld below five qualified viewers.
- **Safety gate** (migrations 0294, 0295, 0297; `MODERATION-AND-MALWARE-GATE.md`, `services/cinema-scanner`): a publication lock bound to the file SHA-256, a ClamAV quarantine for Library videos, and a Claude-assisted content classifier that is installed off (`upload_content_required = false`, `CINEMA_CONTENT_MODERATOR_ENABLED=false`).
