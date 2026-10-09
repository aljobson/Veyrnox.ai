# Publish staging acceptance — 7 October 2026

Staging only: `veyrnox-ai-staging`, Supabase `yrqzwqywxfesmbvhzjgj`.
The connected YouTube channel remains `jobsonal1`.

## Real publication

The owner-approved video was queued on 7 October at 20:30:09 UTC and
published at 20:40:50 UTC. The public video was opened and played successfully:
[Veyrnox.ai publishing test](https://www.youtube.com/watch?v=GphiOYqr6fQ).
Post ID: `8d0998cd-1e04-455b-bede-99d107a44432`. Do not resubmit it.
This supersedes the earlier handover's unverified YouTube publication statements.

## Real video analytics

The previous snapshot predated publication. The connected staging account's
next analytics refresh was brought forward, with an append-only request audit.
The normal scheduled worker successfully fetched the video at 22:05:44 UTC:
`GphiOYqr6fQ`, one view, zero likes and zero comments. These values were verified
in both stored metrics and the signed-in dashboard's seven-day video table.
The dashboard also showed one public video and two subscribers; the separately
reported channel view total was still zero. Do not infer immediate agreement
between channel and video totals. No new publication or reconnection was needed.
The account returned to its normal six-hour refresh cadence with no sync error.

## Calendar

Acceptance used 103 disposable posts, keyed `calaccept_20261007_%`, with zero
media: one future scheduled fixture and 102 canceled rows sharing a timestamp.

- Dragging proposed the correct new day without saving before confirmation.
  A follow-up live drag/save test used one additional zero-media fixture,
  `caldrag_20261007_confirmation`, on the narrow browser viewport. Dragging
  Monday 12 October to Tuesday 13 October proposed 13:00 local / 12:00 UTC.
  Before confirmation, parent and target remained at 12 October, with no
  reschedule event. Confirming moved both timestamps to 13 October at 12:00 UTC,
  displayed “Post rescheduled”, and produced exactly one reschedule event.
  Attempts remained zero and the target unclaimed. The fixture and target were
  removed afterward with ownership/dispatch guards and a cleanup audit event.
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
Live target-row contention was then verified using a separate transaction to
hold a lock on one zero-media fixture, `callock_20261007_contention`. The normal
browser save received HTTP 409 `POST_BUSY` and displayed the conflict message.
Parent and target timestamps remained unchanged, attempts stayed zero, and no
additional reschedule audit event was written. The lock was released and the
fixture and target removed with a cleanup audit; no fixture remains. An initial
two-SQL-request attempt ran sequentially and safely rescheduled this fixture;
it did not count as contention evidence. This tests the live locking barrier
with a controlled transaction, not an actual provider dispatch race.
No media or new provider publication was submitted during calendar acceptance.

## Next

Choose an owner-controlled Instagram Business/Creator account for publishing
and analytics acceptance. Keep `jobsonal1` connected until that choice is made.
Instagram insights and TikTok analytics consent scopes still require provider
review before activation. Production Publish activation remains a separate step.
