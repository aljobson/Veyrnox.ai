# Photo Studio S3 — advisory implementation report

Final fix round (F1–F2; advisory, independent review still required):

The host reported round 1 green: **7,971 tests, probe 56/56, real-GPU Playwright
including speck rejection**. Those resolved findings remain resolved. This final
round changes only F1/F2 and their proofs/documentation. The frozen plan SHA-256
was rechecked and matches. Earlier reports below describe their original revisions.

- F1: Face initialization/detection exceptions now set a failure flag and report
  hair `unavailable`, enabling the existing Retry control. Genuine zero/multiple
  faces still report `face-required`. Both failure stages have regression coverage.
- F2: Restored the original Worker filename to its frozen v1 bytes, moved hair
  code to `scripts/editor-vision-hair-worker.mjs`, and removed the duplicate v1
  file and source override. Every manifest now names its actual build input.
  Prepare and verify agree on that source; verify also hashes every local source.
  Notices have explicit byte/hash pins, so the budget test counts all asset bytes.

Paths changed **in this round** (11, including one added and one removed):

| Action | Path |
| --- | --- |
| Modified | `app/veyrnox/_lib/liveEdit/engine.js` |
| Restored to original v1 bytes | `scripts/editor-vision-worker.mjs` (no longer differs from HEAD) |
| Added, unchanged hair Worker bytes moved here | `scripts/editor-vision-hair-worker.mjs` |
| Removed uncommitted duplicate | `scripts/editor-vision-worker-v1.mjs` |
| Modified | `scripts/editor-vision-assets.mjs` |
| Modified | `scripts/prepare-editor-vision.mjs` |
| Modified | `tests/liveEditHairLifecycle.test.mjs` |
| Modified | `tests/editorVisionHairProtocol.test.mjs` |
| Modified | `tests/liveEditAdmission.test.mjs` |
| Modified | `docs/adr/0338-local-photo-studio.md` |
| Modified | this report |

No UI strings, hair maths/shaders, browser fixtures/goldens, flags, admission or
routing changes in this round. No hand edit of `lib/generatedProductInventory.js`.
The generated new hair manifest changes its source path; v1's served bytes and
manifest are unchanged. The new hair Worker itself retains its existing hash.

Agreed proof executed:

```sh
node --test tests/liveEditHair.test.mjs tests/liveEditHairLifecycle.test.mjs tests/editorVisionHairProtocol.test.mjs tests/liveEditLifecycle.test.mjs tests/liveEditAdmission.test.mjs
node scripts/audit-public-i18n.mjs --app
```

Output: **28 tests, 28 pass, 0 fail, 0 skipped**, 1,293 ms.
I18n: **translated 5621, allowlisted 1803, unresolved 0**.
Existing Node module-type and module.register deprecation warnings only.
`node scripts/prepare-editor-vision.mjs` passed, including its static verifier:
previous segmentation **28,624,644**, face **16,009,877**, hair **28,625,163** bytes.
Total **73,259,684 bytes**, 21 asset files excluding manifests. Unit tests require
exactly three releases, two segmentation releases, seven files each, all declared
byte/hash pins, direct Worker source hashes and the documented proposed cap.

Immutable v1 proof ran both before and after preparation against cached
`origin/main` **290437f9fceef707a3673bc27ce6c4c2cee76100**, without fetching or
editing another checkout. It reads upstream model/SDK pins, derives Worker/notice
hashes from `git show origin/main:<source>`, reconstructs the upstream prepare
script's manifest serialization, then checks the exact file set, byte lengths and
SHA-256 of each generated public file. All eight matched:

| File | SHA-256 |
| --- | --- |
| `selfie_multiclass_256x256.tflite` | `c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0` |
| `vision_bundle.mjs` | `d885630c297c0b20b1fe86096cb06291c4c8080876f27852e724f24ac603713f` |
| `wasm/vision_wasm_module_internal.js` | `da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d` |
| `wasm/vision_wasm_module_internal.wasm` | `2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b` |
| `worker.mjs` | `3208a143547fc9000de7f351dd56612be2cfaf2ece41eebfbeb1a4c0f0935ca0` |
| `NOTICE.txt` | `5a910be0916d0e2753d47fd213227693d3a05e06c7c621a3cef312400a057756` |
| `Apache-2.0.txt` | `8707eef0533987efc5b155d64761eeb6e20793f50b9bd1a68dad1cf4719d0ed8` |
| `manifest.json` | `4ddc36005488fb2fde13b2af9f8e4a5a499979dc956aa91253ade23d7ab98310` |

