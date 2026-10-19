# ADR-0150 — Mobile: Publish calendar month, analytics range and compare, locked states, draft approval

**Status:** Proposed 2026-10-19
**Related:** [ADR-0138](0138-mobile-publish-calendar-best-time.md), [ADR-0139](0139-mobile-publish-drafts.md), [ADR-0109](0109-mobile-publish-plan-and-store-catalog.md), parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4

## Decisions

1. **Calendar month view.** A Week / Month switch on the existing calendar. Month shows a Monday-first grid with a post count on each day; tapping a day lists that day's posts (tap again to show the whole month). One month is at most 31 days, under the route's 43-day limit, and uses the same paging as the week.
2. **Analytics range, compare, followers chart.** Ranges of 7, 30, 90 and 365 days, limited by `analyticsDays` when the server sends it. "Compare" loads the same number of days immediately before and shows the change next to followers growth, posts and interactions. The summary rules are the web's (`lib/social/analyticsSummary.js`): the last followers value, the change from the first, interactions as likes + comments + saves + shares, reach not counted. The followers chart is a bar chart made of views (no new dependency) with a text description for screen readers. CSV export is not built.
3. **Locked states.** A free account gets a 402 `publish_plan_required` on the calendar and analytics. Instead of an error line the screen shows an Unlock card (`components/UnlockCard.tsx`) with the plan benefits and the **store's own** weekly, monthly and annual prices from RevenueCat, a Subscribe button and Restore. There is no link or button to a web checkout (ADR-0109). After a purchase the screen loads again; the server remains the authority on the plan. The card takes a `feature` of calendar, analytics or inbox. **The phone has no inbox screen yet** (inbox is outside this wave), so the inbox card is built and has no screen to sit on. The Publish tab keeps its own plan screen; folding it onto the card is left for later to avoid touching the tab shell.
4. **Draft approve and discard: built.** ADR-0139 left them out until the owner said they belong on a phone. The owner's 2026-10-19 decision that every web feature exists on the phone settles that. Each is behind a system dialog that names the networks and the count: approve says real posts will go out at their planned times; discard says it deletes for good and cannot be undone. Approve is per batch, discard is per batch or per draft. Drafts with no batch cannot be acted on (the route needs a batch id) and show no buttons. Approve is hidden when the server says `approvalEnabled: false`. The roles (owner, manager, reviewer) and the Publish Plan are enforced by the route; a 403 and a 402 have their own messages.
5. No server change, no dependency, no flag.

## Consequences

- Proved against the dev mock only (it now answers drafts approve and discard, and `MOCK_SOCIAL_PLAN=free` makes the calendar and analytics answer 402). Nothing was approved or deleted on a real server.
- The Unlock card's purchase path is the same code as the Publish tab's; it was not run against a store in this change.
