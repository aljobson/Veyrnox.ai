# ADR-0165 — Mobile: Publish contacts

**Status:** Proposed 2026-10-19
**Related:** parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4; [ADR-0162](0162-mobile-publish-calendar-analytics-drafts.md) (the Unlock card, not yet on main)

## Decisions

1. **Contacts list and edit.** `GET /contacts` lists the people who messaged the brand's accounts (name, network, account, last active, message and unread counts, tags, subscription status, notes). The screen searches by name (100 characters), filters by subscription status (All, Unknown, Subscribed, Unsubscribed), and opens one contact to change its subscription status, tags (comma separated, up to 10, each up to 32 of letters, numbers, spaces, dashes, underscores) and notes (2000). Checks match the route. Owners, managers, editors and reviewers can save; other roles see the contact read-only (the route returns `brandRole`).
2. **Not built:** adding a contact by hand and CSV import (a file picker; wait with device uploads), and the inbox itself (threads, replies, workflows), which the owner placed last and which needs Meta engagement scopes.
3. **Plan.** The routes answer 402 without the Publish Plan and 503 `publish_inbox_not_open` while the inbox flag or the plans are off; each has its own message. This slice shows the 402 as text pointing at the Publish tab. The Unlock card with store prices (ADR-0162) is not on main yet; swapping the message for the card is a small follow-up once it is.
4. No server change, no dependency, no flag. Proved against the dev mock only.
