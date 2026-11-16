# ADR-0344: Film Studio is hidden from the app and the website

Status: accepted 2026-11-16; the owner decided in chat after an iOS QA pass. Amends [ADR-0210](0210-mobile-film-studio-read-first.md), [ADR-0245](0245-film-studio-cloud-saves.md), [ADR-0252](0252-film-studio-phone-list.md) and [ADR-0253](0253-film-studio-web-saves.md).

## Context

One 10-second shot needs about 19 required fields in film vocabulary, exact asset tags such as `@room:v1`, and a seven-stage flow. The "This clip contains one action" control also rendered invisibly and blocked the flow (QA row 7.F3). The owner judged Film Studio too complex for normal users: "if it is, let's remove it from both App and Web".

## Decision

Hide, do not delete. One switch per client, both `false`:

- `apps/mobile/src/lib/filmStudioSwitch.ts` (`FILM_STUDIO_ENABLED`)
- `app/veyrnox/_lib/filmStudioSwitch.js` (`FILM_STUDIO_ENABLED`)

**Hidden on mobile:** the Explore home card (`phoneStarts` no longer returns `film`), search, "Open Film Studio" in LLM Chat (skills screen and empty chat), the Film skills group and the "Consistent film" workflow, "Open your film in Film Studio" in Library > Video files. Links to `/film`, `ai.veyrnox.app://film` and `/app/film-studio` open Home (`+native-intent`).

**Hidden on the web:** the Explore starter card, the "Make a film" header link, the studio menu entry, the Film link and group in Studio skills, the "Consistent film" workflow, "Build in Film Studio" on template pages, "Prepare in Film Studio" on Dialogue cast portraits, and the Vey help and knowledge entries. `/app/film-studio` answers 404.

**Stays:** the tables `film_studio_projects`, the `save_film_studio` and `remove_film_studio` RPCs and migrations; `/api/v1/film-studio*`; Library "Film masters" (existing masters stay listed, downloadable and shareable); the screens' code, the film chat skills' definitions and their translations; users' saved films and browser-stored studios. The `/film` screens still exist in the app bundle but nothing reaches them.

No production variable, secret or migration changes.

## Restore

Set both switches to `true`, run `npm run sync:vey-knowledge`, restore the removed Vey knowledge articles (`film-studio`, `film-stages`, `film-export`) and help targets from git history of this change, add the "Make a film" entry back to `PRIMARY_NAV_CATEGORIES`, and revert the pinned tests changed here.
