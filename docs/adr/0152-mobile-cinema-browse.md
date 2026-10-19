# ADR-0152: Mobile Cinema browse, series page, locked state and share (parity P6, viewer slice 1)

**Status:** Proposed 2026-10-19. First of three viewer slices; creator tools, paid unlocks, the Pass and credit subscriptions are not in this wave (ADR-0143).

## Context

The phone's Cinema tab was one paged feed. The web has Series, Vote, Saved, Following and Winners tabs, twelve category chips, a series page with an episode count and Watch, and a share link. A title the viewer cannot watch showed one line, with no reason.

## Decision

- **Tabs and chips.** The Cinema tab is a tab strip (Watch, Series, Vote) over the 12 category chips (Romance, Drama, Thriller, Comedy, Horror, Sci-Fi, Fantasy, Action, Mystery, Documentary, Animation, Kids). Watch is the existing one-title-per-screen feed and now takes the `category` filter of `GET /api/cinema/titles`. Series and Vote read the anonymous `GET /api/cinema/discovery?mode=series|voting` the web uses, with `category`, and its `{at, id}` cursor. The chip list is a constant that mirrors `CINEMA_CATEGORIES`; the server's table is authoritative and refuses an unknown slug. Saved, Following and Winners arrive in slice 2.
- **Closed is an answer.** A 503 `viewing_not_open` or `voting_not_open` shows a closed message, not an error with a retry.
- **Series page.** The title page shows the category names, the episode count, and a Watch button that plays the first watchable episode in season and episode order.
- **Entitlement.** When the detail read shows nothing watchable, the page calls `GET /api/v1/cinema/entitlement?content_id=` (a film, short or trailer by its id, a series by its first episode) and explains the answer: monthly free viewing used, not available in the app yet, no longer available, no connection, or could not check. If the read says the viewer may watch, Play is offered. A locked title is explained and **never priced**: there is no unlock, credit amount or purchase link, because spending credits on content is the open store-policy check (PARITY section 5, Apple 3.1.3(b)).
- **Share.** The share sheet carries `https://veyrnox.ai/social-cinema/title/<id>`, the same public address the web builds. `mapAppLink` opens `/social-cinema/title/<id>` as the title page and `/social-cinema/watch/<id>` as the player; the app's own scheme path `/cinema/<id>` already works.
- Strings are in the `cinemaBrowse.*` block of the English file and `docs/mobile/I18N-NEW-KEYS.md`; no machine translation.

## Gap for the server

Universal and App Links only open the app for the paths in `APP_LINK_PATHS` (`lib/mobileAppLinks.js`), which has no `/social-cinema/*`. Until `/social-cinema/title/*` and `/social-cinema/watch/*` are added there, a shared link opens the web page on a phone that has the app; the mapping is ready on the phone. That is a server change and is not made here.

## Not proved

Everything is proved against Jest and the mock only: no run on a device, simulator or real server. The `discovery` and `entitlement` answers were read from the route source, not from a live response. In production `CINEMA_VIEWING_ENABLED` is on and `VOTING_ENABLED` is off, so Vote shows the closed state there.
