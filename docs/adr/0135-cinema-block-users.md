# ADR-0135 — Cinema: blocking another member

**Status:** Accepted 2026-10-18 (slice S10 of `docs/mobile/PLAN-2026-10-18.md`)
**Related:** [ADR-0129](0129-mobile-ugc-report-and-block.md) (point 2 is replaced by this), [ADR-0110](0110-mobile-account-and-safety.md), [ADR-0111](0111-account-deletion.md); Apple App Review Guideline 1.2

## Context

Apple 1.2 asks for a way to block abusive users wherever other people's content appears. The web product has Cinema comments (`COMMENTS_ENABLED`) and titles that carry the creator's username. ADR-0129 left block out because the phone showed no comments; Cinema comments on iOS wait for this slice.

## Decisions

1. **A block is a per-person list.** Table `public.user_blocks(blocker_id, blocked_id, created_at)`, primary key on the pair, a check that the two differ, both ids reference `public.users` with `ON DELETE CASCADE`. RLS is enabled and forced, there is no policy and no grant to any role. Migration `0353`.
2. **Writes only through three `SECURITY DEFINER` functions** (`SET search_path = ''`, explicit `REVOKE` from `PUBLIC, anon, authenticated`, `GRANT EXECUTE` to `service_role`): `block_cinema_user(auth_id, username)`, `unblock_cinema_user(auth_id, username)` and `list_blocked_cinema_users(auth_id)`. The caller names a member by **username** (the public handle the app already shows), never by internal id. A person cannot block themself, cannot hold more than 500 blocks, and a blocker needs only an account, not a Cinema profile.
3. **Idempotent by key.** The pair is the key. Blocking someone already blocked, or unblocking someone not blocked, changes nothing and answers `already: true`. No idempotency header is needed.
4. **Filtering.** `read_cinema_comments` (same signature, one added predicate) leaves out approved comments written by anyone the signed-in reader blocked. The signed-in titles list (`GET /api/v1/cinema/titles`) leaves out titles by blocked creators; its paging cursor is still taken from the unfiltered page so paging advances. The anonymous routes under `/api/cinema/*` have no reader and never filter, which keeps their public cache valid. A block is one-way: the blocked member still sees the blocker's public comments (no tipping off).
5. **Mute is not built.** Block is what the review guideline names; mute would be the same table with a second column and can wait for demand.
6. **Account deletion.** A trigger on `users.deleted_at` deletes every block row the erased account made or received (same pattern as push tokens, ADR-0113). `scripts/test-account-deletion.mjs` classifies `user_blocks` as erased.
7. **No new flag.** The routes answer 503 `viewing_not_open` unless `CINEMA_VIEWING_ENABLED` is `"true"`, like the other signed-in Cinema routes. Production vars are at the binding cap, so no variable was added.
8. **Reporting is unchanged.** `POST /api/v1/reports` (titles, creations) and the comment `report` action stay the way to tell the operator about content. A block hides content from one person; a report asks us to act for everyone.

## Routes for the mobile session

All under `/api/v1`, Bearer-authenticated, `Cache-Control: no-store`, rate limited with the account read limit (429 + `Retry-After`).

| Call | Body | Answer |
|---|---|---|
| `GET /api/v1/cinema/blocks` | none | `200 {blocks: [{username, display_name, created_at}]}`, newest first |
| `POST /api/v1/cinema/blocks` | `{"username": "<handle>"}` | `201 {username, blocked: true, already: false}`; replay `200 … already: true` |
| `DELETE /api/v1/cinema/blocks/:username` | none | `200 {username, blocked: false, already}` |

Errors (`{error: code}`): `invalid_body` / `invalid_username` 400, `cannot_block_self` 400, `user_not_found` 404, `account_not_found` 403, `block_limit` 409, `rate_limited` 429, `viewing_not_open` and `temporarily_unavailable` 503. Usernames match `^[a-z][a-z0-9_]{2,29}$`.

Where the app gets a username: comments (`GET /api/v1/cinema/comments`) and titles (`GET /api/v1/cinema/titles`) both return `username` per item. Suggested UI: "Block <display name>" on each comment and on a title screen, a "Blocked members" list on Account using the GET, and Unblock there. After a block the app should refetch the comments or titles it shows; the server already omits the blocked member.

## Consequences

- Cinema comments on iOS are unblocked once this is on `main` and migration `0353` is applied through the `apply-migrations` workflow (owner approval; not applied by this change).
- The table is private to the Worker. The `/rest/v1` surface does not grow (`scripts/test-default-privileges.mjs` unchanged).
- Tests: `tests/cinemaBlocksApi.test.mjs` (routes, replay, errors, titles filter) and `scripts/test-cinema-blocks.mjs` (database: replay, filtering both ways, idempotency, access control for `anon`, `authenticated` and `service_role`, deletion cascade), added to `ledger-tests.yml`.
