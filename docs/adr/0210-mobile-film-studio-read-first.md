# ADR-0210: Mobile Film Studio, first slice (parity plan P8)

**Status:** Proposed 2026-10-20. Builds on ADR-0130 (film masters in the phone Library) and ADR-0182 (Film skill chats).

## Context

Film Studio on the web (`/app/film-studio`) is seven planning stages kept in the browser, per account, with JSON and ZIP
export. It has no server copy: `docs/product/film-studio.md` says it does not use the Projects API, and the only server
parts are film masters (`library/masters`, gated by `FILM_LIBRARY_MASTERS_ENABLED` / `FILM_LIBRARY_SAVE_ENABLED`) and
ordinary generations. So there is no list of film projects to fetch.

## Decision

- **A read-only copy, opened from the web's export.** The phone picks the studio JSON (document picker), validates it
  with a copy of the web's schema, size, bounds and identifier checks (`src/lib/filmStudio.ts`, from
  `filmStudioStorage.js`), and keeps the text in the per-account cache (`POLICIES.filmStudio`, 90 days). Sign-out,
  account deletion and a change of user remove it. Opening a newer export replaces it; **Remove from this phone** clears it.
- **Status is worked out with the web's rules.** Stage issues, asset locks (the same lock context) and prompt currency are
  copies of `filmStudio.js`; `__tests__/filmStudio.test.ts` loads the web source and compares the results on the same
  studios, so a rule changed on the web and missed here fails the test.
- **Screens.** `/film`: summary, the seven stages with what is left and a Continue on web row, the shot list, links to
  Film masters (`/library/files`, ADR-0130), Film chats (`/chat/new`, ADR-0182) and the web. `/film/shot/[id]`: assets
  with locked/draft, the shot card, attempts, the prompt.
- **Starting a generation.** For a shot whose assets are all locked and whose latest prompt still matches them, the
  screen shows the catalog price (`estimateCredits` for the shot's seconds, for the studio's video model matched by id or
  name) and **Open in Create**, passing the model, full prompt and length. Nothing is charged here: Create shows the price
  again and charges only on Generate. Not offered when the model is gated or missing from the price list, lacks the
  length, the prompt exceeds the model's limit (never cut short; **Share the full prompt** instead), the prompt is out of
  date, an asset is draft, or a take is already accepted.
- **Protected paths untouched.** Masters stay behind the existing Library endpoints and upload ticket flow; this slice
  reads no master bytes and writes nothing to the server.

## Not built (shown as Continue on web)

Editing any stage, reference boards, asset passports, stress tests and locking, writing prompts and logging attempts,
the studio ZIP export, preparing the 1920×1080 master and saving it to the Library (ADR-0085), image generation for tests,
and creating a studio from scratch on the phone.

## Not proved

Unit tests only (rules agree with the web source on built studios, import limits, hand-off price and refusals, per-account
copy). No device run, no real Create hand-off, no document picker on iOS/Android. The studio's video model is matched by
name against the catalog; a name the catalog spells differently falls back to the web.

## Consequences

No server, flag or migration change. One new cache policy and two routes under `(app)`; a link in Library files.
