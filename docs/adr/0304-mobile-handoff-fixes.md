# ADR-0304: Mobile screen hand-off contract

Status: Accepted.

Date: 2026-10-30

## Create and references

Model changes and device attachments reuse `attachCarry` and the existing opaque
`sourceHandoff`. The snapshot carries form options, camera and character settings,
references, template parameters, recipe, followup, source metadata, and Oddling start.
The destination applies only supported settings, selects the nearest available
aspect/duration, deduplicates references, and reports moved/removed references.
Device attachment plans against both existing and new files and resets rights
confirmation. Model changes retain an existing rights confirmation.

Submitted requests are stored locally for the most recent 100 job ids, per account.
Retry and Make another recover their form snapshot, template and workflow metadata.
Library references are rechecked through the existing job asset endpoint. Expiring
upload keys are not persisted; removed references are reported. An older job with
no local snapshot explicitly says its original prompt is unavailable on this phone.
No submission idempotency keys or signed media URLs are stored by these hand-offs.
The destination continues to obtain prices from the existing catalog/submission flow.

Prompt tools carry the current prompt and generation model to skills. The prompt
becomes editable chat text, and the model is included in the skill instructions.

## Publish and links

Compose resolves an explicit job id beyond the first Library page and checks its
asset. The existing `output_type: editor-render` response is accepted as video,
without requiring `editor-server-render` in the public catalog. Missing, unfinished,
and unsupported creations have separate messages. With no export path, Export
shows an in-place unavailable note and never opens an empty composer.

Canonical `/app/create` query links validate ids. A preset resolves through
`fetchPresets` and `presetHref`, preserving template parameters and recipe. An
unavailable preset lookup falls back to its template page for a syntactically valid
id. A successful lookup with no matching preset falls back to Create. Model-only
query links check the catalog; unknown or malformed model ids fall back to Create.
Public lookups survive account binding at cold start and yield the mapped route
after 1.5 seconds or a network failure. Only a newer link revokes the lookup.

AASA paths and Android intent-filter prefixes cover Cinema, OAuth consent, review,
Publish subsections and video-agent, preserving all previous paths. A consistency
test enumerates the mapper's app sections and supported special paths. Android
verified links remain inactive while `ANDROID_SHA256_FINGERPRINTS` is empty.
Only `android.intentFilters` changes in app.json.

## Cinema

The upload runner retains the episode's parent and supplies the `parent` parameter
read by creator detail.

Watch records known `episodeId → rootId` pairs in a per-account local map bounded
to 200 entries. Continue watching adds a known root so Next episode and All episodes
work. Older progress without a mapping keeps its existing episode-only playback;
it does not query the root-only public title endpoint for an episode.

Watch reads saved progress before starting a fresh player. Resume is skipped within
five seconds of the end or at/after 95% completion. A 1.5-second best-effort lookup
budget prevents progress-service trouble from blocking playback. Returning from
Comments preserves the existing player and grant. New lookups are fenced by
screen lifetime/focus and account identity.

Reference mode in Tools includes models with a slot for the chosen media kind,
including optional slots. Photo mode shows all tools requiring the chosen source,
including image editing and upscaling.

## Film returns

Film identity is local and independent of title or shot name. A sidecar binds the
phone slot and cloud copies to local ids; editing retains identity and starting a
new film gets a fresh id. A WeakMap retains identity across edits; persisted slots
contain only ids, never copies of the film. One phone slot, at most 20 cloud slots
and 100 generation attempts are kept. No identity or generation-return field is sent to the server.

The Create hand-off carries film id, shot id, prompt version and context. Submission
records the job against that identity. Existing result polling records completion;
shot history also refreshes pending jobs while focused. Polling backs off from five
seconds to one minute and stops when no jobs remain pending. Missing jobs and jobs
still pending after seven days become failed history entries. Current-prompt association
requires the exact film, shot, latest version, context and prompt text. Switching
films while pending, or revising a prompt, leaves the attempt in its original shot's
history as unattached. History links to the job; a matching result can populate the
manual review's result-reference field. Completion never writes the Film document,
manual verdicts or autosaved edits.

## Ownership, localization and retained paths

Local stores use the existing account cache, bounded entries, serial writes, and
owner/epoch checks. Sign-out clears persisted records with the app cache and revokes
in-memory hand-offs. Late writes are removed, and late UI results are ignored.
Announcements use `useAnnouncement`. New copy has English and real translations in
all ten app catalogs; registry and length-review checks cover the additions.

The preset `/templates/[id]` fallback remains: the existing preset test directly
exercises it. `editor/new` retains its `jobId` path because the Expo scheme can address
that route directly and absence of external callers cannot be proven. No change is
made to `cinema/probe`.

## Retained exceptions

The ten pre-existing monolithic
translation catalogs and generated translation-review files already exceeded 500
lines; their required layout is preserved rather than reorganized. Every other changed source/test/document file remains below 500
lines. Existing assertions are preserved or updated to assert the new behavior and
new source location, including the previously broken blank-export expectation.
