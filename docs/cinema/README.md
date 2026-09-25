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
