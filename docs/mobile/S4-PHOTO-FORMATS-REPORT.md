# S4 final fix round — photo formats (advisory)

Implemented the host's photo-format requests for both editors in this checkout.
Accepted round-one behavior is preserved except where format handling requires a
change. Both flags remain off. No dependency, lockfile, generated inventory,
worker/middleware/deployment change, commit, staging, push or publication occurred.
The frozen plan SHA-256 was verified as
`81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.

## Behavior

Web selection and decode share bounded magic-byte validation. JPEG, PNG, GIF,
WebP, BMP, HEIC/HEIF and AVIF are recognized even with empty/octet-stream MIME;
contradictory declarations are rejected. Major and compatible HEIF/AVIF brands
are covered. The picker advertises all formats plus .heic/.heif/.avif. Files stay
under 50 MB, 24 MP and 8192 pixels per edge. A MIME-normalized Blob goes to the
browser's own createImageBitmap decoder with explicit from-image EXIF orientation.
HEIC/HEIF and AVIF decode failures have separate literal translation keys and
JPEG recovery guidance. No libheif or other decoder was bundled.

Mobile asks SDK 58 for Compatible representation, then runs stills through the
existing pickedImageFile converter before validation and preparePhoto. JPEG,
PNG and WebP continue through normal local preparation; HEIC/HEIF, AVIF, TIFF,
BMP and GIF convert locally to JPEG. Android empty/generic MIME falls back to
extension. Live Photos supply only the still. Unsupported codec/RAW errors are
separate from invalid media and size-limit errors, in all 11 locales. Bounds are
checked after conversion, and decoded dimensions are checked again. Temporary
picker/converter files are discarded using the existing cache-only guard, and
conversion native references are released even when decoding fails.

SDK API evidence: installed expo-image-picker types declare
preferredAssetRepresentationMode and UIImagePickerPreferredAssetRepresentationMode.Compatible;
[SDK 58 documentation](https://docs.expo.dev/versions/v58.0.0/sdk/imagepicker/)
was checked. Android codec availability remains native and device-dependent;
HEIF starts at Android 9 and AVIF at Android 12, with optional profiles as described
in [Android's format table](https://developer.android.com/media/platform/supported-formats#image-formats).

## Proof output

The requested command was run verbatim:

```sh
node --test tests/liveEdit*.test.mjs; cd apps/mobile && npx jest __tests__/liveEdit; npx tsc --noEmit; cd .. && node scripts/audit-public-i18n.mjs --app
```

- Node: 38 tests passed, no failures or skips. Rechecked after the final MIME/copy adjustment.
- Focused mobile Jest: 11 suites / 70 tests passed (3.363 seconds).
- TypeScript: no diagnostics; the separate focused run also completed with exit 0.
- The literal final audit command fails with MODULE_NOT_FOUND because cd .. lands
  in apps, not the checkout root. Re-running node scripts/audit-public-i18n.mjs
  --app from the root succeeds: 0 unresolved strings.
- Additional converter coverage: combined Live Edit + pickedImage run passed
  12 suites / 78 tests. The new format matrix uses mocked ImagePicker and
  ImageManipulator; it covers all requested formats, fallback, RAW rejection,
  decoder errors, cleanup and converted size/dimension limits.
- Mobile i18n/wiring: 2 suites / 450 tests passed.
- Changed mobile Expo lint and changed web ESLint: exit 0.
- Registry check, sync-web-i18n generation/check and check-app-i18n: pass.
  Length-review JSON was regenerated with check-app-i18n.mjs --write, never
  hand-edited. New keys do not create additional >1.6x review rows this round.
- Knowledge check: stale after the new ADR section. Host must run
  npm run sync:vey-knowledge; generated inventory was left untouched as requested.
- git diff --check: pass. ADR is below 500 lines; new implementation/test files
  are below 500. Existing locale files retain their established longer format.

Transient logs: /tmp/s4-formats-node.log, /tmp/s4-formats-jest.log,
/tmp/s4-formats-tsc.log, /tmp/s4-formats-audit.log,
/tmp/s4-formats-mobile-i18n-tests.log, /tmp/s4-formats-mobile-lint.log,
/tmp/s4-formats-web-lint.log and /tmp/s4-formats-browser.log.

## Blocked actions, deviations and remaining proof

A native Chromium qualification was attempted using the installed browser and
an entirely generated 32x16 JPEG with EXIF orientation 6, bundled through the
production decodePhoto function. Sandbox startup failed with
`bootstrap_check_in ... MachPortRendezvousServer: Permission denied (1100)`.
No approval escalation or alternate security boundary was attempted. The
automated test synthesizes the same oriented fixture and verifies the
from-image decoder contract and 16x32 result using a Sharp decoder double; this
is explicitly not evidence of Safari/Chrome/Firefox native decoding.

One proposed requirement deviation is explicit: native ImageBitmap selects the
format's default still when present, otherwise the first animation frame. Exact
chronological frame one cannot be promised for every container through this API.
The help copy and ADR say first/default still; animation/video is never exported.
This follows the [HTML decoder contract](https://html.spec.whatwg.org/multipage/imagebitmap-and-animations.html#dom-createimagebitmap).
A custom decoder to override that choice remains outside the no-dependency scope.

Native iOS/Android picker behavior, actual HEIC/AVIF codec coverage, browser EXIF
pixels, simulator screenshots, latency/memory and EAS build qualification remain
host work. Full root/mobile suites were not run. The pre-existing SmartCutPreview
lint issue was untouched. The round-one esbuild lockfile update remains assigned
to the host; no package installation or lockfile edit was attempted this round.
An auxiliary Jest invocation started in the wrong directory was cancelled before
output; it was rerun successfully from apps/mobile. No servers or worktrees were
created or removed, and no other checkout was edited.

## Files changed in this round

- app/veyrnox/_lib/liveEdit/photoFormat.js (new)
- app/veyrnox/_lib/liveEdit/engine.js
- app/veyrnox/app/photo-studio/PhotoEditor.jsx
- lib/i18n/photoStudioEnglish.mjs
- tests/liveEditPhotoFormat.test.mjs (new)
- tests/liveEditLifecycle.test.mjs
- apps/mobile/src/lib/liveEdit/pickedPhoto.ts (new)
- apps/mobile/src/lib/liveEdit/media.ts
- apps/mobile/src/components/liveEdit/LiveEditScreen.tsx
- apps/mobile/src/lib/pickedImage.ts
- apps/mobile/src/lib/chatResizer.ts (optional release typing for shared converter)
- apps/mobile/__tests__/liveEditPhotoFormats.test.ts (new)
- apps/mobile/__tests__/liveEditMedia.test.ts
- apps/mobile/src/lib/i18n/messages/en/liveEdit.ts
- apps/mobile/src/lib/i18n/messages/app/{ar,de,es,fr,hi,ja,ko,pt,ru,zh}.ts
- docs/adr/0338-local-photo-studio.md (supported formats amendment)
- docs/mobile/S4-PHOTO-FORMATS-REPORT.md (this report)

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
- **not applicable — no new web styles or controls.** Web: every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`, `text-vx-accent`…), and both themes are checked.
- **checked — source: accent actions, danger error text, no money styling.** Amber (`money` / `warning`) appears only on money and credit amounts. Aqua (`accent`) marks actions. `danger` marks errors and destructive actions only.
- **not checked — native theme/accent contrast measurements require host review.** Text on its background is at least 4.5:1 (3:1 for large text and for icons and borders that carry meaning), in light, dark and OLED, and for each of the five mobile accents.
- **not checked — new screen uses shared Text variants; reused LookStrip/StrengthSlider retain legacy typography and need device review.** Fonts: web uses Inter (body), Archivo (display) and JetBrains Mono (small labels) and nothing else. Mobile uses only the selected Typeface pair (studio, editorial or technical). Mobile text uses a `type` step, with no numeric `fontSize` on the screen.
- **checked — no new 800/900 font weights.** No weight 800 or 900 in new mobile code (ADR-0264).
- **not applicable — no marketing visuals.** No model or provider is shown failing in marketing visuals; say the refund promise in words.
- **checked — new customer-facing copy contains neither terminology.** Nothing on a customer-facing surface uses wallet or on-chain wording (`scripts/check-hard-wall.sh`).
- **checked — source: shared controls >=44 pt and save 52 pt.** Every tappable control is at least 44 pt (mobile) or 44 CSS px (web touch). A visually small mobile button gets `hitSlop` to reach 44. Primary buttons are 52.
- **not checked — no simulator at XL/OS 1.5 scaling.** At the largest in-app text size (XL, ×1.25) and at OS scaling 1.5 nothing is clipped, overlapped or pushed off-screen, and the primary button is still visible without horizontal scroll.
- **checked — source: accessible labels and announced status text; device screen-reader verification remains outstanding.** Every control has an accessible name, and every status change (loading finished, error shown, saved) is announced, not only coloured.
- **not applicable — existing web file picker retains its accessible name and focus treatment; no new controls.** Every focusable web element shows a visible focus ring and can be reached and used from the keyboard.
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
