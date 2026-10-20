# ADR-0156: Mobile Library parity (parity plan P2, slice 2)

**Status:** Proposed 2026-10-19. Number taken after 0153 (Create options) and the other open mobile ADRs (0150, 0151,
0154 twice); renumber if it collides.

## Context

The web Library has status and type filters, favourites, grid and list, a "File expires" note, a "Failed,
refunded" row, a provenance record and "Schedule this". The phone had a plain list with a state badge.

## Decision

Everything below uses `GET /api/v1/jobs` as it is; no server change.

- **Filters**: Status (All, Succeeded, Running, Queued, Failed) and Type (All types, Images, Video, Audio,
  Favourites), applied to the pages already loaded (`lib/libraryView.ts`, a port of `_lib/libraryFilter.js`). The
  list returns no file type, so **type is the kind of the model that ran the job**, from the cached catalog. A job on
  a model the catalog no longer lists matches only "All types".
- **Older creations**: the list still pages on scroll; a visible "Show older creations" button does the same for
  people who cannot scroll to the end (screen readers), and an empty filtered result says when more is unloaded.
- **Favourites**: job ids starred on this phone for this account, newest first, at most 200
  (`favourites` cache policy, one year). They live under the cache prefix, so **sign-out, account deletion and a
  change of user remove them**; the web keeps its in `localStorage` through sign-out. Not synced between devices.
- **Grid and list**: a two-column grid of cards or the list. The grid has **no thumbnails**: a picture needs an
  asset link per file (15-minute URLs), and fetching one per visible card would multiply reads.
- **Each creation shows**: name (label, else the model's name), state, price (or Free), date, and the expiry note:
  "File expires 9 Jan 2027. Save a copy." from `asset_expires_at`, or "File expired" once past. A failed job shows
  "Failed, refunded N credits" when the list says `refunded`, and plain "Failed" until it does. A moderation hold
  shows "Under review" and offers no Schedule.
- **Schedule this** (images and videos with a stored file, not held, not expired) opens `/publish/compose` with
  `jobId`, the param the composer already reads (ADR-0147). No Publish file is changed.
- **Provenance**: the result screen has a "How this was made" block that reads
  `GET /api/v1/jobs/:id/provenance` when opened: model, date, cost, file type and size, and the SHA-256 when the
  server has it, with the server's own caveat. Without a digest it says the record cannot match a file you hold.
  A job without stored output (409) says there is no record yet.

## Gaps for the server (not built here)

- `GET /api/v1/jobs` returns no `mime_type` or `modality`, no thumbnail URL and no prompt. A type filter that does
  not depend on the catalog, a grid with pictures and a prompt line need those fields (or a batch thumbnail route).
- Favourites are local. Following a person across devices needs a server table.

## Not proved

- `tsc` and Jest only (owner disk rule: no Metro or simulator). Not seen on a phone; text size and VoiceOver on the
  new chips and cards are unchecked. Not run against the mock server.
- "Schedule this" was not followed into the composer; only the route and param were read.
