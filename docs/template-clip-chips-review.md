# PLAN-CHIPS implementation review (advisory)

Work order SHA256 verified:
`02981ed0fb9ba034ae689f5b95e662ac9dbc1e8bee210ac33ab6ef03190cfd1d`.
All source paths were resolved in this checkout. No commits, pushes,
publication, production access, migrations, real clip downloads/uploads or
paid provider calls were performed. Tests use synthetic clips and mocked
network/storage. The shipped manifest remains empty; the flag remains absent.

Implemented: 771 generated eligible video ids, a local-first bulk importer
with checkpoint/resume and compact manifest output, shared prompt validation
and provider mapping, effective-prompt replay/admission identity, web chips,
native reference row and editable text, translated copy and ADR amendment 2.
C-01 and C-02 are included; C-03′ replaces the discarded provenance proposal.

## Proof

Final exact requested command:

```sh
node --test tests/templateClip*.test.mjs tests/seedanceReference.test.mjs tests/swapScene*.test.mjs tests/routesOutsideGate.test.mjs
```

Exit 0. Final output:

```text
ℹ tests 197
ℹ suites 0
ℹ pass 197
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
```

Full log: `/private/tmp/template-chips-proof-verified.log`.

The tests include paid/free concurrent admission, changed-prompt conflicts,
omitted/default equivalence and changed-default conflicts, both provider
mappings, existing refund behavior, bulk failure/resume, escaping symlinks,
900-entry module size, registry drift and all local MP4s, client request
bodies/retry keys, and flag-off markup/render-tree snapshots. Snapshots freeze
hashes of the original checkout with stable catalog/translation/child mocks;
they are not browser or device tests.

Additional checks:

- Portable token-parser refinement: 7 focused tests passed after removing lookbehind.

- Legacy template generation tests: 16 passed, 0 failed. The old structural
  assertion now explicitly allows the required C-01 clip branch.
- Web i18n catalog/parity tests: 17 passed in the focused run; no i18n failures.
- Mobile `sync-web-i18n.mjs --check`: Up to date. `check-app-i18n.mjs`: passed
  after regenerating four changed length-review files.
- `npm run sync:vey-knowledge`: completed (101 routes, 62 document sections); the final artifact changes only its version and route source hash, preserving all existing copy.
- `bash scripts/check-hard-wall.sh`: HARD WALL clean.
- `git diff --check`: passed.
- ESLint on changed JS/TS sources: exit 0, 0 errors (15 warnings: existing catalog export style and React effect warnings). The `.d.mts` declaration also passes using `--parser @typescript-eslint/parser`. A later redundant UseTemplate-only lint rerun remained pending after more than 600 seconds with no output. Its process was identified by the task-specific log; the sandbox denied termination. The final paragraph-only change is covered by the passing frozen-markup snapshot, but that last lint rerun did not complete.

Earlier focused runs caught an obsolete legacy-gate assertion and a snapshot
mock's default-import error; both were corrected and rechecked. Initial lint
also caught importer variable naming and the root parser's lack of `.d.mts`
support; the declaration is checked separately with the TypeScript parser.

## Denied, blocked and deferred checks

- The shared build-slot wrapper failed before starting its child: sandbox
  denied opening `~/.local/share/storage-guard/build-slot.lock`. The exact
  targeted Node proof ran directly as a focused check. Full `npm test` and
  full native Jest were not run; no alternate lock or bypass of the shared
  heavy-build safeguard was used. The known socialActivityCursor failure was
  therefore not independently reproduced here.
- No ARTEMIS tools were exposed. `uv run artemis doctor` initially failed
  because its default cache was outside writable roots. Retrying offline
  with a temporary cache ran the doctor, which reported blocking MCP/IDE
  integration, multimodal credentials and Android device availability. No
  app exploration, device-based tests, simulator or browser run is claimed.
- The required consolidated mobile checkout exists, but its lockfile differs
  in 184 package versions/entries (including missing expo-audio and PostHog).
  The owner prohibits sharing incompatible node_modules. No symlink or new
  dependency installation was made. Native Jest and `tsc --noEmit` remain
  unverified. Pure mobile request/retry behavior and a render-tree snapshot
  run through TypeScript transpilation in Node instead; these do not replace
  native type checking or ARTEMIS verification.
