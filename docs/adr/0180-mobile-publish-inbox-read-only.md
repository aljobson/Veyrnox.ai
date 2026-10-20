# ADR-0180 — Mobile: Publish inbox, read-only

**Status:** Proposed 2026-10-19
**Related:** parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4; [ADR-0162](0162-mobile-publish-calendar-analytics-drafts.md) (the Unlock card)

## Decisions

1. **Read first.** `GET /inbox` lists conversations (messages, comments, reviews) from the brand's connected accounts, with counts for open, unread and all. The screen filters by state (Open, Unread, Resolved, All) and kind. `GET /inbox/:id` shows one conversation: its messages (incoming and outgoing, with delivery status), a note when a message carries an attachment, and the team's internal notes.
2. **Third-party text.** What people wrote is shown as plain text with control characters removed and a length cap (2000 for a message, 80 for names). Links the network supplies (`provider_url`, media) are never opened from the app; attachments say to open them on veyrnox.ai.
3. **Locked state.** A free account's 402 shows the Unlock card with store prices (ADR-0162), feature `inbox`. The inbox flag being off (503) says it is not open yet.
4. **Not built, on purpose:** replying, assigning, priority, tags, resolving, internal notes, suggestions and workflows. Replies post publicly to a real network and need their own confirm and idempotency work; the owner placed inbox last and read-first. Contacts (already on main) cover tags and subscription status.
5. No server change, no dependency, no flag. Proved against nothing but unit tests (no mock added): the screens were not run on a device.
