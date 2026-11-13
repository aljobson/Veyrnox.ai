# S4 mobile Live Edit — advisory implementation report

> Initial-build report. The round-1 corrections and current proof are recorded in
> [S4-LIVE-EDIT-REVISION.md](S4-LIVE-EDIT-REVISION.md); that report supersedes the
> dependency, plan-file availability, smoothing and dark-asset details below.

Status: source implementation is dark and ready for independent review. Native
qualification is outstanding, and full edited-video export is not implemented.
No release/production readiness claim is made.

Base: `aab194be347978ba5bb6fc081fbb7c8dfbffa10c`. All source paths were resolved in
this checkout. The temporary PLAN.md path supplied by the owner did not exist;
its supplied SHA-256 could not be verified. The complete plan embedded in the
work order was used, especially D1, D4, D7, S4 and the R2/R3 contracts.

## Implemented behavior

- Default-off `photoStudioFlag.ts`; the route itself renders a localized
  unavailable state on direct navigation. Create/Face Filters hide entry links.
  No query, deep-link or storage parameter can enable it.
- Local photo selection and short-clip frame selection, orientation-normalized
  PNG sources, nine instant looks, strength, smoothing, all seven makeup layers
  with shades/finish/wing/volume, hair colours/ombre/highlights, original compare,
  undo/redo, PNG save, explicit no-face/multiple-face/no-hair/retry states.
  Preview stays visible above scrolling controls. Existing LookStrip,
  InstantPhoto thumbnails and StrengthSlider are reused.
- One `renderEffectStack(source, stack, inference)` records the picture for both
  main preview and export. `lookExport.ts` delegates to it while retaining
  account ownership checks, add-only permission and cache cleanup. Full
  source-resolution PNG export includes the complete active stack.
- Five shared modules are synced verbatim and tested for byte and exported-table
  parity; existing mobile look matrices also match. Metro does not traverse the
  root React installation. No web implementation was modified.
- Bounded hidden WebView runs both Face Landmarker and Selfie Multiclass hair.
  One in-flight request, source/frame IDs, finite/range/shape validation,
  initialization/inference deadlines, cancellation and teardown isolate it from
  the rest of the screen. Exactly one face is required. Associated hair filtering
  and the shared .2–.8 confidence matte reject absent/weak hair.
- 37 literal English keys plus all ten non-English catalogs (11 locales total).
  English registry and length-review artifacts, including de-length, regenerated.
  Existing locale equality review remains valid. Native linguistic review is
  still pending under the catalog's existing machine-translation convention.
- ADR-0335 amended with bridge, offline delivery, privacy, bounds and qualification
  requirements. Images/landmarks have no upload or analytics path in this slice.
  No camera, wig, 3D, AI provider or credit-metered behavior was added.

## Delivery choice and owner decisions

Chosen design: **offline, bundled models**. `npm run prepare:live-edit` (mobile)
uses the existing five SHA-256/byte pins and prepares an ignored local HTML asset.
The pinned SDK is converted to an IIFE with already-installed esbuild; models use
buffers and WASM/loader use data URLs, avoiding sibling file:// fetch/CORS limits.
The WebView permits only this local document; its CSP has no network destination.
License notices are embedded in the bundled HTML as well as copied beside it.

Prepared asset: **43,121,909 bytes**, SHA-256
`47db4d5d94265af5a9fb785d4d985862531d7682784502707671edf10f879f24`.
Raw pinned runtime inputs total **32,366,259 bytes**. The generated asset remains
ignored, available for the host; no binary was added to Git. Base64 and duplicate
JS/WASM heaps add RAM overhead. Compressed release size and peak RAM are unmeasured.
EAS's post-install hook prepares enabled builds and excludes model bytes in dark
builds; manual native/OTA builds must run preparation before bundling. Metro
rejects enabled builds missing a valid prepared asset/source manifest.

Owner decisions before activation:

1. Accept the roughly 41.1 MiB uncompressed HTML/app-size cost and measured RAM cost.
2. Keep offline-first bundling, or separately authorize a SHA-verified first-use
   download design. No runtime download fallback was added here.
3. Accept frame-only clip editing if whole-clip editing/export was intended.
4. After iOS/Android qualification and independent review, decide whether to flip
   the mobile flag through the release/OTA process. It remains false here.

The file/data-URL delivery approach is implemented, **not device-verified**.
WKWebView and Android WebView initialization, offline first launch, WASM support,
App Store acceptance, latency and memory remain host qualification items.