- The final redundant UseTemplate-only lint process remained pending for over 600 seconds with an empty log. `lsof` identified PID 6560 holding only the task-specific lint log; `kill -TERM 6560` was denied with operation not permitted. It may still be running. No unrelated process was targeted. The earlier changed-file lint pass remains available, and the later portable-prompt lint also exited 0.
- An optional process-list diagnostic (`ps`) was denied by the sandbox. It
  made no changes and was not needed to implement the feature.
- No new worktree, native build, Metro/mock server or preview was created.
  Existing worktrees were listed read-only; none can be established as unused
  from this task, so no other session's checkout was archived or removed.

## Deviations and review decisions

1. Verification deviation proposed for independent review: retain the focused
   Node proofs now; run full npm/Jest/TypeScript and device/browser checks in
   an environment with the shared build lock and matching dependencies before
   accepting A6/A8 as fully verified. No native Jest test file was authored
   without the required ARTEMIS exploration; the native pure helpers are
   exercised by the compiled Node tests instead.
2. Existing web translation catalogs, review JSON and generated knowledge
   already exceed 500 lines. Their established
   structure is preserved; all newly authored executable modules and edited
   non-generated feature code are below 500 lines. This is a reported
   exception to the literal all-files limit, not a silent catalog refactor.
3. The registry's compatibility projection retains `{id, name, kind}` while
   deriving `name` from the id to honor the ids/filenames-only data constraint.
   Page titles still use the original catalogs. `kind` no longer gates
   registration. Native plain-text tokens with the reference row are the
   explicitly allowed E implementation, not a new product design.

The owner-only activation, rights, pricing, real-selfie and provider-token
probes remain blocking as described in ADR-0333 amendment 2.

## Design goal criteria

Scope: web UseTemplate / TemplateClipComposer and native TemplatePage /
TemplateClipComposer. “Checked” below means the stated source/test evidence,
not visual approval. Existing flag-off layout is intentionally preserved.

### Layout and spacing

The goal is met when:

- No piece of information appears twice on one screen (a balance, a price, a title or a status is shown in one place). **not checked — full-page duplication not visually reviewed; reference thumbnails repeat by explicit design.**
- Mobile: every gap, padding and margin is a `ds.space` step (2/4/8/12/16/20/24/32/40/56), and the screen gutter is 20. **not checked — new native spacing uses listed steps; inherited page gutter remains unchanged.**
- Web: every gap is on the Tailwind 4 px scale, with no arbitrary `[13px]` values. **checked — new composer spacing uses standard Tailwind steps; inherited classes preserved.**
- Mobile radii come from the set 6/10/14/20/28/999 and web radii from `rounded-xl` (16), `rounded-2xl` (24) and `rounded-3xl` (32). An inner piece has a smaller radius than the card around it, never the same or larger. **checked — new composer uses rounded-xl; native row 14 and inner thumbnail 10.**
- Light-mode shadows use `e1` or `e2` only. Dark and OLED mode have no shadow, so depth comes from `bgElevated1`, `bgElevated2` and `surface`. **checked — new components add no shadows and use semantic backgrounds.**
- Rhythm is intentional: not every section has the same padding, and the page has one clear primary action (`.claude/rules/ecc/web/design-quality.md`). **not checked — primary Generate is retained; no visual layout review.**

### Colour, type and brand

The goal is met when:

