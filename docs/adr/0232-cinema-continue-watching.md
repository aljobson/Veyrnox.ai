# ADR-0232: Cinema Continue watching (private resume positions)

**Status:** Accepted implementation; activation pending. Flag `CINEMA_WATCH_PROGRESS_ENABLED`, off in both environments.

## Context

The phone app has Saved and Following (ADR-0089) but no Continue watching. No route exposed where a person stopped.
Nothing already stored that: `cinema_watch_events` (0281) holds the seconds of a title that were covered, for audience
analytics, and is optional, unioned across replays, and closed to every role; the heartbeat and `cinema_pass_plays`
(0144) hold wall-clock seconds for metering only. Coverage and metering are not a resume point, and neither may become
one without turning a private convenience into a ranking or billing input.

## Decision

Migration 0355 adds `cinema_watch_resume`, one row per person and title: position, the real duration, a completed flag
and the time of the last write. Forced RLS, no policy, and every browser and service role is revoked. Three
service-only SECURITY DEFINER RPCs (`search_path=''`) take the middleware-verified Supabase subject; a caller never
supplies an owner.

- `save_cinema_watch_resume`: an absolute last-write-wins upsert, so a replay changes nothing and needs no idempotency
  key. It rechecks the actor, that the title is public and its media ready, and entitlement (free, unlocked or Pass,
  the same test as starting a watch session). Duration comes from the media row, never the client; position clamps to
  it; 95% or more marks the title completed. A title written again within 10 seconds keeps its stored value and
  answers `recorded:false`. With the 10 second floor and a cap of 20 other titles changed in a minute, a person writes at most 120 times a minute. A trigger
  keeps at most 200 titles per person, dropping the oldest.
- `list_cinema_watch_resume`: the caller's own unfinished titles, newest first, 20 per page (max 40), stable cursor on
  content id. Public visibility, ready media and entitlement are rechecked on every read, so withdrawal, a suspended
  creator or a lapsed Pass remove the row from the projection at once.
- `remove_cinema_watch_resume`: dismiss a row; removing an absent row gives the same answer.

Route `/api/v1/cinema/progress` (inside the gate, Bearer only, `no-store`):
`GET ?limit&before_id`, `PUT {content_id, position_seconds}`, `DELETE ?content_id=`. Exact-key JSON, UUID and range
checks at the boundary, typed kebab-case errors, `consume_account_read_request` on every call. Unauthenticated is 401
before the flag; flag off is 503 `watch_progress_not_open` with no database call.

No ledger or credit write, no refund path, no audience signal, ranking or analytics input. The positions never leave the
person's own reads. A trigger on `users.deleted_at` erases the rows with the account (ADR-0111;
`scripts/test-account-deletion.mjs` lists the table as erased).

## Flag

`watchProgress` in `CINEMA_RUNTIME_FLAGS` (`CINEMA_WATCH_PROGRESS_ENABLED` as a separate override), absent from
`CINEMA_RUNTIME_FLAGS` in production and staging, which is off (the grouped-flags test allows only approved keys). It also needs `CINEMA_ENABLED`, profiles and viewing. Activation needs the migration applied
by the `apply-migrations` workflow after owner approval, then a real-account check: play, leave at a position, reload and
resume, a second account seeing nothing, a completed title leaving the list, and a withdrawn title disappearing.

## Phone

List: `GET /api/v1/cinema/progress?limit=20`. While playing: `PUT` about every 15 seconds and on pause or background.
Dismiss: `DELETE`. Resume: `POST /api/v1/cinema/play`, then seek to `position_seconds`. The phone is not changed here.

## Consequences

A position is a convenience value a client can set to anything in range for its own row; it is never used for metering,
rankings or creator analytics. Raising the 600-second media ceiling needs a new migration for the duration CHECK.
