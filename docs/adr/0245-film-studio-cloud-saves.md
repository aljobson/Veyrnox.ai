# ADR-0245: Film Studio saves to the account

Status: server foundation implemented; activation and web/phone clients pending.

## Decision

Store one mutable row per saved film in `public.film_studio_projects`, owned by
an Auth user. Keep the original `studio_json` text as `film_json`, byte for byte.
JSONB reorders nested keys: `lockContext` and `promptContext` in Film Studio
compare JSON strings, so converting a saved film to JSONB would invalidate
asset locks and current prompts. SQL casts a copy only to validate schema 1
and count shots. The Worker uses the existing `parseFilm` and restricts the
top-level keys to `emptyFilm`; it never serializes the parsed film for storage.

Each account may save 20 films, each at most 1,000,000 UTF-8 bytes and 200 shots.
Names are collapsed whitespace, truncated to 120 characters, or `Untitled film`.
The POST/PUT envelope allows 2,100,000 bytes and the single-film upstream read
2,200,000 bytes because JSON escaping can double the stored text's size.
Lists contain only metadata and at most 20 rows, newest updated first.

Saves require an idempotency key and updates require the expected revision.
Create-key and last-update-key replays compare the exact text and name and
return metadata without another write. Changed content on replay conflicts.
Stale revisions conflict. Removal uses the expected revision, while removal of
an absent or invisible film succeeds idempotently and discloses nothing.

A per-user advisory transaction lock (namespace 360) serializes saves/removals.
`private.film_studio_save_windows` limits successful new saves/updates to 30
per minute and 500 per day, with windows starting at the first save and rolling
over on the first save after expiry. Replays consume no further quota. The
20-film cap returns `LIMIT_REACHED`; throttling returns `RATE_LIMITED`.
`tenantRequest` recognizes the former only for opt-in film routes, from a
bounded 4 KiB error body. Existing tenant clients retain their error mapping
and default 256 KiB response cap.

## Security, deletion and activation

Both tables enable and force RLS, revoke all browser/service-role grants, and
allow no direct browser mutations. Authenticated callers receive only metadata
and film-text column SELECT on their own public rows. Public SECURITY INVOKER
save/remove wrappers call private SECURITY DEFINER functions with empty search
paths, qualified objects, explicit authenticated EXECUTE grants and `auth.uid()`
ownership checks. The private schema remains outside PostgREST's exposed schemas.
All routes use `protectedRoute`, the public key and the user's JWT; no service-role
read or write exists in this feature. No film content or names are logged.

Both tables reference `auth.users` with ON DELETE CASCADE. Their account-deletion
class is `WITH_AUTH_USER`: films and save windows disappear with Auth deletion
and do not block it. They are neither ledger records nor tenant projects.

Both `TENANT_PROJECTS_ENABLED` and `FILM_STUDIO_CLOUD_ENABLED` must be exactly
`true` at request time. The new flag is absent from `wrangler.jsonc` to respect
the binding budget; absent means off. Apply the migration through the approved
`apply-migrations` workflow, then enable staging before production. Builders do
not apply migrations. The frozen work order requests the CLAUDE.md surface
addition; the independent reviewer should confirm that sentence.

## Why not tenant project documents

`lib/projectDocument.js` defines the closed editor contract
`schema_version, project_id, brief, canvas, timeline`, capped at 32 KiB in both
the Worker and `0269_project_document_multitrack.sql`. Revisions are append-only
and capped at 1,000 per project. A film can be 1 MB and browser autosave runs
on every edit: reusing that history could consume about 1 GB per film and would
require changing every reader that expects `brief` and `canvas`. Tenant projects
also block account deletion (ADR-0111). A mutable film row avoids those changes.

## Later work orders

Part B adds explicit, opt-in **Save to your account**, open and remove controls
on the web, after owner confirmation of opt-in and caps. The first save imports
the current browser film; there is no automatic migration or import nudge.
Part C adds the phone's account film list and open action, retaining its existing
per-account cache and read-only film screens. The phone does not save to the
server. These clients are not part of the server build.

## Proof

`tests/filmStudioCloudRoutes.test.mjs` covers gates, user-JWT requests, invalid
inputs, conflicts/limits, unchanged locks/prompts and near-limit escaped text.
`tests/tenantClient.test.mjs` pins existing defaults and opt-in bounds/errors.
`node scripts/test-film-studio-cloud.mjs` uses a migrated local throwaway database
and rolls back every fixture; it exercises ownership, grants, caps, revision
conflicts, exact text, replays, removal and Auth cascades.
Ledger CI runs it alongside default-privilege, deletion, document and FK checks.