- Mobile: no hex or `rgb()` literal outside `theme.ts`; every colour is a semantic token (`bg`, `surface`, `textPrimary`, `accent`, `danger`…). **checked — new native component uses semantic theme tokens, no color literals.**
- Web: every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`, `text-vx-accent`…), and both themes are checked. **not checked — new web colors use vx tokens; themes not visually tested.**
- Amber (`money` / `warning`) appears only on money and credit amounts. Aqua (`accent`) marks actions. `danger` marks errors and destructive actions only. **checked — new actions use accent, validation uses danger; pricing unchanged.**
- Text on its background is at least 4.5:1 (3:1 for large text and for icons and borders that carry meaning), in light, dark and OLED, and for each of the five mobile accents. **not checked — no contrast/device/theme measurement.**
- Fonts: web uses Inter (body), Archivo (display) and JetBrains Mono (small labels) and nothing else. Mobile uses only the selected Typeface pair (studio, editorial or technical). Mobile text uses a `type` step, with no numeric `fontSize` on the screen. **checked — inherited web font stack and native Text variants, no new font family or numeric native font size.**
- No weight 800 or 900 in new mobile code (ADR-0264). **checked — no new native numeric font weights.**
- No model or provider is shown failing in marketing visuals; say the refund promise in words. **not applicable — no marketing visual authored.**
- Nothing on a customer-facing surface uses wallet or on-chain wording (`scripts/check-hard-wall.sh`). **checked — hard-wall script passed.**

### Ease of use and accessibility

The goal is met when:

- Every tappable control is at least 44 pt (mobile) or 44 CSS px (web touch). A visually small mobile button gets `hitSlop` to reach 44. Primary buttons are 52. **not checked — new web buttons use min-h-11/min-w-11; native shared buttons reused, no device measurement.**
- At the largest in-app text size (XL, ×1.25) and at OS scaling 1.5 nothing is clipped, overlapped or pushed off-screen, and the primary button is still visible without horizontal scroll. **not checked — largest font / OS scaling not run.**
- Every control has an accessible name, and every status change (loading finished, error shown, saved) is announced, not only coloured. **checked — controls have translated names and validation status/live-region text; screen-reader behavior not device-tested.**
- Every focusable web element shows a visible focus ring and can be reached and used from the keyboard. **not checked — new focusable controls have explicit focus-visible rings; keyboard behavior needs browser proof.**
- With reduced motion on, press scaling, confetti and looping animation are off and the screen still makes sense. **checked — new composer introduces no animation; inherited motion behavior unchanged.**
- Layout holds at 375 px wide and at 1280 px wide with no horizontal page scroll. **not checked — source uses wrapping and bounded widths, but no 375/1280 viewport run.**

### Money screens

The goal is met when:

- Every price and balance is read from the catalog or the API. No price is computed in the app layer. **checked — projection/catalog pricing and both debit amounts covered by Node tests.**
- Before a Credit spend, the user sees the exact cost; after it, the new balance. A failed submit shows that the Credits were returned. **not checked — price/refund/balance code retained and tested; full visible journey not run.**
- A paid action cannot be double-submitted: the button is disabled while the request runs and the request carries an idempotency key. **checked — pending gates retained; identical retries and concurrent admissions covered with mocks.**

### States

The goal is met when:

| State | Done when | Review |
| --- | --- | --- |
| Empty | Before any data, the screen says what belongs here and offers one action that fills it. It is not a blank list. | checked — add-photo slot and existing picker retained |
| Loading | A placeholder with the final layout shows within 100 ms, so the page does not jump when data arrives. | not checked — inherited flow, no browser/device run |
| Error | The message says what failed and what to do next, has a retry, and shows no stack trace, DB message or vendor payload. Error codes stay `kebab_case`. | not checked — inherited flow, no browser/device run |
| No internet | The screen shows an offline notice and keeps already-loaded content readable. Actions that need the network say so instead of failing silently. | not checked — inherited flow, no browser/device run |
| Slow network | After about 3 s a progress cue shows what is happening (step, count or percent), not only a spinner. Long jobs show the job state. | not checked — inherited flow, no browser/device run |
| Service outage | One banner, driven by `/api/status`, on web and in the app. | not checked — inherited flow, no browser/device run |
| No search results | The query is echoed back, with a clear-filters action and two or more suggestions. It is not a dead end. | not applicable — composer has no search |
| Permission denied | It says why (not signed in, not an administrator, plan, MFA needed) and gives one way back or forward. A 403 is not shown as one generic message. | not checked — inherited flow, no browser/device run |
| Session expired | The user's unsent input is kept, the screen asks them to sign in again, and returns them to the same place afterwards. | not checked — inherited flow, no browser/device run |
| Form validation | Each error is shown next to its field as soon as the field is left, in words, with `danger` colour plus text. The submit button is never the only place an error appears. | checked — shared tag/length checks, field error copy and Generate gating; device interaction remains unverified |
| Success | It confirms what happened (and the Credits spent, if any), then shows the next step. Celebrations are one-time milestones, not on every result (ADR-0264). | not checked — inherited flow, no browser/device run |

The goal is met when the selected template clip and one photo reach the projected model with the displayed edited prompt, while unavailable templates preserve their prior path. **Checked with mocked admission/client tests; output fidelity requires the owner probe.**

## Files changed

54 files; no files outside this checkout were edited. Temporary proof logs were written under `/private/tmp`; the task-owned diagnostic cache was removed.

- `app/api/v1/generations/route.js`
- `app/veyrnox/_components/TemplateClipComposer.js`
- `app/veyrnox/_components/UseTemplate.js`
- `app/veyrnox/_lib/templateClips.d.ts`
- `app/veyrnox/_lib/templateClips.js`
- `app/veyrnox/_lib/templateGenerate.js`
- `app/veyrnox/_lib/useTemplateGenerate.js`
- `apps/mobile/src/app/(app)/templates/[id].tsx`
- `apps/mobile/src/components/templates/TemplateClipComposer.tsx`
- `apps/mobile/src/lib/i18n/messages/ar.ts`
- `apps/mobile/src/lib/i18n/messages/de.ts`
- `apps/mobile/src/lib/i18n/messages/en.ts`
- `apps/mobile/src/lib/i18n/messages/en/templateClip.ts`
- `apps/mobile/src/lib/i18n/messages/es.ts`
- `apps/mobile/src/lib/i18n/messages/fr.ts`
- `apps/mobile/src/lib/i18n/messages/hi.ts`
- `apps/mobile/src/lib/i18n/messages/ja.ts`
- `apps/mobile/src/lib/i18n/messages/ko.ts`
- `apps/mobile/src/lib/i18n/messages/pt.ts`
- `apps/mobile/src/lib/i18n/messages/ru.ts`
- `apps/mobile/src/lib/i18n/messages/zh.ts`
- `apps/mobile/src/lib/i18n/review/es-length.json`
- `apps/mobile/src/lib/i18n/review/fr-length.json`
- `apps/mobile/src/lib/i18n/review/hi-length.json`
- `apps/mobile/src/lib/i18n/review/pt-length.json`
- `apps/mobile/src/lib/i18n/webKeys.json`
- `apps/mobile/src/lib/templateGenerate.ts`
- `docs/adr/0333-template-clip-reference.md`
- `docs/template-clip-chips-review.md`
- `lib/generatedProductInventory.js`
- `lib/i18n/messages/ar.mjs`
- `lib/i18n/messages/de.mjs`
- `lib/i18n/messages/en.mjs`
- `lib/i18n/messages/es.mjs`
- `lib/i18n/messages/fr.mjs`
- `lib/i18n/messages/hi.mjs`
- `lib/i18n/messages/ja.mjs`
- `lib/i18n/messages/ko.mjs`
- `lib/i18n/messages/pt.mjs`
- `lib/i18n/messages/ru.mjs`
- `lib/i18n/messages/zh.mjs`
- `lib/templateClipPrompt.d.mts`
- `lib/templateClipPrompt.mjs`
- `lib/templateClipReplay.js`
- `scripts/gen-template-clip-registry.mjs`
- `scripts/import-template-clips.mjs`
- `tests/templateClipClients.test.mjs`
- `tests/templateClipGeneration.test.mjs`
- `tests/templateClipImport.test.mjs`
- `tests/templateClipPrompt.test.mjs`
- `tests/templateClipRegistry.test.mjs`
- `tests/templateClipSnapshots.test.mjs`
- `tests/templateClips.test.mjs`
- `tests/templateGenerate.test.mjs`
