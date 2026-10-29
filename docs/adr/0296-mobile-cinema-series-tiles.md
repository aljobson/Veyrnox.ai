# ADR-0296: Mobile Cinema opens on Series tiles; Watch drops short clips

Status: Implemented for independent review; host simulator verification pending.
Date: 2026-10-28

## Context

After testing build 14 the owner said Cinema works, but asked to remove the short
8-second videos and show all video tiles. The phone opened on Watch, a
one-title-per-screen pager fed by the public `/api/cinema/titles` list with no
filter, so creator SHORT and TRAILER clips filled it. The web opens on Series
as a grid (`SocialCinema.js`, `CinemaDiscovery mode='series'`); the phone's
Series tab was a one-per-row list.

## Decision

- **Default tab.** Cinema opens on Series, matching the web. The tab order is
  unchanged and Watch stays first and selectable. A `?section=` deep link still
  wins. Continue watching shows on Watch and above the Series grid (owner,
  2026-10-28).
- **Series tile grid.** Series renders two columns of tiles (`SeriesTile`):
  editorial YouTube series first, then discovery titles, de-duplicated and
  paginated as before. A tile shows a 16:9 poster, the title (two lines), the
  creator (one line) and one meta line: the episode count for a series, the
  running time otherwise. No synopsis, categories or Watch pill. The whole tile
  is one button whose label starts with the title. Tile width comes from the
  list's measured width, so a lone last tile keeps half width and the grid fits
  320 pt. Vote keeps its one-per-row layout (owner, 2026-10-28).
- **Pull to refresh** on Series and Vote reloads page one. A generation counter
  drops any older answer, including a page-two read still in flight; a failed
  refresh keeps the rows on screen.
- **Watch filter.** Watch hides `SHORT` and `TRAILER` at any length and any title
  with a known duration under 60 s (`MIN_WATCH_SECONDS`); a title with no known
  duration stays (owner, 2026-10-28). `fetchFeedPage` reads at most three pages
  in a row while every title on them is filtered out. If three pages hold only
  short clips, Watch says so and offers Show more, which reads another bounded
  run.
- **Client-side.** The filter lives in the app only: no server change was asked,
  and the public list is cached per page (`lib/cinema/titlesApi.js`), so a
  server filter would need a new cache key and route contract. Series, Vote,
  Saved, Following, Winners, title pages and Continue watching keep every type.

## Non-goals

No server, RPC, catalog, flag, migration or mock-data change; no server-side type
or duration filter; no web change; no change to Vote, Saved, Following, Winners or
Profile layouts; no synopsis, categories or share on tiles; `TitleCard` and the
pager are unchanged; the Watch tab is not removed.
