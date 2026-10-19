# ADR-0142 — Mobile: Cinema comments with report and block (slice 6)

**Status:** Proposed 2026-10-19
**Related:** [ADR-0081](0081-cinema-community-votes-comments.md) (comments); [ADR-0135](0135-cinema-block-users.md) and [ADR-0141](0141-mobile-block-members.md) (block); [ADR-0129](0129-mobile-ugc-report-and-block.md) (report); Apple App Review Guideline 1.2

## Decision

A **Comments** screen for a Cinema title (`/cinema/comments`, from the title screen), over `GET` and `POST /api/v1/cinema/comments`. No new server route, flag or dependency. It is the last piece of Apple 1.2 for Cinema: user content is shown together with a way to report it and a way to block its author.

1. **Read.** Comments newest first (the server's order), the person's own comments with their review status, and a "Show more" cursor. A blocked author's comments are not returned by the server; the screen also drops them at once after a block.
2. **Write.** One text box, 1 to 2000 characters, with a counter. A new comment waits for review before others see it, and the screen says so. The same text keeps one idempotency key, so a retry after a network error is one comment, not two. The key lives in memory only: it does not survive an app relaunch.
3. **Report** each comment that is not the person's own (`action: "report"`): a category from the server's five and 3 to 500 characters of details, one idempotency key per report. A separate screen, so the wording can say plainly what a report is and that Block is the other option.
4. **Block** the author from each comment, with the confirmation and library from ADR-0141. Offered only when the author's username is valid.

## Choices that matter

- Comment text is plain text, never markup or links. Display names and bodies are bounded.
- The limits on the phone only stop requests the server would certainly refuse; the server stays the authority. Typed refusals have plain wording: no Cinema profile, account not active, comment gone, too many waiting for review, rate limited, conflicting retry, comments not open, offline.
- A person's own comments get no report or block button, and withdrawing a comment is not built.
- New strings are `comments.*` keys, English only, listed in `docs/mobile/I18N-NEW-KEYS.md`.

## Proved, and not

Proved on the simulator against the mock server: the list with Report and Block on each comment, the empty-then-filled own-comments box; a report (category, details, one POST, thanks); a block (confirm, one POST, the author's comment disappears); posting a comment (one POST, the "will appear after review" note and the comment shown as waiting for review). 29 new unit tests (parsing, validation by character count, every call and its headers and body, error mapping).

Not proved: any real server; that the real read returns the field shapes used (taken from `lib/cinema/commentsApi.js`); a Cinema profile requirement on a real account; a title with more than one page of comments; Android; VoiceOver on the new screens.

## Follow-ups

Withdraw a pending comment; Cinema story polls and votes; an a11y pass over the new screens.
