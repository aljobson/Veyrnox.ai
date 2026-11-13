# S4 review round 1 — advisory revision report

T0 and F1–F9 source fixes are implemented in this checkout. PHOTO_STUDIO_ENABLED
remains the literal `false`. No commit, staging, push, publication, dependency
installation, simulator/native build, preview server or worktree creation occurred.
The only dependency declaration change is the host-authorized esbuild devDependency.
Its mobile lockfile update remains blocked as described below.

The supplied PLAN.md is now readable and its SHA-256 matches
`81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.
All source paths were resolved inside this checkout. Existing uncommitted S4 work
was preserved. The host's prior root proof (7,974 tests, lint, knowledge and i18n)
is treated as prior evidence, not re-labelled as proof run by this revision.

## Fix dispositions

| Finding | Change and proof |
| --- | --- |
| T0 | Purchases VM stubs only the unrelated asset-preparation hook and supplies Metro's assetExts default. All native-purchases resolver/SDK assertions remain intact and pass. |
| F1 | History begin/commit transaction replaces the present during a drag; release/termination commits once. StrengthSlider propagates boundaries through every effect/strength control; accessibility steps commit individually. A 200-step drag is one undo entry and undo restores the entire pre-drag stack. |
| F2 | Inactive overlays do not invalidate inference. Backgrounding invalidates an inference-generation export lease and clears readiness. Active return sets loading and starts fresh inference; saving stays blocked until an accepted result and rendered preview. A permission operation cannot outlive its lease and export a reduced stack. Lifecycle tests cover inactive, background, refresh and stale results. |
| F3 | Mobile explicitly declares esbuild 0.28.2, already pinned in the root lockfile. Preparation imports esbuild by package name and preflights required root files/SDK inputs with actionable errors. ADR states the full-monorepo/root-install/mobile-devDependency assumptions and that they are unverified without an EAS dry run. Mobile package-lock update needs host npm access. |
| F4 | A format parameter preserves JPEG quality 92 and .jpg for renderLook/saveLookToPhotos; Live Edit stays PNG. Shared renderer and ownership/cache cleanup remain. Jest asserts both legacy entry points encode JPEG q92 and Live Edit encodes PNG. Native objects dispose through finally blocks before the cache-file write; the test verifies this ordering. |
| F5 | Previous pictures are held in a ref until replacement presentation; readiness waits for a tiny asynchronous native Canvas snapshot after the render commit. Snapshots are disposed without encoding/persisting them. Four immutable RuntimeEffects are cached by source; arbitrary sources cannot grow the cache. Tests cover swap/disposal/readiness ordering and compile-once behavior. |
| F6 | A unit-tested helper strips query/fragment and decodes local file paths before comparison; about:blank is allowed. Other local documents, malformed encodings and remote origins remain denied. |
| F7 | Metro and EAS share one literal-boolean reader and stub writer. Expressions/ambiguous declarations throw. Dark mode always overwrites prepared HTML and removes its manifest. Tests execute both actual entry points against prepared fixtures. The checkout's ignored prepared runtime was replaced with the dark stub. |
| F8 | New locale entries match adjacent four-space indentation. A distinct liveEdit.framePosition key labels the slider in all 11 locales. Existing tooling regenerated length-review JSON; no review JSON was manually edited. Locale completeness, registry, wiring and review checks pass. All review JSON was regenerated; byte output remains unchanged in this revision. |
| F9 | smoothing.js now exports the canonical skin kernel radius, pixel step, spatial/range coefficients, strength scale, face inset and mask exclusions/expansion. Both web and mobile consume these values; the web numeric behavior is unchanged. Mobile syncs this sixth module and parity tests check tables and renderer wiring. ADR explicitly says stickers are web-only and explains temporal filtering versus skin smoothing. |

## Proof output

Requested command, run from the checkout root (the shell stays in apps/mobile for tsc):

```sh
cd apps/mobile && npx jest __tests__/purchasesNativeBuild.test.ts __tests__/liveEdit; npx tsc --noEmit
```

- Jest: **11 suites passed; 54 tests passed; 0 snapshots; 3.703 seconds**.
- TypeScript: **exit 0**, no diagnostics.
- Additional mobile i18n/legacy-screen checks: **3 suites / 459 tests passed**
  (`appTranslations`, `i18nWiring`, `instantLooksScreen`).
- Existing web math/makeup tests: **10 passed**; this includes SDK 1.0.1 canonical
  landmark-chain checks and unchanged web blend references.
- Changed mobile source Expo lint: **exit 0** (`--quiet`).
- Changed web bilateral/mask/shared-smoothing ESLint: **exit 0**.
- Knowledge check: **current, 120 routes / 62 document sections**.
- Shared engine sync --check, English registry, sync-web-i18n --check,
  check-app-i18n, git diff --check: **pass**.
- Software Skia proof still runs in focused Jest: all shaders compile, zero
  strength preserves pixels, seven makeup layers render, protected regions and
  hair/background checks pass, and combined PNG/replayed preview match exactly.
  This is not native-device proof.

Transient proof logs: `/tmp/s4-revision-jest.log`,
`/tmp/s4-revision-typecheck.log`, `/tmp/s4-revision-i18n-tests.log`,
`/tmp/s4-revision-root-focused.log`, `/tmp/s4-revision-lint.log`,
`/tmp/s4-revision-web-lint.log`, `/tmp/s4-revision-i18n-check.log`.

## Blocked actions and limitations

The authorized npm lockfile-only operation was attempted twice, with scripts,
audit and funding calls disabled. Offline npm returned **ENOTCACHED** for esbuild
metadata; the registry attempt returned **ENOTFOUND registry.npmjs.org**. No package
was installed and apps/mobile/package-lock.json is unchanged. The host must run:

```sh
cd apps/mobile
npm install --package-lock-only
```

This is the work order's explicit fallback, not a silent dependency change.
`apps/mobile/package.json` declares only `esbuild: "0.28.2"` as the new devDependency.
Do not run an immutable npm/EAS install until the host updates the mobile lockfile.
Current local tests resolve the already-installed pinned root esbuild package.

No EAS dry run, native render/permission/WebView test, screenshots or physical
latency/memory qualification was attempted. Full mobile/root suites and full lint
remain the host's responsibility for this revision. The known SmartCutPreview
lint error is pre-existing and the file is untouched. No blocked action was
retried through an alternate security boundary or an approval escalation.

Web edits are limited to extracting unchanged numeric parameters into the shared
smoothing descriptor and consuming that descriptor in the existing shader/mask,
which is necessary for F9 parity. Mobile's previously independent coefficients
now follow those web values; cross-platform antialiasing is not claimed identical.
No other web photo-studio behavior, worker, middleware, migration or deployment
configuration changed. lib/generatedProductInventory.js remains untouched.

Prior scope limitations remain: clips are selectable still-frame sources, not
whole-video export; wigs/camera/3D are excluded. New files remain under 500 lines;
mandated pre-existing locale/review files retain their existing longer format.
No other worktree was inspected for removal or archived; this dirty checkout
remains active and other chats' environments were preserved.

## Files changed in this revision

- `apps/mobile/__tests__/purchasesNativeBuild.test.ts`
- `apps/mobile/__tests__/liveEditExport.test.ts`
- `apps/mobile/__tests__/liveEditParity.test.ts`
- `apps/mobile/__tests__/liveEditPreview.test.tsx` (new)
- `apps/mobile/__tests__/liveEditRevision.test.ts` (new)
- `apps/mobile/__tests__/liveEditRuntimeEffects.test.ts` (new)
- `apps/mobile/package.json` (esbuild devDependency only in this revision)
- `apps/mobile/scripts/build-live-edit.mjs`
- `apps/mobile/scripts/ensure-live-edit.cjs`
- `apps/mobile/scripts/live-edit-build-state.cjs` (new)
- `apps/mobile/scripts/prepare-live-edit.mjs`
- `apps/mobile/scripts/proof-live-edit-skia.mjs`
- `apps/mobile/scripts/sync-live-edit.mjs`
- `apps/mobile/src/components/StrengthSlider.tsx`
- `apps/mobile/src/components/liveEdit/EffectControls.tsx`
- `apps/mobile/src/components/liveEdit/EffectPhoto.tsx`
- `apps/mobile/src/components/liveEdit/LiveEditScreen.tsx`
- `apps/mobile/src/components/liveEdit/VisionBridge.tsx`
- `apps/mobile/src/lib/lookExport.ts`
- `apps/mobile/src/lib/liveEdit/engine.ts`
- `apps/mobile/src/lib/liveEdit/geometry.ts`
- `apps/mobile/src/lib/liveEdit/lifecycle.ts` (new)
- `apps/mobile/src/lib/liveEdit/navigation.ts` (new)
- `apps/mobile/src/lib/liveEdit/runtimeEffects.ts` (new)
- `apps/mobile/src/lib/liveEdit/renderEffectStack.ts`
- `apps/mobile/src/lib/liveEdit/shaders.ts`
- `apps/mobile/src/lib/liveEdit/smoothing.ts` (new typed facade)
- `apps/mobile/src/lib/liveEdit/shared/smoothing.js` (new generated copy)
- `packages/live-edit/smoothing.js`
- `app/veyrnox/_lib/liveEdit/bilateral.js`
- `app/veyrnox/_lib/liveEdit/masks.js`
- `apps/mobile/src/lib/i18n/messages/en/liveEdit.ts`
- `apps/mobile/src/lib/i18n/messages/app/{ar,de,es,fr,hi,ja,ko,pt,ru,zh}.ts`
- `docs/adr/0335-local-photo-studio.md`
- `docs/mobile/S4-LIVE-EDIT-REPORT.md` (historical-report pointer)
- `docs/mobile/S4-LIVE-EDIT-REVISION.md` (this report)

## Design goal criteria

Source inspection is distinguished from device proof. These are the goal lines
from `docs/design-goal-criteria.md`, with mobile applicability and known gaps.

The goal is met when…

- **checked — source: one route title and status.** No piece of information appears twice on one screen (a balance, a price, a title or a status is shown in one place).
- **checked — source: new screen uses ds.space, gutter 20; reused spacing values are existing steps.** Mobile: every gap, padding and margin is a `ds.space` step (2/4/8/12/16/20/24/32/40/56), and the screen gutter is 20.
- **not applicable — no web layout changes.** Web: every gap is on the Tailwind 4 px scale, with no arbitrary `[13px]` values.
- **checked — shared mobile buttons use existing radii; no new nested radius treatment.** Mobile radii come from the set 6/10/14/20/28/999 and web radii from `rounded-xl` (16), `rounded-2xl` (24) and `rounded-3xl` (32). An inner piece has a smaller radius than the card around it, never the same or larger.
- **checked — no new shadows.** Light-mode shadows use `e1` or `e2` only. Dark and OLED mode have no shadow, so depth comes from `bgElevated1`, `bgElevated2` and `surface`.
- **checked — source: save is the single primary action.** Rhythm is intentional: not every section has the same padding, and the page has one clear primary action (`.claude/rules/ecc/web/design-quality.md`).
- **checked — interface colours use theme tokens; shader/mask colours are effect data.** Mobile: no hex or `rgb()` literal outside `theme.ts`; every colour is a semantic token (`bg`, `surface`, `textPrimary`, `accent`, `danger`…).
- **not applicable — no web UI changes.** Web: every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`, `text-vx-accent`…), and both themes are checked.
- **checked — source: accent actions, danger error text, no money styling.** Amber (`money` / `warning`) appears only on money and credit amounts. Aqua (`accent`) marks actions. `danger` marks errors and destructive actions only.
- **not checked — native theme/accent contrast measurements require host review.** Text on its background is at least 4.5:1 (3:1 for large text and for icons and borders that carry meaning), in light, dark and OLED, and for each of the five mobile accents.
- **not checked — new screen uses shared Text variants; reused LookStrip/StrengthSlider retain legacy typography and need device review.** Fonts: web uses Inter (body), Archivo (display) and JetBrains Mono (small labels) and nothing else. Mobile uses only the selected Typeface pair (studio, editorial or technical). Mobile text uses a `type` step, with no numeric `fontSize` on the screen.
- **checked — no new 800/900 font weights.** No weight 800 or 900 in new mobile code (ADR-0264).
- **not applicable — no marketing visuals.** No model or provider is shown failing in marketing visuals; say the refund promise in words.
- **checked — new customer-facing copy contains neither terminology.** Nothing on a customer-facing surface uses wallet or on-chain wording (`scripts/check-hard-wall.sh`).
- **checked — source: shared controls >=44 pt and save 52 pt.** Every tappable control is at least 44 pt (mobile) or 44 CSS px (web touch). A visually small mobile button gets `hitSlop` to reach 44. Primary buttons are 52.
- **not checked — no simulator at XL/OS 1.5 scaling.** At the largest in-app text size (XL, ×1.25) and at OS scaling 1.5 nothing is clipped, overlapped or pushed off-screen, and the primary button is still visible without horizontal scroll.
- **checked — source: accessible labels and announced status text; device screen-reader verification remains outstanding.** Every control has an accessible name, and every status change (loading finished, error shown, saved) is announced, not only coloured.
- **not applicable — no new web controls.** Every focusable web element shows a visible focus ring and can be reached and used from the keyboard.
- **checked — source: shared buttons and the slider honor reduced motion; no looping animations.** With reduced motion on, press scaling, confetti and looping animation are off and the screen still makes sense.
- **not checked — 375/1280 visual proof not run.** Layout holds at 375 px wide and at 1280 px wide with no horizontal page scroll.
- **not applicable — no price/balance UI.** Every price and balance is read from the catalog or the API. No price is computed in the app layer.
- **not applicable — no credit spend.** Before a Credit spend, the user sees the exact cost; after it, the new balance. A failed submit shows that the Credits were returned.
- **not applicable — local save has a busy guard, no paid request.** A paid action cannot be double-submitted: the button is disabled while the request runs and the request carries an idempotency key.

