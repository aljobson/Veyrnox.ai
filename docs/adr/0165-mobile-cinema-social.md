# ADR-0165: Mobile Cinema social layer (parity P6, viewer slice 2)

**Status:** Proposed 2026-10-19. Second viewer slice, built on ADR-0151. Every switch below is **off in production**; the phone ships the screens dark.

## Decision

| Screen | Route | Switch | Closed answer |
|--------|-------|--------|---------------|
| Saved, Following (creators, series) tabs | `GET/POST /api/v1/cinema/retention` | `retention` (needs profiles and viewing) | 503 `retention_not_open` |
| Save, Follow creator, Follow series on a title | same, `?content_id=` for the state | same | buttons hidden |
| Winners tab | anonymous `GET /api/cinema/winners` | `rankings` (needs voting) | 503 `rankings_not_open` |
| Voting on a title | `GET /api/v1/cinema/voting?content_id=`, `POST /api/v1/cinema/votes` | `voting` | 503 `voting_not_open`, block hidden |
| Story polls on a title | `GET /api/v1/cinema/story-polls?content_id=`, `POST /api/v1/cinema/story-choices` | `storyPolls` | 503 `story_polls_not_open`, block hidden |
| Withdraw own comment | `POST /api/v1/cinema/comments` `{action:'withdraw'}` | `comments` | existing "not open" message |

- **A closed switch is an answer, not an error.** The tabs show a one-line closed message; the title-page blocks (voting, polls, save and follow) disappear rather than add clutter. A failed read says so and offers a retry.
- **The server decides.** The phone hides a Vote button only when the competition's window is plainly over; every other refusal (already voted, capacity, profile required, ended) is a catalogue message from the typed error.
- Each write sends a fresh `Idempotency-Key`; a story choice is final and the screen says so before the tap. Withdrawing a comment asks first.
- Strings: `cinemaSocial.*` and `comments.withdraw*` in the English file and `docs/mobile/I18N-NEW-KEYS.md`.

## Gaps for the server or the owner

- Staging may not yet carry these switches (the staging deploy of ADR-0145 may be pending), so on staging these screens can also show the closed state.
- Voting needs the viewer to have a Cinema profile; the phone has no profile screen (creator and profile tools are out of this wave), so a viewer without one gets "You need a Cinema profile".

## Not proved

Jest and the mock only. No run against a server with the switches on; the shapes come from the route source. No device.

## Slice 3 addendum: share signal, My List, Continue watching

- A completed share from a title page posts `{action:'share', content_id, kind:'share'}` to `POST /api/v1/cinema/audience` (`audience` switch, off in production). It is best effort and silent: a closed switch, no connection or no profile is no signal and never affects the share. Dismissing the sheet records nothing; `kind:'copy'` has no phone path because the share sheet does not say a copy happened.
- **My List** is the Saved tab: the retention routes have one saved list per person and the web calls it Saved, so there is no separate My List.
- **Continue watching is not built.** The retention routes hold saved titles and follows only, and the audience route accepts watch progress but has no read path, so the server has nothing to resume from. It needs a read route for a person's progress (a server change, not made here); until then the phone's own resume is the playback screen's.