The manifest digest is now locked by a unit test. The comparison script used in
this session is `/tmp/photo-s3-origin-proof.mjs`; no images or private data are in it.

**Deviations:** no unmet or redesigned requirement. The source-file relocation
is the F2 correction needed to make old provenance true without changing its
immutable manifest. The **72 MiB budget remains proposed, pending owner approval**;
the owner has not approved it. No new budget increase or activation is claimed.

**Denied/blocked:** no action was denied; no commit, staging, push or publication.
No new worktree/server/dependency install or archive operation. Still not run here:
full npm test, lint/typecheck, Vey knowledge regeneration/check, production/Worker
builds, worker-size check, `.open-next/assets` verification, built HTTP probe,
Chromium/WebGL/private-portrait and visual/accessibility proofs. These are assigned
to the host; sandbox build-lock and GPU constraints were respected. Public static
asset verification above is not a claim about the built Worker deployment.

Round 1 fix update (H1–H3; advisory, independent review still required):

The host reported the preceding revision green: **7,966 tests, probe 56/56, and
real-GPU Playwright including hair checks**. Those findings are not reopened.
The original builder report below is historical; its “not run” statements refer
to that builder pass. Host results do not qualify the new fixes until re-run.
The frozen plan hash was rechecked and remains unchanged.

- H1: Hair readiness requires at least 0.5% of mask pixels above 0.5 confidence,
  rounded up and at least two pixels. Ombre uses 2nd–98th percentiles of confident
  row mass. One-pixel specks cannot announce hair, and tiny extremes do not move
  a real blob's bounds. This conservative cutoff can exclude very small hair.
- H2: The engine keeps 8-connected hair components with confident pixels near
  the face oval. Margins: half a face width left/right, one face height up, and
  one-quarter face height down. Whole attached components retain long hair and
  both side locks. Distant blobs are dropped. Touching/closely standing people
  remain a limitation, now stated in the ADR and localized in-app help.
- H3: Processor failures allow inference Retry; renderer/filter failures are
  separate. A lost context/upload failure reports graphics-lost. An invalid
  internal mask clears hair and announces a disabled preview without Retry.
  Clearing failures also route to the graphics handler.

Files changed **in this fix round** (12; existing round-0 changes preserved):

| Area | Files |
| --- | --- |
| Mask heuristics / engine / upload | `packages/live-edit/hair.js`, `app/veyrnox/_lib/liveEdit/engine.js`, `app/veyrnox/_lib/liveEdit/renderer.js` |
| Localized help / non-retry status | `app/veyrnox/app/photo-studio/HairControls.jsx`, `lib/i18n/photoStudioEnglish.mjs` |
| Regression tests | `tests/liveEditHair.test.mjs`, `tests/liveEditHairLifecycle.test.mjs` |
| Host browser proof | `tests/fixtures/photo-studio-hair-proof.mjs`, `tests/fixtures/photo-studio-hair-model-proof.mjs`, `e2e/photo-studio.proof.mjs` |
| Documentation | `docs/adr/0338-local-photo-studio.md`, this report |

The browser harness now runs component selection, checks a remote blob stays
unchanged while both side locks change, rejects a lone speck, and checks the
private portrait's selected mask. It still collects expected/actual misses.
**No RGB golden or `photo-studio-hair-fixture.mjs` change was needed.** The
private harness allowlist adds the existing canonical face-oval module.

Agreed proof executed after the source changes:

```sh
node --test tests/liveEditHair.test.mjs tests/liveEditHairLifecycle.test.mjs tests/editorVisionHairProtocol.test.mjs tests/liveEditLifecycle.test.mjs
node scripts/audit-public-i18n.mjs --app
```

