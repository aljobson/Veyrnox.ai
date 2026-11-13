# ADR-0340 — Library favourites and the unsent Create draft follow the account

**Status:** Proposed 2026-11-13. Migration 0500. Switch: `LIBRARY_SYNC_ENABLED` (ships absent = off).

## Context

The owner wants the Library and a person's sessions to be the same on web and in the mobile app, both ways. A survey (2026-11-13) found most of it already shared through the account on the server: the Library list (`/api/v1/jobs`), chat threads, folders and personas, editor projects, Film Studio, Publish drafts and scheduled posts, and the first goal. Two things were still on one device only: Library **favourites** (web `localStorage`, phone cache) and the **unsent Create draft** (web tab storage, phone cache, ADR-0153). The web Library also read the account list once on load, so a creation finished on the phone showed only after a reload.

## Decision

Two small per-account stores, reached only through SECURITY DEFINER functions the Worker calls with the service role (the browser roles hold no grant; RLS enabled and forced):

- `library_favourites (user_id, job_id)`: one row per starred creation. The job must be the caller's own and not deleted (`job_not_found` for anything else, so another account's job is indistinguishable from a missing one). At most 200 live stars per account, the cap both apps already applied. Stars on creations the owner later deletes (ADR-0116) are not listed and do not count.
- `create_drafts (user_id, draft)`: at most one per account, last write wins, read back for 24 hours. Words and settings only: model id, prompt, duration (whole seconds), aspect, count, seed, negative prompt, voice. No file, no Library source, no Cinema or Character panel, no consent, no idempotency key, so restoring never re-sends or re-charges anything. The route keeps only those fields; the function re-checks the shape and size.

**API** (Bearer-only, inside `/api/v1`, 404 while the flag is off): `GET /api/v1/library-sync` (favourites newest first, draft), `PUT /api/v1/library-sync/favourites {job_id, starred}`, `PUT` / `DELETE /api/v1/library-sync/draft`. Ids and words travel in bodies, never in addresses; the draft is never logged.

**Clients.** Both keep their own copy and show it first; the account copy replaces or fills it when the server answers. A failed, refused or flag-off call means "unavailable" and nothing changes for the person.
- Favourites: the first time a device meets the account list it keeps stars of its own that predate sync and uploads them once; after that the account's list wins, so an unstar on another device holds. Every star or unstar is pushed.
- Draft: with nothing in this tab (web) the account's draft is restored; on the phone it is used for the model on screen when it is newer than the phone's own copy. Changes are pushed after a short pause (web 1.5 s, phone 0.6 s) and cleared when the form is emptied.
- Web Library: looking at the tab again re-reads the first page of the account list (not more than every 15 s) and merges it in, plus favourites. The phone already refreshed on focus.

**Not synced, on purpose:** chat unsent text, starred replies and notices (`chatLocal.js`), editor drafts (`editorDraft.mjs`), view mode and filters. Sources a draft pointed at (files, Library picks) stay device-only; the person picks them again.

**Privacy.** Account deletion removes both tables' rows in the same transaction as `users.deleted_at` (trigger; classified in `scripts/test-account-deletion.mjs`). The privacy export gains `library_favourites` and `create_draft` in the `profile` section through one more wrapper (classified in `scripts/test-privacy-export.mjs`). Web and phone copies stay keyed by account and are cleared as before. The admin telemetry allowlist admits the three route paths.

## Not decided here

- Migration 0500 is applied only by the `apply-migrations` workflow after the owner approves the run.
- The Worker var budget is full: `LIBRARY_SYNC_ENABLED` is not in `wrangler.jsonc`. To turn it on the owner frees a binding (or makes it a secret binding) and sets it to exactly `"true"`. Until then nothing syncs.
- No live push between devices: a change shows when the other device is next opened or focused.