## Explicit deviations and limitations

- Short clips are <=15 seconds / 50 MiB frame sources. A selected frame is edited
  and saved as PNG. **Whole edited-video playback/encoding/export is absent.**
  No installed API was found for encoding the Skia stack into video; adding a
  dependency/native module is prohibited. The UI discloses the photo-only save.
  This is a proposed scope deviation if S4 requires whole-clip output.
- Stills over 24 MP are refused rather than silently downscaled. Inference is
  bounded to 384 px; render/export uses the normalized source dimensions.
- No simulator was run, as requested. No native screenshots, physical-device
  measurements, native GPU goldens, actual permission-sheet verification or
  native preview/export equality evidence is claimed. Software Skia is separate
  evidence. Native equality target: <=2/255 per channel after matching colour
  space/resolution; zero-effect PNG exactness is checked separately.
- New source/test/script/document files are below 500 lines. The mandated existing
  locale catalogs and length-review JSON files already exceeded 500 lines; they
  retain that established format. This exception is explicit, not a catalog redesign.
- No unrequested worktree was created or removed. The current checkout contains
  these uncommitted changes and is not an archive candidate. Other chats'
  checkouts, native environments and previews were not touched.

## Proof and blocked actions

Successful checks:

- `cd apps/mobile && npx tsc --noEmit`: exit 0.
- Focused Jest command below: **10 suites / 490 tests passed**, 19.068 seconds.
- Software Skia compiles four SkSL programs and tests all seven makeup layers,
  eye/mouth exclusions, orientation, textured-skin smoothing, hair/background
  separation, zero-strength identity, complete-stack PNG round trip and preview
  replay equality (**zero-byte tolerance**). Synthetic original fixture only;
  no guessed steep-gradient golden. This runs as part of focused Jest.
- `node --test tests/liveEditMakeup.test.mjs tests/liveEditMath.test.mjs`:
  **10 passed**, including canonical landmark chains against installed
  `@mediapipe/tasks-vision` **1.0.1**.
- `npm run lint` at root: exit 0.
- Mobile Expo lint of changed implementation paths with `--quiet`: exit 0.
- `npm run check:vey-knowledge`: current, **120 routes / 62 document sections**.
  `lib/generatedProductInventory.js` was not edited or regenerated.
- `node scripts/audit-public-i18n.mjs`: **4,213 translated / 1,942 allowlisted /
  0 unresolved**.
- Mobile English registry check, sync-web-i18n check, check-app-i18n length review,
  shared-engine sync check and `git diff --check`: pass.
- Offline preparation: all five pinned inputs verified; prepared size/hash above.

Focused proof command (from apps/mobile):

```sh
npx jest --runInBand \
  __tests__/liveEditProtocol.test.ts __tests__/liveEditParity.test.ts \
  __tests__/liveEditGate.test.tsx __tests__/liveEditExport.test.ts \
  __tests__/liveEditWebView.test.ts __tests__/liveEditSkia.test.ts \
  __tests__/liveEditMedia.test.ts __tests__/appTranslations.test.ts \
  __tests__/i18nWiring.test.ts __tests__/instantLooksScreen.test.tsx
```

Not completed / failed checks:

- Full mobile suite attempted with required `~/.local/bin/with-build-slot`:
  **blocked before Jest started**, `PermissionError: Operation not permitted` on
  `/Users/aljobson/.local/share/storage-guard/build-slot.lock`. The sandbox is
  never-approve. The safeguard was not bypassed or relocated. Full root `npm test`
  likewise remains host work because the same mandatory wrapper cannot acquire
  its lock. Focused suites are not represented as full-suite proof.
- Full `cd apps/mobile && npm run lint`: **1 error, 749 warnings** at the first
  run. The sole error is pre-existing in untouched
  `src/components/smart-cut/SmartCutPreview.tsx:17` (`react-hooks/immutability`,
  assignment to `player.currentTime`). The S4 implementation paths lint without
  errors. This unrelated component was not changed.
- Direct ESLint invocation including build scripts encountered the repository's
  flat-config plugin-scoping error (`react-hooks` plugin not found for that
  configuration). Supported Expo source lint passed; script execution and unit
  tests provide the script proof recorded here.
- Native builds, simulator/device tests, screenshots and whole-video export were
  not run. No dependency install, git add, commit, push, merge, publication,
  deployment, native environment installation or permission escalation occurred.

