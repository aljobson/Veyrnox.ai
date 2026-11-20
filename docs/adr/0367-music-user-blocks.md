# ADR-0367: Music actor identities and user blocks

Status: Proposed (frozen Music P4b-0 work order; switch off)
Date: 2026-11-20

## Context and decision

The phone's user-made Music surfaces need a real block action for Apple App
Review guideline 1.2. A mutable handle or display name cannot identify the
person reliably, and a commenter need not have a creator profile.

Migration `0570_music_user_blocks.sql` adds `music_actors`: one random public
UUID per internal user, shared between their creator and commenter identities.
The public UUID is not the account UUID. Names may change without changing it;
no handle history is exposed. Existing creators and commenters are backfilled
with a replay-safe INSERT. Reads never mint identities. Publishing and comment
submission mint after a successful write, including idempotent replay. The
original write implementations remain in the private schema, with all caller
permissions revoked; public wrappers preserve their validation and receipts.
All read functions remain STABLE. A missing mapping omits only the new field.

`music_user_blocks` is separate from Cinema's `user_blocks`. Blocking someone
in Music does not silently block them in Cinema, or vice versa. Each person
may block 500 others. An advisory lock in namespace 570 serializes changes;
replaying a block or unblock returns `already: true`. Unknown or erased actor
IDs return `user_not_found`; self blocks return `cannot_block_self`. Minting and
block/unblock take FOR SHARE locks on the relevant users: independent blockers
can proceed together, while prepare_account_deletion / erase_account (FOR UPDATE)
must wait. The per-blocker advisory lock still enforces the cap.

Both tables have enabled and forced RLS, no policies, and no caller table
grants, including service_role. SECURITY DEFINER RPCs have empty search paths,
explicit full-signature revokes, and service_role-only execution grants.

## HTTP contract

Every new route lives inside the existing `/api/v1` gateway. Only the verified
`x-veyrnox-auth-id` identifies the caller. There is no new user-JWT database
surface or routes-outside-the-gate exception. All responses are `no-store`.

| Route | Contract |
| --- | --- |
| `GET /api/v1/music/blocks` | `{blocks:[{actor_id,display_name,created_at}]}` |
| `POST /api/v1/music/blocks` | Exactly `{actor_id}` as bounded JSON; 201 on first block, 200 on replay; `{actor_id,blocked:true,already}` |
| `DELETE /api/v1/music/blocks/:actorId` | 200 `{actor_id,blocked:false,already}` |
| `GET /api/v1/music/explore/best-of` | Filtered `{playlists}` using the existing genre/track projection |
| `GET /api/v1/music/explore/tracks/:slug` | Public track projection, filtered rails and comments, plus the existing switched extras |
| `GET /api/v1/music/explore/creators/:handle` | Public profile and tracks, unless its creator is blocked |

A blocked track or profile returns HTTP 200 with exactly
`{blocked:{creator_id,display_name}}`; it contains no track, profile, comments,
lyrics, counts or rails. The phone can display its blocked-creator state and
unblock using `creator_id`. An unblock restores normal reads. Blocks belong to
the viewer only; another viewer and the blocked creator's own view are unaffected.

Block errors: `not_authenticated` 401, `blocks_unavailable` 404,
`invalid_actor_id` 400, `user_not_found` 404, `cannot_block_self` 400,
`block_limit` 409 and `account_not_found` 403. Boundary errors include
`invalid_body` 400 (413 for oversized JSON), `invalid_content_type` 415 and
`invalid_query` 400. Block routes and explore mirrors use
`consume_account_read_request`; denial is 429 with `Retry-After: 60`.
The authenticated comments route also maps viewer RPC `USER_NOT_FOUND` to
403 `account_not_found`, matching block and explore account failures.
Unexpected RPC failures return `temporarily_unavailable` 503 without DB details.

