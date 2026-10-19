# ADR-0151 — Mobile: Publish team, activity log, queues and RSS autolists

**Status:** Proposed 2026-10-19
**Related:** [ADR-0149](0149-mobile-publish-composer-completion.md) (picking a queue slot in the composer), [ADR-0150](0150-mobile-publish-calendar-analytics-drafts.md), parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4

## Decisions

1. **Team (read-only).** `GET /team?brand_id=` lists members and pending invitations (email, role, joined or expiry date). The chosen brand's id goes in the query because that route does not read the brand header. Invitation links are never read or shown. Invite, change role and remove stay on the web; the screen says so. The route answers 403 unless the person is an owner or manager, 404 `teams_not_open` while its flag is off; both have their own messages.
2. **Activity log (read-only).** `GET /activity`, 50 an entry, "Show older" pages with the cursor, which the route wants as base64url of its JSON (`lib/social/activityCursor.js`); the phone encodes it with `btoa`, as the PKCE code already does. Entries are the action, the actor (System when none) and the time; the `detail` field is shown only as bounded plain text with control characters removed. A repeated page cannot loop (entries already shown are skipped).
3. **Queues.** List, create, edit and delete (`/queues` GET, PUT, DELETE). A queue has a name (80), a time zone (defaults to the phone's), 1 to 20 accounts, 1 to 35 distinct weekly times (weekday plus HH:MM, in the queue's time zone) and an on/off switch. The checks match the route's so most mistakes are caught before sending. Delete is behind a dialog that names the queue.
4. **RSS autolists.** List, create, edit and delete (`/autolists`). Fields: name, https feed address, queue, text template (only `{{title}}`, `{{link}}`, `{{summary}}`), how often to check (30 min to 24 h), on/off, and "schedule new items automatically". The server checks the feed address itself; the phone only requires https. Items are not shown (the web reviews them).
5. **Where they are.** Four new rows in the Publish tab's menu. The queue code lives in `publishQueueAdmin.ts`; the composer's slot code (ADR-0149, `publishQueues.ts`) is separate, so the two slices do not depend on each other. They can be merged into one file after both land.
6. **Not built:** reports with PDF and slide export; inviting and removing people; autolist item review. No server change, no dependency, no flag.

## Consequences

- Proved against the dev mock only. Nothing was saved to a real brand. Routes re-read on main before building.
- Gating differs by flag: team and activity need `teams_not_open` off; queues need the queues flag; autolists need the queues flag and the RSS flag. A person whose server has them off sees a plain "not open yet".