Output: **20 tests, 20 pass, 0 fail, 0 skipped**, 156.5 ms.
I18n: **translated 5621, allowlisted 1803, unresolved 0**.
Existing Node MODULE_TYPELESS_PACKAGE_JSON warnings only.
`git diff --check` passes; changed files remain below 500 lines.

No new scope or budget deviation: this round implements the host's requested
heuristics and documents their tradeoffs. Worker protocol, hashes, prefixes,
admission, routes and the existing proposed 72 MiB budget are unchanged.
No denied actions, commits, staging, pushes or publication. No original checkout,
mobile source, migration, dependency or `lib/generatedProductInventory.js` edits.
No new worktree, server, dependency installation or archive operation.

Not run in this sandbox: full `npm test`, lint/typecheck, Vey knowledge
regeneration/check, production/Worker builds, worker-size check, built asset
verification, HTTP probe, Chromium/WebGL proofs, private portrait inference or
visual/accessibility qualification. These remain assigned to the host; the
sandbox build-lock/GPU limits were respected. No bypass was attempted.

Initial implementation report follows; the goal-criteria checklist at the end
also applies to this fix round (new help copy needs the host's visual check).

Implemented only web still-photo hair recolour and its D2a/R8 protocol prerequisite
in this checkout, based on clean HEAD `7de8d64d3cb3fd3865eda5340394e046c85c0568`.
Frozen PLAN.md SHA-256 verified as
`81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.
This report is advisory; independent review and host qualification remain required.

Hair presets, shade swatches, ombre, luminance-selected highlights and strength
are integrated into the existing preview/history/compare/export stack. The
0.2–0.8 confidence matte feathers boundaries. Hair is disabled without one face,
without hair coverage, or after an inference failure. Alpha is preserved; no
hair is removed or reconstructed. Workers run sequentially, close after the still
job and are cancelled on source change/unmount. No temporal smoothing is claimed.

The new prefix is
`/editor-vision/mediapipe-1.0.1-multiclass-1-c6748b12-hair-worker-2/`.
Existing person callers still default to worker-1. That prefix, including its
manifest, remains byte-identical and requires only localInference. The new hair
and existing face prefixes require both localInference and photoStudio.
The current hair/face and exactly one previous segmentation release are generated
and verified together. Production flags remain unchanged/off for Photo Studio.

Files changed (relative to this checkout):

| Area | Files |
| --- | --- |
| Protocol and admission | `app/veyrnox/_lib/editorVisionRuntime.mjs`, `app/veyrnox/_lib/editorVisionWorkerClient.mjs`, `lib/editorVisionAdmission.mjs` |
| Immutable releases/build | `scripts/editor-vision-worker.mjs`, new `scripts/editor-vision-worker-v1.mjs`, `scripts/editor-vision-assets.mjs`, `scripts/prepare-editor-vision.mjs`, `scripts/verify-editor-vision.mjs` |
| Effect/rendering | new `packages/live-edit/hair.js`, `packages/live-edit/effects.js`, new `app/veyrnox/_lib/liveEdit/hairShader.js`, `app/veyrnox/_lib/liveEdit/shaders.js`, `app/veyrnox/_lib/liveEdit/renderer.js`, `app/veyrnox/_lib/liveEdit/engine.js` |
| Controls/copy | new `app/veyrnox/app/photo-studio/HairControls.jsx`, `app/veyrnox/app/photo-studio/Controls.jsx`, `app/veyrnox/app/photo-studio/PhotoEditor.jsx`, `lib/i18n/photoStudioEnglish.mjs` |
| Focused tests | new `tests/editorVisionHairProtocol.test.mjs`, new `tests/liveEditHair.test.mjs`, new `tests/liveEditHairLifecycle.test.mjs`, extended `tests/liveEditAdmission.test.mjs` |
| Host proof | `scripts/probe-photo-studio-worker.mjs`, `e2e/photo-studio.proof.mjs`, `e2e/photo-studio-proof.config.mjs`, `tests/fixtures/photo-studio-browser-proof.mjs`, new `tests/fixtures/photo-studio-hair-fixture.mjs`, new `tests/fixtures/photo-studio-hair-proof.mjs`, new `tests/fixtures/photo-studio-hair-model-proof.mjs` |
| Documentation | `docs/adr/0338-local-photo-studio.md`, this report |

The previous `editorVisionAssets`, `editorVisionWorkerClient` and
`editorVisionProcessing` test files were not edited. No mobile, wigs, camera,
migration, dependency, `wrangler.jsonc`, `middleware.js`, `worker.js` or
`lib/generatedProductInventory.js` changes. No new worktrees, dependencies,
previews or background servers were created. No worktree was identified as safe
to archive; other sessions' checkouts were left alone. Generated ignored public
assets now include the additional ~28.6 MB hair release for the host build.

Executed proof:

```sh
node --test tests/editorVisionAssets.test.mjs tests/editorVisionWorkerClient.test.mjs tests/editorVisionProcessing.test.mjs tests/editorVisionHairProtocol.test.mjs tests/liveEditMath.test.mjs tests/liveEditMakeup.test.mjs tests/liveEditLifecycle.test.mjs tests/liveEditHair.test.mjs tests/liveEditHairLifecycle.test.mjs tests/liveEditAdmission.test.mjs
```

Final output: **46 tests, 46 pass, 0 fail, 0 skipped**, 946 ms. This includes the
unchanged old person tests, all four admission flag combinations, bounded copied
HAIR protocol data, invalid confidence rejection, default old-prefix selection,
source cancellation, no-face/multiple-face/no-hair handling, history and export
settings. Worker tests execute the actual envelope with only the SDK import
substituted; they do not claim real model inference.

```sh
node scripts/prepare-editor-vision.mjs
```

Output (preparation calls the full static asset verifier):

```text
Local vision runtime mediapipe-1.0.1-multiclass-1-c6748b12-worker-1: 28624644 bytes verified.
Local vision runtime mediapipe-1.0.1-facelandmarker-1-64184e22-worker-2: 16009877 bytes verified.
Local vision runtime mediapipe-1.0.1-multiclass-1-c6748b12-hair-worker-2: 28625163 bytes verified.
Retained prefix: all 8 files including manifest byte-identical before/after prepare.
```

The comparison used SHA-256 snapshots before/after preparation. Existing cached
model files were reused; no model download was needed. Pinned SDK 1.0.1 package
metadata and declarations were read, and the cached pinned model's embedded
`labels.txt` confirmed class 1 is `hair`. The new Worker also validates that label
order at runtime, rather than trusting a remembered index.

```sh
node scripts/audit-public-i18n.mjs --app
```

Final summary: **translated 5620, allowlisted 1803, unresolved 0**. New visible
copy uses literal `t('key')` calls. The existing shared English beta-copy mechanism
continues for all locales; translated hair copy has not been professionally reviewed.
The first audit found two JSX helper field IDs; those were moved into descriptors
and the final audit passed. No audit exceptions were added.

`git diff --check` passed. All 29 changed/new JS/JSX files passed `node --check`
or TypeScript JSX syntactic transpilation (not a substitute for typecheck/lint).
All 31 changed/new files, including this report, are under 500 lines.
Node emitted its existing MODULE_TYPELESS_PACKAGE_JSON warnings; no failure.

Not run / blocked or deferred:

- Full `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`,
  `npm run build:worker`, `npm run check:worker-size`,
  `npm run check:vey-knowledge`, and
  `node scripts/verify-editor-vision.mjs .open-next/assets`: assigned to the host
  by this work order. The sandbox cannot take the shared heavy-build lock.
- `node scripts/probe-photo-studio-worker.mjs` (including `--serve`) and
  `npx playwright test --config e2e/photo-studio-proof.config.mjs`: assigned to
  the host; no Chromium/GPU or built-Worker execution was attempted here.
  The HTTP matrix and old-prefix 200+CSP result therefore remain **unproved on
  the built Worker**, despite passing admission tests and static asset hashes.
- Real portrait quality / known-background alpha <0.05: not run; no private
  portrait fixture was supplied. The optional second browser test requires
  `PHOTO_HAIR_FIXTURE`, otherwise it explicitly skips. See ADR-0338 for its
  private image-hash/background-rectangle manifest. No image fixture is committed.
- Actual shader compilation, golden crops, browser pixel identity/export parity,
  network-panel privacy check, keyboard/screen-reader use, mobile-width and
  desktop screenshots, light/dark contrast and performance: host/browser proof
  still required. CPU references and syntax checks are not GPU evidence.
- No attempted action was rejected by approval review. No commit, push, publish,
  staging or prohibited `git add -A` action was performed. No external original
  checkout was edited. No build lock or browser sandbox bypass was attempted.

Host sequence (reuse this checkout; avoid parallel heavy builds):

```sh
~/.local/bin/with-build-slot npm test
npm run typecheck
npm run lint
npm run sync:vey-knowledge
npm run check:vey-knowledge
~/.local/bin/with-build-slot npm run build:worker
npm run check:worker-size
node scripts/verify-editor-vision.mjs .open-next/assets
node scripts/probe-photo-studio-worker.mjs --serve
```

`build:worker` includes the production build. While the final probe instance is
serving, run in another terminal, with `PHOTO_HAIR_FIXTURE` set for the private
portrait test if available:

```sh
~/.local/bin/with-build-slot npx playwright test --config e2e/photo-studio-proof.config.mjs
```

Stop the local probe with Ctrl-C after qualification. Do not wrap the persistent
probe server in the build slot. Host regeneration, not hand editing, updates Vey
knowledge. Review that generated diff independently.

Deviations / limits for review:

- **Proposed combined static asset budget: 48 MiB → 72 MiB.** Mandatory retention
  plus current hair and face totals **73,259,684 bytes**, 21 files excluding
  manifests. 48 MiB is impossible with these required pinned copies. Per-prefix
  32 MiB and per-file 25 MiB limits remain; largest file 16,371,837 bytes. The
  decision and measured inventory are recorded in ADR-0338.
- LAB-like separation is implemented as linear-light luminance/chroma with gamut
  contraction, preserving Rec.709 luminance rather than claiming literal CIELAB.
  Very dark hair cannot become bright blonde; UI copy states this limitation.
- Confidence texture quantization is 1/255 before the established feather curve.
  Fine strands remain limited by the 256×256 segmentation model. No temporal
  smoothing is required or claimed for these stills. No other scope deviation.

Photo Studio / HairControls goal criteria from `docs/design-goal-criteria.md`
(source checks are distinguished from visual/device checks):

The goal is met when:

- **Checked (source)** — No piece of information appears twice on one screen (a balance, a price, a title or a status is shown in one place). New presets have distinct names from individual shade swatches; there is one hair status.
- **Not applicable** — Mobile: every gap, padding and margin is a `ds.space` step (2/4/8/12/16/20/24/32/40/56), and the screen gutter is 20.
- **Checked (source)** — Web: every gap is on the Tailwind 4 px scale, with no arbitrary `[13px]` values.
- **Checked (source, web); mobile not applicable** — Mobile radii come from the set 6/10/14/20/28/999 and web radii from `rounded-xl` (16), `rounded-2xl` (24) and `rounded-3xl` (32). An inner piece has a smaller radius than the card around it, never the same or larger.
- **Checked (source)** — Light-mode shadows use `e1` or `e2` only. Dark and OLED mode have no shadow, so depth comes from `bgElevated1`, `bgElevated2` and `surface`. No new shadows.
- **Not checked (browser unavailable)** — Rhythm is intentional: not every section has the same padding, and the page has one clear primary action (`.claude/rules/ecc/web/design-quality.md`). Existing export remains the primary action.
- **Not applicable** — Mobile: no hex or `rgb()` literal outside `theme.ts`; every colour is a semantic token (`bg`, `surface`, `textPrimary`, `accent`, `danger`…).
- **Not checked (both themes require browser)** — Web: every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`, `text-vx-accent`…), and both themes are checked. Chrome uses tokens; shade circles intentionally display pigment data, as makeup does.
- **Checked (source)** — Amber (`money` / `warning`) appears only on money and credit amounts. Aqua (`accent`) marks actions. `danger` marks errors and destructive actions only.
- **Not checked (browser unavailable)** — Text on its background is at least 4.5:1 (3:1 for large text and for icons and borders that carry meaning), in light, dark and OLED, and for each of the five mobile accents.
- **Checked (source, web); mobile not applicable** — Fonts: web uses Inter (body), Archivo (display) and JetBrains Mono (small labels) and nothing else. Mobile uses only the selected Typeface pair (studio, editorial or technical). Mobile text uses a `type` step, with no numeric `fontSize` on the screen.
- **Not applicable** — No weight 800 or 900 in new mobile code (ADR-0264).
- **Not applicable** — No model or provider is shown failing in marketing visuals; say the refund promise in words.
- **Checked (new copy review)** — Nothing on a customer-facing surface uses wallet or on-chain wording (`scripts/check-hard-wall.sh`).
- **Checked (source)** — Every tappable control is at least 44 pt (mobile) or 44 CSS px (web touch). A visually small mobile button gets `hitSlop` to reach 44. Primary buttons are 52. Reuses `min-h-11` controls and existing `min-h-13` export.
- **Not checked (browser unavailable)** — At the largest in-app text size (XL, ×1.25) and at OS scaling 1.5 nothing is clipped, overlapped or pushed off-screen, and the primary button is still visible without horizontal scroll.
- **Checked (source); assistive technology not checked** — Every control has an accessible name, and every status change (loading finished, error shown, saved) is announced, not only coloured. Labels, legends, `aria-pressed`, swatch names and `role=status` are present.
- **Not checked (keyboard browser pass pending)** — Every focusable web element shows a visible focus ring and can be reached and used from the keyboard. Source reuses focus-ring classes and native controls.
- **Checked (source)** — With reduced motion on, press scaling, confetti and looping animation are off and the screen still makes sense. No animation is added.
- **Not checked (browser unavailable)** — Layout holds at 375 px wide and at 1280 px wide with no horizontal page scroll.
- **Checked (source), visual not checked — Empty:** Before any data, the screen says what belongs here and offers one action that fills it. It is not a blank list. Existing Choose photo state is retained.
- **Not checked (timing/browser) — Loading:** A placeholder with the final layout shows within 100 ms, so the page does not jump when data arrives. Hair has explicit waiting/detecting copy.
- **Checked (source/Node) — Error:** The message says what failed and what to do next, has a retry, and shows no stack trace, DB message or vendor payload. Error codes stay `kebab-case`.
- **Not checked (offline browser) — No internet:** The screen shows an offline notice and keeps already-loaded content readable. Actions that need the network say so instead of failing silently. Existing offline banner and hair model status are retained.
- **Not checked (network timing) — Slow network:** After about 3 s a progress cue shows what is happening (step, count or percent), not only a spinner. Long jobs show the job state. Hair status identifies downloading/detecting immediately.
- **Not applicable (no new service flow) — Service outage:** One banner, driven by `/api/status`, on web and in the app. Existing app banner is unchanged.
- **Not applicable — No search results:** The query is echoed back, with a clear-filters action and two or more suggestions. It is not a dead end.
- **Not applicable (no permission request; gate stays 404) — Permission denied:** It says why (not signed in, not an administrator, plan, MFA needed) and gives one way back or forward. A 403 is not shown as one generic message.
- **Not applicable (no new session flow) — Session expired:** The user's unsent input is kept, the screen asks them to sign in again, and returns them to the same place afterwards.
- **Not applicable (bounded selects/range; no free-text form) — Form validation:** Each error is shown next to its field as soon as the field is left, in words, with `danger` colour plus text. The submit button is never the only place an error appears.
- **Checked (source), browser not checked — Success:** It confirms what happened (and the Credits spent, if any), then shows the next step. Celebrations are one-time milestones, not on every result (ADR-0264). Existing export-ready download is retained.
- **Not applicable — Money screens:** Every price and balance is read from the catalog or the API. No price is computed in the app layer. Before a Credit spend, the user sees the exact cost; after it, the new balance. A failed submit shows that the Credits were returned. A paid action cannot be double-submitted: the button is disabled while the request runs and the request carries an idempotency key.
- **Checked (CPU/lifecycle), not checked (GPU/model) — Hair-specific:** Strength zero preserves decoded pixels; one face and a hair matte are required; preview and export share the same stack; known-background hair alpha is below 0.05 on the private portrait fixture.
