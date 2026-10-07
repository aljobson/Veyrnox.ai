# Publish staging acceptance — 7 October 2026

Staging only: `veyrnox-ai-staging`, Supabase `yrqzwqywxfesmbvhzjgj`.
The connected YouTube channel remains `jobsonal1`.

## Real publication

The owner-approved video was queued on 7 October at 20:30:09 UTC and
published at 20:40:50 UTC. The public video was opened and played successfully:
[Veyrnox.ai publishing test](https://www.youtube.com/watch?v=GphiOYqr6fQ).
Post ID: `8d0998cd-1e04-455b-bede-99d107a44432`. Do not resubmit it.
This supersedes the earlier handover's unverified YouTube publication statements.

## Calendar

Acceptance used 103 disposable posts, keyed `calaccept_20261007_%`, with zero
media: one future scheduled fixture and 102 canceled rows sharing a timestamp.

- Dragging proposed the correct new day without saving before confirmation.
  Drag confirmation/save was not completed; explicit reschedule saves were.
- The browser rejected a save after a target changed to failed, showing the
  conflict message and leaving the schedule unchanged.
- A rollback-only staging RPC test verified parent and both pending target
  timestamps moved together. This does not verify multi-network publication.
- A browser save after London's autumn transition stored 13:00 UTC for 13:00
  local time. The spring gap (28 March 2027 at 01:30) was rejected. The repeated
  autumn hour (25 October 2026 at 01:30) selected the earlier occurrence,
  00:30 UTC, and saved both parent and pending target timestamps.
- Pagination reproduced a deployed 400 `invalid_range` with PostgreSQL's
  `+00:00` cursor. Rewriting that diagnostic GET cursor to UTC `Z` returned the
  remaining two rows. The API fix emits `Z`, preserving microsecond precision;
  the timestamp/UUID pair and strict request validation remain intact.

Unmodified deployed pagination then passed: first page 100 rows, second page
HTTP 200 with two rows and no next cursor, 102 distinct fixture captions in
the UI and no errors. Staging version: `dda51098-1320-47b7-adfb-a0df94348470`.
All 103 fixtures and their one remaining pending target were removed after
checks for ownership, zero media, zero attempts, no claims or provider IDs.
The append-only audit was retained and a cleanup event appended. The real
published video and connected YouTube account were preserved.

Validation: 1,626 unit tests pass (one skipped), five calendar route tests pass,
lint/typecheck/OpenNext staging build and Wrangler dry run pass. Deployment
preserved all 33 live plain variables and 30 secret bindings.
Active-worker lock contention remains unverified live; automated coverage exists.
No media or new provider publication was submitted during calendar acceptance.

## Next

Choose an owner-controlled Instagram Business/Creator account for publishing
and analytics acceptance. Keep `jobsonal1` connected until that choice is made.
Instagram insights and TikTok analytics consent scopes still require provider
review before activation. Production Publish activation remains a separate step.
