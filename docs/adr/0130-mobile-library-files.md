# ADR-0130 — Mobile: Library video files (read-only)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app); the film masters and editor render routes under `/api/v1/library/*`

## Context

The web Library keeps two kinds of finished video besides ordinary creations: film masters (saved from a finished video in the Film Library) and editor renders (exports from the editor). Both have signed-in routes. The app showed neither.

## Decisions

1. **One read-only screen**, "Video files" (`/library/files`), reached from the Library header. Two tabs: Film masters (`GET /api/v1/library/masters`) and Editor renders (`GET /api/v1/library/editor-renders`). A row shows the label, length, resolution, size and how long it will be kept ("Expires in 27 days"). An expired file shows "Expired" and has no actions.
2. **Share and Save to Photos** are the only actions, through the same helpers a finished creation uses (`shareOutput`, `saveOutput`). The download link (`.../:id/asset`) lasts about 15 minutes, so it is fetched when the person taps, used once and never kept. Only an `https` link to a video is used.
3. **Nothing is changed.** The app does not upload, delete, rename or inspect a file; those stay on veyrnox.ai (the same routes also carry POST and DELETE, which the app does not call).
4. **Off means a plain answer.** Both lists answer `enabled: false` when their server flag is off (`FILM_LIBRARY_MASTERS_ENABLED`, `EDITOR_LIBRARY_EXPORTS_ENABLED`); the screen then says it is not available yet. A rate limit, a busy server and a missing file each get their own wording.
5. No server change, no dependency, no flag.

## Not decided here

- Playing a file in the app, thumbnails (the rows carry none), deleting a render, uploading a master.

## Consequences

- Rows are text only, since neither list returns a poster.
- The editor render routes call the database with the person's own token (`tenantRequest` in `packages/db/tenant-client.js` forwards the incoming `Authorization: Bearer` header to PostgREST), so a mobile Bearer token should be accepted. This was **read from code, not run against a server**.

## Not proved

- Share and Save to Photos over a real `https` link: the dev mock can only serve `http`, which the app refuses, so the download, share sheet and Photos permission have not been exercised.
- Anything against staging or production, including a file with a real size, length and expiry.

## Manual checks for the owner

1. Share and Save to Photos over `https`, on a device, for one film master and one editor render.
2. `FILM_LIBRARY_MASTERS_ENABLED` and `EDITOR_LIBRARY_EXPORTS_ENABLED` on staging, and one file of each kind present for the account.
