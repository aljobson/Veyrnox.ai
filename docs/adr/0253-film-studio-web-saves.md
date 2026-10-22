# ADR-0253: Film Studio web saves

Status: Proposed; the host assigns the ADR number.

This UI adds explicit save, open and remove on `/app/film-studio` only when both `TENANT_PROJECTS_ENABLED` and `FILM_STUDIO_CLOUD_ENABLED` are exactly `true`. The existing gateway and owner-scoped API remain the only network path. There are no server route, migration or flag changes; the shared film validator additionally rejects the reserved top-level `cloudLink` property.

Lists live in account-tagged component memory. The existing per-user browser key contains one atomic record: a strict `cloudLink` prefix followed by the original film JSON bytes. Imported films cannot supply the reserved property. The saved snapshot stays in memory only; after reload, the account indicator conservatively reports unsaved changes. Every write persists the current film/link pair in one `setItem`. A failed local write drops the live link and recommends export. If the account save succeeded first, that account copy remains in the list, unlinked; another Save creates a new copy, subject to the 20-film cap.

Open replaces the module store, increments the document generation and remounts editors; storage alone would leave the live film unchanged. Save results require the starting account and generation. Link-only changes preserve edits and editor state. The store observes account changes while unmounted. Same-user token refreshes keep the entire live workspace, even when another tab has written storage. Separate tabs can still edit the same account film: expected revisions produce the conflict choices instead of silently overwriting a newer revision.

The shared gateway inspects a bounded 429 body to distinguish the account's 20-film limit from ordinary throttling. Other throttles retain their existing behavior. No film content, names or identifiers are logged by this UI. Translations require native review. Staging checks and enabling flags remain the owner's responsibility.

## Owner decisions

These are the owner's calls, recorded here so they are not mistaken for implementation details:

- Saving to the account is opt-in per film. There is no autosave, and this release shows no "save your existing film" nudge.
- The caps are the merged server's: 20 saved films per account and 1 MB per film. The page tells the person when the cap is reached and never raises it.
- `FILM_STUDIO_CLOUD_ENABLED` (with `TENANT_PROJECTS_ENABLED`) stays off until the owner turns it on, staging first.
- The ten non-English translations of the new text are machine quality and need native review before the flag is turned on for those languages.

## Known limits

- A same-account token refresh refetches the list and can briefly hide the panel; a Remove or Open confirmation that is open at that moment is cancelled.
- The 429 body read in the shared gateway has a size limit but no time limit.
- Focus is not moved after Open or Remove, and an empty list renders no empty-state line.
- The UI test checks the component source, not rendered behaviour; the pure, storage and gateway tests exercise behaviour.
- When the save request cannot be built because the session or account no longer matches, or a first save gets a 404 because the flag was turned off mid-session, the message reads "This film is no longer in your account", which is not exactly true in those two cases.
- The English rate-limit text mentions "a minute" and a seconds count together; changing it means changing all 11 languages together.