The host's full chain remains: mobile `npm run typecheck && npm test && npm run
lint`, root `npm test`, lint, knowledge and i18n audit, then native qualification.
Proof logs for this run are in `/tmp/live-edit-*.log` (local transient artifacts).

## Files changed

- `apps/mobile/.gitignore`
- `apps/mobile/__tests__/liveEditExport.test.ts`
- `apps/mobile/__tests__/liveEditGate.test.tsx`
- `apps/mobile/__tests__/liveEditMedia.test.ts`
- `apps/mobile/__tests__/liveEditParity.test.ts`
- `apps/mobile/__tests__/liveEditProtocol.test.ts`
- `apps/mobile/__tests__/liveEditSkia.test.ts`
- `apps/mobile/__tests__/liveEditWebView.test.ts`
- `apps/mobile/metro.config.js`
- `apps/mobile/package.json`
- `apps/mobile/scripts/build-live-edit.mjs`
- `apps/mobile/scripts/ensure-live-edit.cjs`
- `apps/mobile/scripts/live-edit-webview.js`
- `apps/mobile/scripts/prepare-live-edit.mjs`
- `apps/mobile/scripts/proof-live-edit-skia.mjs`
- `apps/mobile/scripts/sync-live-edit.mjs`
- `apps/mobile/src/app/(app)/(tabs)/create.tsx`
- `apps/mobile/src/app/(app)/live-edit.tsx`
- `apps/mobile/src/components/FaceFiltersFlow.tsx`
- `apps/mobile/src/components/StrengthSlider.tsx`
- `apps/mobile/src/components/liveEdit/EffectControls.tsx`
- `apps/mobile/src/components/liveEdit/EffectPhoto.tsx`
- `apps/mobile/src/components/liveEdit/LiveEditScreen.tsx`
- `apps/mobile/src/components/liveEdit/VisionBridge.tsx`
- `apps/mobile/src/lib/i18n/messages/app/ar.ts`
- `apps/mobile/src/lib/i18n/messages/app/de.ts`
- `apps/mobile/src/lib/i18n/messages/app/es.ts`
- `apps/mobile/src/lib/i18n/messages/app/fr.ts`
- `apps/mobile/src/lib/i18n/messages/app/hi.ts`
- `apps/mobile/src/lib/i18n/messages/app/ja.ts`
- `apps/mobile/src/lib/i18n/messages/app/ko.ts`
- `apps/mobile/src/lib/i18n/messages/app/pt.ts`
- `apps/mobile/src/lib/i18n/messages/app/ru.ts`
- `apps/mobile/src/lib/i18n/messages/app/zh.ts`
- `apps/mobile/src/lib/i18n/messages/en.ts`
- `apps/mobile/src/lib/i18n/messages/en/liveEdit.ts`
- `apps/mobile/src/lib/i18n/review/ar-length.json`
- `apps/mobile/src/lib/i18n/review/de-length.json`
- `apps/mobile/src/lib/i18n/review/es-length.json`
- `apps/mobile/src/lib/i18n/review/fr-length.json`
- `apps/mobile/src/lib/i18n/review/hi-length.json`
- `apps/mobile/src/lib/i18n/review/pt-length.json`
- `apps/mobile/src/lib/i18n/review/ru-length.json`
- `apps/mobile/src/lib/liveEdit/engine.ts`
- `apps/mobile/src/lib/liveEdit/geometry.ts`
- `apps/mobile/src/lib/liveEdit/media.ts`
- `apps/mobile/src/lib/liveEdit/protocol.ts`
- `apps/mobile/src/lib/liveEdit/renderEffectStack.ts`
- `apps/mobile/src/lib/liveEdit/shaders.ts`
- `apps/mobile/src/lib/liveEdit/shared/effects.js`
- `apps/mobile/src/lib/liveEdit/shared/hair.js`
- `apps/mobile/src/lib/liveEdit/shared/looks.js`
- `apps/mobile/src/lib/liveEdit/shared/makeup.js`
- `apps/mobile/src/lib/liveEdit/shared/regions.js`
- `apps/mobile/src/lib/liveEdit/stack.ts`
- `apps/mobile/src/lib/lookExport.ts`
- `apps/mobile/src/lib/photoStudioFlag.ts`
- `docs/adr/0335-local-photo-studio.md`
- `docs/mobile/S4-LIVE-EDIT-REPORT.md`

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
