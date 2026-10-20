# ADR-0185 — Mobile: Publish ads, read-only

**Status:** Proposed 2026-10-20
**Related:** parity phase P5 in `docs/mobile/PARITY-2026-10-19.md` section 4; [ADR-0162](0162-mobile-publish-calendar-analytics-drafts.md) (the Unlock card)

## Decisions

1. **Campaign list.** `GET /ads` lists the brand's ad campaign drafts: name, status (Draft, Paused, Active, Completed), network, standalone or boosted post, objective, daily budget in its own currency, dates, and where the ad sends people (shown as the host only; a link is never opened from the app).
2. **Nothing that spends.** Starting, pausing and editing campaigns, and the audience and budget forms, stay on veyrnox.ai. A "Create or change campaigns on veyrnox.ai" link opens the Publish page in the in-app browser. The web itself has spending switched off for now.
3. **Locked state.** A free account's 402 shows the Unlock card with store prices (feature `ads`). A flag-off 404 says it is not open yet.
4. No server change, no dependency, no flag. Proved by unit tests only (parsing, host-only links, money formatting, errors); the screen was not run on a device.
