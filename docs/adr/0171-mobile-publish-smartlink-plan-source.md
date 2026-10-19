# ADR-0171 — Mobile: Publish SmartLink and where a plan is managed

**Status:** Proposed 2026-10-19
**Related:** [ADR-0109](0109-mobile-publish-plan-and-store-catalog.md) (amendment 1: `subscription.source`), parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4

## Decisions

1. **Where a plan is managed.** The Publish tab reads `entitlement.subscription.source` from `GET /social/plan` (server PR #1335). `stripe` says the plan was bought on veyrnox.ai and is managed there, in account billing, as plain text with no link or button (ADR-0109: no steering to web checkout). `store` (or an active store purchase on this phone) says to manage it in the Apple ID or Google Play subscription settings. No value, or any other value, says nothing about where.
2. **SmartLink editor.** One public page per brand at `/s/<address>`. The screen edits the address (lowercase letters, numbers, dashes, 3 to 48, not starting or ending with a dash), page name (80), bio (280), picture address (https), look (Midnight, Light, Sunset), up to 20 buttons (text 60, https link, shown or hidden, click count), and public on or off. Totals of views and clicks are shown. The checks match the route's. Share opens the system share sheet with the page address built from the app's own API base, shown only once the page is saved and public. Routes answer 404 `smartlinks_not_open` while the flag is off, 402 without the Publish Plan, 409 for a taken address; each has its own message.
3. The long Publish menu and the SmartLink form keep `VEY_CLEARANCE` bottom padding so the mascot does not cover the last row.
4. No server change, no dependency, no flag. Proved against the dev mock only.
