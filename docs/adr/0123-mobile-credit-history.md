# ADR-0123 — Mobile: Credit history

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app), [ADR-0110](0110-mobile-account-and-safety.md), roadmap slice M12

## Context

The web account shows a person's credit movements. The server routes already exist: `GET /api/v1/ledger` (25 entries a page, newest first, a keyset cursor, a stable `kind` per row and never the operator's reason) and `GET /api/v1/ledger/usage` (credits spent over the last day, 7 days and 30 days, with a `truncated` flag). The app shows only the balance.

## Decisions

1. **No server change.** The app uses the two routes as they are, with the Bearer token like every other call.
2. **A Credit history screen** (`/history`), reached from Account and from the Buy credits screen. It lists entries as plain English (Welcome credits, Creation, Refund for a creation that did not finish, Credits bought, Referral reward, and so on), the credits in or out, and the date. An unknown `kind` reads as "Adjustment"; no server text is shown.
3. **Cursor paging.** The next page is requested with the server's `before` and `before_id`, sent URL-encoded. A row that appears on two pages is shown once.
4. **A spending summary** from `/ledger/usage` sits above the list. When the server says the month figure is a floor it reads "at least".
5. **No running balance.** The route does not return one, and the app does not work one out. A line says how much of an entry was free credits when the server reports a free part.
6. **Credits only.** Amounts are credits, never a currency. A failed summary read leaves the list alone; a failed first page offers Try again, a failed later page offers Try again at the foot.

## Not decided here

- A running balance per row (would need the server to return it).
- Filtering by kind or date.

## Consequences

- No new dependency and no native change.
- Shown against fake clients in unit tests; not run on a simulator in this slice.
