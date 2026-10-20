# ADR-0221: Mobile: a directory of tools for your own files (parity plan P2)

**Status:** Proposed 2026-10-20. Branched from main.

## Context

The web `/tools` page lists the models that work on a file you already have, grouped by the job they do (upscale,
remove background, expand, edit with a prompt, photo to video, talking avatar, lip sync, separate vocals, add sound to
a video, upscale video). On the phone these sat in the Create model list among everything else, with no way to find
"what can I do with this photo".

## Decision

No server change. The catalog already says which models need an upload (`capabilities.media[slot].required`), their
price and whether the app can drive them.

- Create gets a "Tools for your own files" row beside Templates. It opens **Tools** (`/create/tools`): a group per job,
  each with its blurb and its models, showing what each needs ("Needs an image and audio") and its from-price. A tool
  opens the same Create form as any other model, where the file is chosen from the phone or the Library (ADR-0190) and
  the price is shown before Generate.
- Task names, blurbs and order come from `lib/toolDirectory.ts`, a copy of `app/veyrnox/_lib/tools.js`; a test reads that
  file and fails if the tasks, their order or their models differ. A required-upload model the table does not name still
  shows under "More tools", so a new catalog row is never hidden.
- The phone lists only models it can drive (`isSupported`); a tool the app cannot run yet is absent, not shown broken.
  The web's other columns (SEO text, model pages) are not needed.
- English only for the task names and blurbs for now, as on other app-only strings; the new UI strings are in
  `docs/mobile/I18N-NEW-KEYS.md`.

## Not proved

`tsc` and Jest only (owner disk rule); not seen on a phone. Which tools the live catalog currently offers (and whether
each is supported by the app) was not checked against a server.
