# ADR-0121 — Mobile: Publish overview (read-only)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0061](0061-social-publish.md) (Publish), [ADR-0106](0106-mobile-app.md) (the app), roadmap slice M11

## Context

The app has the Publish Plan paywall (ADR-0108) but nothing to look at once the plan is on. Publish already has signed-in routes under `/api/v1/social/*`. This slice reads them; it writes nothing.

## Decisions

1. **Three read-only screens**, linked from the Publish screen: Connected accounts (`GET /api/v1/social/accounts`), Posts (`GET /api/v1/social/posts`, newest first, paged by the server's cursor) and Analytics (`GET /api/v1/social/analytics`, the last 30 days for one account, with an account picker when there are several).
2. **Post detail** shows the status, the schedule time and, per network, the delivery state, the live-post link and any error the network gave. The error is provider text, so it is shown as plain text in a bounded box (control characters removed, cut at 300 characters) and never as markup or a link. Only `https` post links are opened.
3. **No GET for one post exists yet.** Until the server adds it, the detail screen finds the post in the newest page of the list. A post older than that page says so instead of failing. When the route exists the screen switches to it.
4. **Plan wording comes from the server.** Analytics answers 402 `publish_plan_required` on the free plan and the screen says it needs the Publish Plan. Accounts and Posts are shown to any signed-in person, as the server allows.
5. **Nothing is written.** No composer, no scheduling, no connect or disconnect, no approvals. The Accounts screen says to use veyrnox.ai for those until they are built. Connecting a network needs OAuth through app links, which needs a signed device build.
6. No server change, no dependency, no flag.

## Not decided here

- The composer, scheduling and rescheduling, connecting networks, inbox, approvals (later M11 slices).
- A stable error code per target; the free-text `last_error` is shown as given.

## Consequences

- The routes are still moving on other branches (multi-account, analytics parity, free-plan entitlements). The parsers keep only the fields used here and drop anything malformed, so added fields do not break the screens.
