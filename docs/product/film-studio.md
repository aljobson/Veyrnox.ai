# Film Studio

The seven-stage workspace at `/app/film-studio` adapts the production workflow described in [Machina’s Film Studio skills](https://github.com/machina-exm/film-studio-skills). It is implemented as native forms and checks, with original assistant instructions. The source skills are not installed or executed on the server.

1. **Setup:** explicitly choose the existing image and video workflows, clip length (10–15 seconds) and format. External tools use model names only; credentials stay with their original tools.
2. **Studio init:** name the studio and export its complete folder structure, four production documents, and matching `CLAUDE.md` / `AGENTS.md` configuration.
3. **Film breakdown:** capture the supplied story and three-lane, 22-field shot cards. Exact asset references use `@tag:v1`, including separate state variants. One action per clip. In-frame text gets a separate task for the edit.
4. **Reference boards:** supply captioned existing image identifiers, with 10–20 character references, 8–15 location references, 3–5 prop references, and seven independent style boards. Anti-references become the ban list. Each board needs a written approval.
5. **Asset passports:** record full descriptors and immutable reference filenames for each exact tag and version. Reference-sheet prompts contain the descriptor verbatim and five views on grey. Only draft passports can be edited; a locked identity needs a new version.
6. **Stress tests:** static-image matrices cover angles, sizes, each shot’s lighting, and every shared-frame pairing. Characters need ten repeatability images plus all scene and pairing tests. Every row requires a distinct actual output identifier and a pass. The person records the final pass decision. Changing relevant references, identity or scene conditions invalidates the lock.
7. **Shot prompts:** require all assets to be locked and all fifteen blocks to be completed. Canonical descriptors and dialogue stay verbatim. Every attempt has a result and verdict; acceptance requires six checks. Revisions change exactly one line while preserving all headings and descriptors. Fifteen failures for the current shot definition require a structural simplification.

Seven matching LLM Chat assistants appear in the Film skills group. They help write the inputs and ask one question at a time. They cannot write native approval decisions or lock assets. The ordinary chat pricing and refund path applies.

## Persistence and export

Film Studio keeps one browser studio per signed-in user. Optional account saves use an owner-only API (20 films, 1 MB each), gated by `TENANT_PROJECTS_ENABLED` and `FILM_STUDIO_CLOUD_ENABLED` (ADR-0245). Web save/open/remove ships behind both flags; phone list/open controls follow separately. Browser edits never upload automatically. Browser drafts are cleared on sign-out or account change; export before signing out. Signed-out work stays in memory and can be exported.

JSON import validates schema, size, bounds and identifiers, then asks before replacing the workspace. ZIP exports contain the folder structure, passports, tests, prompt versions, generation log, separate text tasks and accepted-take manifests in `selects`. Media stays in the Library or external workflow, referenced by stable identifiers; exports do not download it.

## Generation handoff

The workspace writes the existing sessionStorage Studio draft and opens Create. It carries the full prompt, model, aspect and supported clip length. It never submits a generation or spends Credits. The live catalog must confirm the model, input type, clip length and prompt limit first. Long descriptors are never silently shortened: prompts exceeding a model’s limit remain available to copy/export for an external workflow that accepts them. Users choose the required media and explicitly press Generate in Create.

Stress-test and take verdicts are human reviews of supplied outputs. The app enforces the recorded evidence and decisions; it does not automatically judge image similarity or generate the tests in the background.

## Verification

`tests/filmStudio.test.mjs` exercises missing-field gates, exact variants, reference counts, pairing matrices, failed/duplicate results, stale locks, descriptor and dialogue preservation, revision constraints, acceptance, the failure ceiling, account-scoped storage and exports. `tests/landingDraft.test.mjs` covers the clip-length handoff. Reticle drives the actual stage forms, imported workspaces, approvals, locks, prompt generation, acceptance and revision errors.
## Exact 16:9 accepted-take master

For a 16:9 film, an accepted take offers **Prepare 16:9 master**. A Library
job ID loads the owner's delivered video; an external take can use its video
file. The existing browser video renderer creates a 1920×1080 H.264 MP4 at
24 fps, trimmed to the shot card's length. A centre crop fills the frame
without stretching. The source generation and its Library file stay intact.

This step is required for an exact master when an image-to-video provider
inherits the start image's dimensions. Kling 3.0's aspect parameter is ignored
when frames are provided ([supplier contract](https://kie.ai/kling-3-0)).
The Film Studio format setting alone therefore does not certify the raw
supplier video's dimensions. The exported master is decoded and its exact
1920×1080 frame and duration are checked before Download is offered.

Export uses the editor's existing desktop Chromium codec qualification and
memory limits, can be cancelled and costs no Credits. Stale passports,
rejected takes, shorter videos and other film aspects are refused.

When the master was prepared from its Library job ID, confirm your rights
and press **Save to Library**. After the upload and server media checks succeed,
**View saved video** opens its native Library card. Download remains available.
Saving is free and reuses an existing card when the same source/master is
saved again. Masters are limited to 25 MiB and 100 per account, and expire
with their source take or after 90 days. Local-file exports offer Download;
direct save requires an owned Library source. Browser studio JSON and ZIP
backups still contain documents and references, not these media bytes.

If the accepted prompt's Audio block is exactly `Silent`, `Silent video` or
`No audio` (case-insensitive, with optional final punctuation), master
preparation omits any audio the provider added. Other audio directions keep
the source sound. The dimension and duration checks still apply unchanged.
