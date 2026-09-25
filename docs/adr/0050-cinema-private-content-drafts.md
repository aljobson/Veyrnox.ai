# ADR-0050 — Private Cinema content drafts

Status: Proposed, 25 September 2026. Extends ADR-0049 and the mandatory Cinema security overlay.

## Decision

Add a creator workspace at `/social-cinema/creator`. Approved active creators can create private films, shorts, trailers and series; each series contains seasons, each season episodes. Reuse existing Button, visual tokens, native form controls, verified gateway and account boundary. 21st search was consulted; existing primitives fit this small workspace without another dependency.

Migration 0134 adds `cinema_content` with creator ownership, hierarchical parent/position, title, synopsis, language, structured AI disclosures and revision. This increment is deliberately draft-only: database constraints fix `DRAFT` and `PRIVATE`. There is no upload grant, publication transition, public catalogue, rights approval, money or external media URL. Versioned rights declarations require approved agreement text and belong with the later submission workflow; checking an AI disclosure does not confer rights.

Hierarchy is SERIES → SEASON → EPISODE; FILM/SHORT/TRAILER are roots. Composite foreign keys preserve parent ownership, the mutation RPC validates parent type, and positions are unique per parent. Structure is fixed once created; edits change metadata only. Parent/owner lookups are indexed. All content and replay records cascade with profile/account deletion. There is no privileged audit or indefinite evidence retention in this draft store.

## Authorization, concurrency and limits

Forced RLS and revoked table privileges deny direct access, including service-role table reads/writes/truncation. Only two narrow service-callable RPCs are granted. Each checks the existing user and current active Cinema creator role. General administrators, Cinema administrators, moderators, applicants, viewers and inactive creators cannot use the workspace. Neither a successful application nor JWT metadata substitutes for the membership check. Missing and foreign-owned IDs produce the same error.

The save RPC locks membership before replay checks or mutation; revocation and concurrent saves serialize there. Each mutation records the actor/key, exact JSON request and result atomically. Matching replay returns the original receipt without another write, even after later edits. Changed payload/key reuse conflicts. The caller reloads the current list after success. Updates must match the current revision; concurrent edits cannot silently overwrite. Parent/type/number changes conflict. Duplicate positions cannot create duplicate episodes.

Preview storage caps: 100 siblings per parent (including root projects) and 1,000 total content records per creator, enforced under the same lock. Lists return the bounded sibling set; there is no arbitrary all-user listing. These conservative preview limits require reevaluation before larger catalogues. Replay metadata remains private and follows account deletion; draft deletion and mutation compaction are future capabilities.

GET `/api/v1/cinema/content` accepts only an optional UUID `parent_id`. POST creates; PATCH requires `id` and positive `revision`. Both require UUID `Idempotency-Key`, bounded JSON and the exact fields `content_type`, `parent_id`, `position`, `title`, `synopsis`, `language`, `ai_disclosures`. Unknown ownership, state, visibility, provider and money fields are rejected by both HTTP and SQL. Every request uses the shared durable 120/minute account quota. Errors are typed, responses no-store, and logs contain generated request ID/actor/action/status/code without titles, synopses, tokens or provider details.

## Rollout and verification

`CREATOR_CONTENT_ENABLED` is default false and also requires `CINEMA_ENABLED` and `SOCIAL_CINEMA_PROFILES_ENABLED`. It does not depend on the application intake flag: existing approved creators remain distinct from new applications. UI preview additionally requires `localStorage.veyrnox_social_cinema`. These flags grant no role. Profile preview links approved creators to the workspace. All production flags remain false.

Apply only via the approved production migration workflow after main/open-PR numbering checks. Keep activation gated on the 24-hour clean reconciliation requirement, authenticated preview/identity-switch evidence and the applicable security gaps. No approver role is provisioned here. Rollback disables the content flag; never rewrite an applied migration or delete user data.

Unit tests exercise strict input/query validation, quota/flag/auth denials, ownership argument binding, private responses, typed conflicts and redaction. The isolated real Postgres test replays migration twice and covers hierarchy, cross-creator attacks, role/status revocation, idempotency, concurrent number claims/edits, limits, table/function grants, forced RLS, account deletion and unchanged credit balances. CI executes it after the creator/foundation regressions.

PR security record: new boundary is creator-owned private content. Untrusted inputs are metadata and IDs. No external service, new runtime dependency or money change. G01/G02/G04/G11 and threats T01/T02/T03 gain scoped negative coverage. G05 scanning, G08 live auth, G09 operational logging and G10 retention review remain launch work. Publication, rights, upload and media-safety gates remain unimplemented. No full ASVS compliance claim.
