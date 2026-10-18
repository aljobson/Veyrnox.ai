# ADR-0124 — Mobile: Free allowance card

**Status:** Proposed 2026-10-18
**Related:** [ADR-0069](0069-model-free-allowance.md) (the allowance), [ADR-0106](0106-mobile-app.md) (the app), roadmap slice M12

## Context

`GET /api/v1/free-allowance` answers `{ enabled, left }`: when `FREE_ALLOWANCE_ENABLED` is off it is `{ enabled: false, left: {} }`; when on, `left` maps a model id to the free runs the account has left today, computed by the database function `free_allowance_left`. The web create page uses it to mark free models. The app does not.

## Decisions

1. **No server change.** One read of the existing route, with the Bearer token.
2. **A "Free today" card at the top of Create**, listing each catalog model that has free runs left ("Model A: 3 free runs left today"), at most five lines. Names come from the catalog the screen already loaded.
3. **Hidden whole when there is nothing to say**: the route answers disabled, no model has runs left, or the read fails. No placeholder and no error text; the paid price is what the server charges when nothing is free.
4. **The app computes nothing.** Counts are shown as the server gave them (positive whole numbers only; anything else is dropped). The price shown on a model and the confirmed price sent with a request are unchanged; the server decides whether a run was free.
5. The route is daily and per model; there is no monthly figure, so none is shown.

## Consequences

- No flag is changed and no dependency is added.
- Verified with fake clients in unit tests; not run on a simulator in this slice.
