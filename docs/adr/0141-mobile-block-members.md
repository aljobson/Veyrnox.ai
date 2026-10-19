# ADR-0141 — Mobile: block a Cinema member (slice 5)

**Status:** Proposed 2026-10-19
**Related:** [ADR-0135](0135-cinema-block-users.md) (the server side this calls); [ADR-0129](0129-mobile-ugc-report-and-block.md) (report; its block point is replaced by ADR-0135); [ADR-0110](0110-mobile-account-and-safety.md); Apple App Review Guideline 1.2

## Decision

Block and unblock, per ADR-0135, with no new server route, flag or dependency:

1. **Block** on the Cinema title screen ("Block <creator>"), shown only when the title carries a valid creator username. A confirmation says what happens (their comments and titles stop showing, they are not told) and points to **Report** for telling us instead. A block sends `POST /api/v1/cinema/blocks {username}`; on success the screen goes back, since the server now leaves that creator's titles out.
2. **Blocked members** (Account, Safety), listing `GET /api/v1/cinema/blocks` newest first, each with **Unblock** (confirmed, `DELETE /api/v1/cinema/blocks/<username>`). The list reloads whenever the screen regains focus.
3. Comments get the same Block action in the next slice (Cinema comments), using the same library.

## Choices that matter

- A member is named by **username** (the public handle), validated on the phone with the server's own rule (`^[a-z][a-z0-9_]{2,29}$`) before anything is sent; a title's creator username is kept only when it matches.
- Block is idempotent on the server (`already: true`), so there is no idempotency key and a retry is safe.
- Typed refusals have plain wording: cannot block yourself, member not found, block limit, account not found, rate limited, Cinema not open, offline. Nothing from the server's text is shown.
- Block hides content from one person only. **Report is separate and unchanged** (`POST /api/v1/reports`).

## Proved, and not

Proved on the simulator against the mock server: the Blocked members list (and its reload on focus); the Block button on a Cinema title, its confirmation, the block reaching the mock and the screen returning; Unblock with its confirmation, the delete reaching the mock, and the "is unblocked" note. 21 new tests (username rule, parsing, every call and error mapping, creator username on titles).

Not proved: any real server; migration 0353 on a real database (the planning session reports it applied to production, which I did not check); that the server really leaves a blocked creator's titles out of the signed-in list (the mock does not filter, so the app's behaviour after a block was shown only as "goes back"); the real creator field on the title detail beyond what `read_public_cinema_title` returns by name; Android.

## Follow-ups

Cinema comments with Block and Report on each comment (slice 6). Mute is not built, as in ADR-0135.