Reachable state criteria:

- **checked — source: intro and picker action. Empty:** Before any data, the screen says what belongs here and offers one action that fills it. It is not a blank list.
- **not checked — loading notice exists; native 100 ms placeholder/layout timing is unmeasured. Loading:** A placeholder with the final layout shows within 100 ms, so the page does not jump when data arrives.
- **checked — localized retry/picker actions, no raw exception payload. Error:** The message says what failed and what to do next, has a retry, and shows no stack trace, DB message or vendor payload. Error codes stay `kebab_case`.
- **not checked — offline architecture is implemented; native offline first launch requires host proof. No internet:** The screen shows an offline notice and keeps already-loaded content readable. Actions that need the network say so instead of failing silently.
- **not applicable — no runtime network processing. Slow network:** After about 3 s a progress cue shows what is happening (step, count or percent), not only a spinner. Long jobs show the job state.
- **not applicable — no service calls. Service outage:** One banner, driven by `/api/status`, on web and in the app.
- **not applicable — no search. No search results:** The query is echoed back, with a clear-filters action and two or more suggestions. It is not a dead end.
- **checked — localized Settings guidance and a way back; native permission sheet unverified. Permission denied:** It says why (not signed in, not an administrator, plan, MFA needed) and gives one way back or forward. A 403 is not shown as one generic message.
- **not applicable — transient local work is cleared on owner change, no server submit/draft. Session expired:** The user's unsent input is kept, the screen asks them to sign in again, and returns them to the same place afterwards.
- **checked — local source bounds show localized actionable text; effect values are bounded. Form validation:** Each error is shown next to its field as soon as the field is left, in words, with `danger` colour plus text. The submit button is never the only place an error appears.
- **checked — save confirmation, no credits or celebration. Success:** It confirms what happened (and the Credits spent, if any), then shows the next step. Celebrations are one-time milestones, not on every result (ADR-0264).

- **Not checked — native S4 acceptance:** matching on-device preview/export pixels, WKWebView and Android inference, measured latency/peak memory, physical-device quality and permission behavior require host evidence.
