# ADR-0352: Music in the mobile app

Status: Proposed (P0 groundwork only; no screen ships with this ADR)
Date: 2026-11-18

## Decision

Bring the web Music product to the phone in phases (plan: `docs/mobile/MUSIC-PLAN-2026-11-18.md`).
P0 adds only `apps/mobile/src/lib/music/`: a typed client over `/api/v1/music/*`, typed seams over
the shared web modules, and a probe-by-call helper. No server route, flag or migration is added.

## Feature switches are probed, not read

`lib/musicRuntime.js` evaluates `MUSIC_RUNTIME_FLAGS` inside each route; no route returns the flag
set, and the Worker is at its binding cap, so none is added. The phone calls and reads the answer:
a 404 whose code is `music_unavailable`, `music_library_unavailable`, `music_library_tabs_unavailable`,
`music_remix_unavailable` (or any `music_*_unavailable`) means the feature is off. `probeMusic()`
turns that into `{ state: 'off' }` and never throws. A 404 `not_found` (missing song or hook) and every
other failure is `{ state: 'error' }`, never "off". Each screen needs an off empty state and a
test with a mocked 404.

## Client surface (shapes read from the route handlers)

`entitlements` (GET), `library-tabs` (GET `?tab=history|hooks|covers`; POST `listen`), `songs` (GET list),
`songs/:id` (GET detail with a server-built `actions` list; PATCH `trash`/`restore` with a revision),
`generation-quotes` (POST, 201), `generations` (POST, 202 new or 200 replay). Responses are validated
at the boundary and answer `bad_response` when malformed. Create is quote, then confirm: the same
idempotency key is reused on every retry, so a replay charges once; 503 `pair_acceptance_unknown`
means replay that key.

## Shared modules

`musicLibraryTabs`, `musicLyrics`, `musicPlaylists`, `musicTempoControls`, `musicRemix` and
`musicWavRender` are imported through `src/lib/music/shared.ts` (as `instrumentShared.ts` does for
instruments). Only pure parsers and constants are used. The `*Enabled` helpers read server env and
are always false on a phone; the phone must never call them. The seam bundles under Metro for iOS and
Android, and the web Node tests are unchanged.

## Rules kept

Credits follow the store-only rule; Music spends credits only, with no web link-out. A price is
shown before any spend (quote first). Features that are off in production (`beatCloud`,
`beatLibrarySave`, `magicBar`, `references`, mixdown) get no screen until their switch is on.

## Not decided here

Beat editor shape (web view or native), decided after Spike B1. Phases P1 to P5 each need their own
amendment.

## Verification

Jest with mocked responses including the off case; request bodies are checked against the server's own
`parseMusicQuote` and `parseMusicGeneration`. Not yet proved against staging: the phone's token on
the music routes, and each parser against a live answer.

## P1 amendment (2026-11-18)

P1 adds the phone library and a foreground-only player. Playback resolves a signed asset URL,
pauses on app background or screen exit, and releases the native player. Native background/lock-screen
configuration is unchanged. Preview crops and saved hooks play only their saved bounds; canonical
renders start at zero. Song versions are display-only (their payload has no job id).

There is no server cursor: Songs shows at most the newest 50 with refresh and, when the library
probe permits it, search. True paging needs a server cursor. Hooks/covers writes remain deferred.
Share tokens are chosen by the client (32 random bytes, base64url). An ambiguous share failure
retries the identical song/version/token/idempotency-key tuple. Listen, reversible trash/restore,
and share create/revoke send no content to AI providers and spend no credits.

## P2 amendment (2026-11-18)

The native create screen offers simple instrumental prompts and saved custom drafts, then a
separate quote and confirm step. Quotes show candidate cost, total cost, balance after spending,
and expiry. Confirm uses the authenticated client's real consent and hard-paywall guards.
Credits remain store-only: this screen spends existing credits and offers no purchase or web link.
Locked models, insufficient balance and occupied concurrency slots block new submissions.

A memory-only account session retains one quote, immutable submitted input and idempotency key.
An ambiguous confirmation survives screen remounts and quote expiry; Check the result replays
that key through the same guards. A definitive rejection clears it, while network failures,
429s and server failures preserve it. Edits invalidate unsubmitted quotes and the shared revision
gate discards delayed draft saves and quotes. Draft conflicts offer server or local text explicitly.

The newest twenty accepted generations are tracked in memory, with foreground-only polling,
terminal stop, backoff and an off-state circuit breaker. Replay acknowledgements merge by id.
Candidates use the P1 player, with one player mounted at a time; result lyrics come from the
submitted snapshot. A failed candidate does not claim its refund has completed; refunded does.

Attempts and the queue are lost when the process is killed. The server still owns acceptance,
refunds and library songs. Cross-device concurrency remains enforced by the server. Jest proofs
use mocked clients and fixtures; no real generation is submitted during validation.