Anonymous routes and their RPC signatures remain unchanged, apart from optional
`creator_id` on track/profile/rails/best-of rows. Only
`music_comments_read_for_viewer` emits comment `author_id`; the anonymous RPC
and JS projection omit it. JS projections validate UUID strings before exposing
these fields.
Authenticated comments select `music_comments_read_for_viewer` when blocks is
on; filtering happens before pagination, while own pending/rejected rows stay
unchanged. Mirrors use viewer RPCs and fail closed on filtering errors. Rails
and best-of filter the existing bounded public result; they do not refill slots
from lower-ranked tracks. A blocked profile returns the blocked state instead
of its entire track list. Comments expose no totals requiring adjustment.

## Rollout and rollback

`blocks` is a key inside the existing `MUSIC_RUNTIME_FLAGS` binding. It ships
false in production and staging; absence also means off. No binding is added.
While off, block routes and the new explore mirrors return
`blocks_unavailable`; the existing authenticated comments route uses its
original unfiltered read. Additive opaque IDs may be present in either state.

The owner applies migration 0570 through the approved apply-migrations workflow,
then flips `blocks`, then ships the phone P4b slice. This change does none of
those operations. Turning the key off closes the new surfaces without deleting
block preferences. The web UI is unchanged and continues using anonymous reads.

## Privacy, erasure and exclusions

A stable commenter id enables cross-track linkability even when it is opaque.
Anonymous comment responses therefore omit `author_id`; only authenticated
viewer reads expose it for blocking. Signed-in viewers can correlate those
comments, including with that person's creator identity. Creator ids remain
public because creator pages are already public by handle.

`music_actors.user_id` uses ON DELETE RESTRICT like creator profiles. Normal
account deletion is a tombstone, not a physical user deletion. The erasure
trigger deletes the mapping and blocks in both directions. The deletion guard
excludes these two tables so block preferences alone cannot prevent erasure;
existing Music content blockers remain intact. Minting rejects erased users,
and migration replay does not recreate their mappings.

The generic privacy export currently has no Music section. The new tables are
explicitly NOT_EXPORTED alongside existing Music follows/comments, with that
exclusion documented in `scripts/test-privacy-export.mjs`. The person's own
block preferences are available through the list RPC. Both tables are classified
as erased in `scripts/test-account-deletion.mjs`.

Report moderation already exists. This slice does not change reports, reply
thread handling beneath a blocked comment, push/notification suppression,
Cinema behavior, the web UI, mobile code, assets, or money operations.

## Verification and numbering

`node --test tests/musicBlocks*.test.mjs` covers HTTP boundaries, switch behavior,
RPC selection, projection allowlists and migration invariants. The real database
suite is `packages/db/music-blocks.acceptance.test.ts`; run it with the repository's
existing tsx/pg tooling against a disposable local PostgreSQL (CI uses PG16),
through `~/.local/bin/with-build-slot`, with one test worker. It requires CREATEDB
and creates one fresh temporary database, initializes it only through
`scripts/replay-migrations.mjs` (which includes the base schema), then drops it
even on failure. Running `migrate.mjs` first is incorrect: replay would try to
create the base schema again. CI excludes this suite from the migrate-base glob
and runs it once beside music-pair/music-long-song in the replay-database step.
The bootstrap still creates its own database even when DATABASE_URL points at
`rebuild_check`, costing one additional full replay and temporary database.
Budget roughly 100–300 MiB of temporary database storage; no package or native build installation is required. This
isolates both a migrate-only base and a fully replayed host from historical
migration replacements. It verifies real read-only transactions as the allowed
substitute for a local PostgREST server, plus `pg_proc.provolatile`, replay,
identity stability, filtering, limits, idempotency, erasure and privileges.

Also run `scripts/test-default-privileges.mjs`, `scripts/test-account-deletion.mjs`
and `scripts/test-privacy-export.mjs` against the full local replay, the route-gate
and identity-header Node tests, ADR validation and the Vey knowledge check.

0570 and 0367 were free across locally available Git refs. The implementation
environment could not resolve github.com, so current remote branches and open
PRs must be checked independently before these numbers are finalized.
