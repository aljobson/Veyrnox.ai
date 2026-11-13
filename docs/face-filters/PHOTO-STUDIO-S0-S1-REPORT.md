# S0/S1 advisory implementation report

## Host fix round 2 — blocked by the current-main definition

The host reports 7931 tests with one remaining failure and verifies round-1
fixes 2–4. Those results are accepted; no verified S0/S1 behavior was changed.
The frozen plan SHA-256 was checked again and matches the supplied digest.

The authorized migration cannot be copied as described without resolving new
evidence from current main. The available `origin/main` reference is
`fa4df6e66`; its highest migration is `0493_music_reference_links.sql`, making
0494 the next number on that reference. Unlike this checkout's latest definition
in 0455, **0493 replaces the array with a wrapper**:

```sql
CREATE OR REPLACE FUNCTION public.telemetry_path_allowed(p_path TEXT)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
    SELECT p_path = '/api/v1/music/reference-links'
        OR public.telemetry_path_allowed_pre_0493(p_path)
$$;

REVOKE ALL ON FUNCTION public.telemetry_path_allowed(TEXT)
    FROM PUBLIC, anon, authenticated, service_role;
```

0493 first renames the previous function to `telemetry_path_allowed_pre_0493`.
Neither 0493 nor its new music route is present in this checkout. Copying its
wrapper here would leave a missing dependency on fresh replay; copying 0455
instead would drop the music route when applied after 0493. Also, the current
definition explicitly revokes `service_role` execution and has no grant for this
function. The requested grant is therefore a permission change, not a reapplication
of the previous migration's ACL. The original telemetry ingestion functions are
SECURITY DEFINER and call the private-to-owner allowlist helper.

**Proposed deviation, pending host decision:** integrate 0493 and its route first,
then preserve the wrapper and its revoked ACL while adding `/app/photo-studio`.
The equality test must inspect the effective composed allowlist instead of only
the old literal array. Alternatively, a standalone full array must retain the
music route as well, which requires resolving the inventory mismatch and an
explicit decision about the requested service-role grant. No workaround was
silently implemented, and no migration or test was edited in this round.

Proof performed in this checkout:

```text
node --test tests/adminTelemetry.test.mjs
Tests 12; pass 11; fail 1; cancelled 0; skipped 0; todo 0.
Duration 154.177208 ms; exit 1.
Failure: SQL and code allowlists agree for all inventory patterns; telemetry has no user FK.

node scripts/check-migration-ledger.mjs
could not read the migration ledger: fetch failed
Exit 2; no ledger verification result.

bash scripts/check-migration-numbers.sh
migration numbering OK; exit 0.

node scripts/check-catalog-update-guards.mjs
catalog UPDATE guards OK (new migrations from 0111); exit 0.
```

`git fetch origin` was denied while opening the external worktree `FETCH_HEAD`
(`Operation not permitted`). The required `git ls-tree -r origin/main --name-only
packages/db/schema/supabase` succeeded against the available reference. A read-only
`git ls-remote origin refs/heads/main` also failed (`Could not resolve host:
github.com`), so remote freshness remains unverified. Logs are in
`/tmp/photo-studio-round2-allowlist.log`, `/tmp/photo-studio-round2-ledger.log`, and
`/tmp/photo-studio-round2-main-tree.txt`.

Only this report changed during round 2. The ledger checker discovers ordinary
numbered SQL files directly; no README/index update is required for a future 0494.
Full npm tests and Postgres replay remain host-run checks for this round. No SQL
was applied, existing migration edited, commit/staging/push/publication performed,
or worktree/server created. No UI changed; the design checklist below is unchanged.

## Host fix round 1 — historical disposition

The host reports that typecheck, lint, build:worker, check:worker-size,
verify-editor-vision and probe-photo-studio-worker passed, with four npm-test
failures. Those passing results are accepted here as host evidence; the runtime
behavior they cover was not changed or re-reviewed in this round. The initial
builder report below is historical, including its earlier build blockers.

**Three fixes completed; one requires the host's migration decision.**

Files changed in this round only:

- `tests/runtimeSwitches.test.mjs`: permit exactly the reviewed ADR-0338 comment
  and Worker-first array in the HEAD-based byte pin; retain equality for all
  other configuration bytes/bindings.
- `tests/showcaseVideo.test.mjs`: require exactly `["/showcase/*.mp4", "/editor-vision/*"]`
  and both serving calls. The closed array assertion still rejects additional
  patterns, including posters.
- `tests/veyKnowledgeCoverage.test.mjs`: add a named `darkPreview` NO_ARTICLE
  reason for `/app/photo-studio`; no article advertises the inactive feature.
- This report: record round-1 evidence and the unresolved migration requirement.

Fix 1 remains visible in the unchanged `tests/adminTelemetry.test.mjs`. It derives
normalized patterns from `lib/adminRouteInventory.json` (generated by
`scripts/generate-route-inventory.mjs`) and compares them with the latest
`public.telemetry_path_allowed(TEXT)` definition in
`packages/db/schema/supabase/0455_best_cut.sql`. Set comparison found exactly one
missing SQL pattern, `/app/photo-studio`, and no extra SQL patterns.

The repository convention is a **new numbered migration**, as demonstrated by
0431, 0442, 0443, 0452 and 0455. It must `CREATE OR REPLACE FUNCTION
public.telemetry_path_allowed(p_path TEXT) RETURNS BOOLEAN`, preserve `LANGUAGE sql
IMMUTABLE SET search_path=''` and every current pattern, add `/app/photo-studio`
to the array, and retain the existing explicit `REVOKE ALL ... FROM
PUBLIC,anon,authenticated,service_role`. No table or user-FK change is needed.
The equality test must then read that new authoritative migration. The host must
choose its number against current main/open PRs and apply it through the normal
migration workflow. **No new migration was created; no existing migration was
edited**, as instructed. The full inventory was not falsified and the failing
test was not weakened. No existing non-migration convention preserves both the
new page inventory and SQL/code equality; ADR-0329 likewise records that a new
route would require changing the SQL telemetry allowlist.

Proof after these fixes:

```text
node --test --test-concurrency=2 tests/adminTelemetry.test.mjs tests/runtimeSwitches.test.mjs tests/showcaseVideo.test.mjs tests/veyKnowledgeCoverage.test.mjs
Tests: 36; pass: 35; fail: 1; skipped: 0; cancelled: 0; todo: 0
Duration: 1435.138833 ms; exit 1
Only failure: SQL and code allowlists agree for all inventory patterns; telemetry has no user FK

npm run sync:vey-knowledge
Vey knowledge already current (120 routes, 62 document sections). Exit 0.

npm run check:vey-knowledge
Vey knowledge is current (120 routes, 62 document sections). Exit 0.
```

The requested full `npm test && npm run check:vey-knowledge` was attempted through
`~/.local/bin/with-build-slot` after the fixes. The wrapper exited 1 before npm
started: `PermissionError: [Errno 1] Operation not permitted` opening
`~/.local/share/storage-guard/build-slot.lock`. **Full-suite tests executed: 0;
full-suite pass/fail counts are unavailable.** The independent lightweight
knowledge check above did run. The shared lock was not bypassed. Logs are
`/tmp/photo-studio-round1-proof.log`, `/tmp/photo-studio-round1-focused.log` and
`/tmp/photo-studio-round1-knowledge.log`.

No runtime/source behavior, migration, deployment setting, asset, generated
inventory or model changed in this round. No new deviation was introduced;
the SQL fix is explicitly deferred under the host's no-new-migration instruction.
No commit, staging, push, publication, dependency install, worktree or server was
created. No additional UI work was performed, so the original design checklist
below is unchanged.

## Initial S0/S1 builder report (historical)

Implemented locally, dark by default. **Production/build/browser qualification is incomplete.**
Only S0 and S1 were changed. S2–S9, mobile, camera permissions, providers, credits,
makeup, hair and wigs were not started. No commit, staging, push, PR or publication
was performed; no Co-Authored-By was added. Another provider should independently
review the working diff and run the blocked proof.

The frozen plan's SHA-256 matched
`81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.
All edited source paths are relative to this checkout. Cached pinned model files
were read from an existing sibling checkout, hash-checked, then copied here;
no sibling source or build environment was changed.

## Implementation

- S0: pinned Face Landmarker Worker beside the unchanged person Worker; two-prefix
  preparation/verification and notices; actual Worker-first Assets admission;
  GET/HEAD gates, exact per-prefix WASM CSP, no-cache (revalidate) policy with no-store denials; ADR-0338.
- S1: `/app/photo-studio`, server layout/Worker/middleware gates and subordinate
  browser opt-in; Vey also hides the dark route. Pure shared effect math and nine
  look parity, WebGL2 renderer, shared bilateral kernel, conservative skin/eye/
  mouth masks, blemish soften, teeth/eye controls, colour controls, two original
  tone-curve looks, grain/vignette, One-Euro filter, compare, bounded undo/redo,
  three original draggable/keyboard-movable SVG stickers, and source-resolution
  PNG/JPEG export through the preview renderer.
- Source decoding freezes a bitmap, including for animated PNG/WebP input. The
  canvas stays at source resolution; CSS fits it inside a stable preview area.
  Late decoding/inference/export results cannot adopt a replaced source.
- Production remains at 67 variables. `EDITOR_RUNTIME_FLAGS` is unchanged at
  294 characters; `photoStudio` is absent in production and staging. No new binding.

## Proof executed

| Command/check | Result |
| --- | --- |
| Focused Node suite below, two workers | **90 passed, 0 failed, 0 skipped**; 12,112.607625 ms in the recorded run. |
| `npm run lint` | **Exit 0**, 0 errors, 156 warnings elsewhere in existing code. A final targeted lint of the new UI/engine/admission/copy files is clean. |
| `npm run typecheck` | **Exit 0**. This repository command checks `packages/security/tsconfig.json`, not all frontend JavaScript. |
| `node scripts/prepare-editor-vision.mjs` | **Pass** after reusing cached hash-matching model bytes. Old runtime: 28,624,644 bytes; new: 16,009,877 bytes. |
| `node scripts/verify-editor-vision.mjs public` | **Pass**: 14 files, 44,634,521 bytes, largest 16,371,837 bytes. |
| `npm run sync:vey-knowledge` and `npm run check:vey-knowledge` | **Pass/current**: 120 routes, 62 document sections. |
| `node scripts/generate-route-inventory.mjs --check` | **Pass/current** after regeneration for the new route. |
| Browser import graph bundled with existing esbuild, package imports external | **Pass**; this is a syntax/import-graph check, not a Next production build. |
| New host proof scripts: `node --check` | **Pass** for Worker probe, browser spec and synthetic browser fixture. |
| `git diff --check` | **Pass**. No staged changes. |

Focused command:

```sh
node --test --test-concurrency=2 \
  tests/liveEdit*.test.mjs \
  tests/editorVisionAssets.test.mjs tests/editorVisionWorkerClient.test.mjs \
  tests/editorVisionProcessing.test.mjs tests/editorCompletionGate.test.mjs \
  tests/videoEnhanceGraphics.test.mjs tests/videoEnhanceAssets.test.mjs \
  tests/securityHeaders.test.mjs tests/appI18nCatalogs.test.mjs \
  tests/appI18nCoverage.test.mjs tests/oddlingsPublic.test.mjs \
  tests/productKnowledgeSync.test.mjs tests/adminReporting.test.mjs
```

Coverage includes all four inference/Photo Studio flag combinations, old/new
Worker/model GET and HEAD admission, stale/unknown URLs, pin integrity, browser
preview input failing to bypass the route, Vey's independent gate, actual mobile
look-table parity, SDK polygon connections, matrix reference values, bounded
history, One-Euro reset, sticker anchors/provenance, bitmap/Worker cancellation
and late initialization, export while comparing, plus existing vision/security/
i18n/knowledge regressions. Admission unit tests **do not substitute for a built
Worker probe**. Real GPU output, model quality and timings are not established by
these Node results.

Recorded local logs are `/tmp/photo-studio-final-tests.log`,
`/tmp/photo-studio-lint-final.log`, `/tmp/photo-studio-changed-lint.log`,
`/tmp/photo-studio-typecheck.log`, `/tmp/photo-studio-assets-final.log`,
`/tmp/photo-studio-knowledge.log` and `/tmp/photo-studio-compile.log`.

## Denied and blocked proof

| Requested command | What actually happened |
| --- | --- |
| `npm test && npm run lint && npm run typecheck && npm run build` through `~/.local/bin/with-build-slot` | Wrapper exited 1 **before any command started**: `PermissionError: [Errno 1] Operation not permitted: '/Users/aljobson/.local/share/storage-guard/build-slot.lock'`. Individual lint/typecheck ran separately as lightweight checks. Full `npm test` and `npm run build` did not run. |
| `npm run build:worker` through the same wrapper | Same denied lock write; command did not start. |
| `npm run check:worker-size` through the same wrapper | Same denied lock write; command did not start. No bundle-size conclusion. |
| `node scripts/verify-editor-vision.mjs .open-next/assets` | Ran, exited 1: ENOENT for `.open-next/assets/editor-vision`; no production build exists here. The public-tree verification is separate evidence. |
| `node scripts/probe-photo-studio-worker.mjs` | Ran, exited 1 before launching a server: `.open-next/worker.js` is missing. No built Worker HTTP request was made. |
| Built Worker + real-renderer browser proof | Not run: requires that build and local Worker. Playwright is resolvable, but no browser was driven. |
| Remote `origin/main` / next ADR recheck | `git ls-remote` failed: GitHub DNS could not resolve. Local cached `origin/main` remains `8bb562cfb`; ADR-0338 is provisional pending host remote recheck. |
| Initial model download | Google Storage DNS failed. Recovered using existing exact SHA-256-matching cached files; no download or package installation was required. |

The mandatory shared build lock was not replaced with a private lock or bypassed.
No permission escalation was attempted (the session forbids it). No automatic
approval review rejection occurred; the blocker was the filesystem sandbox.

Logs: `/tmp/photo-studio-proof-chain.log`, `/tmp/photo-studio-build-worker.log`,
`/tmp/photo-studio-worker-size.log`, `/tmp/photo-studio-built-assets.log`,
`/tmp/photo-studio-worker-probe.log`.

## Deviations, limitations and host follow-through

1. **Proposed explicit asset-budget deviation:** two self-contained immutable
   runtimes require 44,634,521 bytes, exceeding the former single-prefix 32 MiB
   budget. The implementation uses a **48 MiB combined cap**, keeping 32 MiB per
   prefix and 25 MiB per file. Independent review must accept or revise this
   before integration. The bytes are static Assets, not the SSR bundle.
2. Web strings use i18n keys with shared English beta copy across the app catalogs,
   following the existing Music pattern. Reviewed translations remain necessary
   before localized rollout; this is not a claim of completed localization.
3. Source-resolution export applies to accepted photos: 50 MiB, 24 megapixels,
   8192 pixels per edge, minimum 8 pixels, and actual device graphics limits.
   Unsupported sources are explicitly refused, never silently downscaled. Host
   review must accept these bounds rather than assume arbitrary-size support.
4. Hair-channel protocol work is S3 and was deliberately not started. The current
   two-prefix retention is the old person runtime plus the new face runtime. A
   future segmentation protocol change requires its own prefix/retention review.
5. Still inference runs once per source. No >=15 Hz model rate or 16–33 ms render
   timing is claimed. Teeth/eye selection is polygon + luminance/chroma heuristics;
   blemish soften is local texture reduction. Real-face quality across skin tones,
   glasses, facial hair and poses remains unqualified. Model licence provenance
   preserves the existing inventory's distinction between SDK terms and model
   approval; production activation remains an owner decision.

After the standard proof/build, the host can run:

```sh
node scripts/probe-photo-studio-worker.mjs
# Or keep only its final local enabled instance for the browser proof:
node scripts/probe-photo-studio-worker.mjs --serve
# In a second terminal (existing Playwright installation):
npx --no-install playwright test -c e2e/photo-studio-proof.config.mjs
```

The probe tests all four flag combinations against the real Worker/Assets binding
with a disposable config and static public JWKS. It leaves `.dev.vars` untouched.
`--serve` is explicitly persistent for the host; Ctrl-C stops it. The browser
fixture is original synthetic colour/geometry. It tests page WASM denial, actual
WebGL2 compilation/orientation, zero strength, skin holes, face-off rendering,
combined PNG preview/export equality, the retained **actual person client**
processing against the old prefix, and no-face inference through the new prefix.
Only harness modules are intercepted. Worker/model URLs are not mocked. This is
not a licensed real-face visual quality substitute.

Manual owner checks remain: direct route/prefix denial with flags off; the full
photo workflow with flags on; 390/375 px and desktop screenshots in both themes;
keyboard and enlarged text; every slider/sticker; PNG/JPEG source dimensions;
DevTools confirming no request carries image/landmark content; cancelled source
replacement; and measured GPU/model time. No screenshots or manual network proof
were produced by this builder, as the work order reserves browser driving to the
host.

No worktree or preview server was created. None of the 59 registered worktrees
was identified as safely unused; no other chat's worktree was archived or removed.
No Metro, mock server, simulator, native install or dependency installation was
started. The ignored prepared vision assets (~44.6 MB plus manifests) remain in
this checkout for the host's build; no duplicate native environment was created.

## Files changed

- `app/veyrnox/_lib/editorVisionRuntime.mjs`
- `app/veyrnox/_lib/videoEnhanceRenderer.js`
- `lib/adminRouteInventory.json`
- `lib/editorRuntimeFlags.mjs`
- `lib/generatedProductInventory.js`
- `lib/i18n/messages/app/ar.mjs`
- `lib/i18n/messages/app/de.mjs`
- `lib/i18n/messages/app/en.mjs`
- `lib/i18n/messages/app/es.mjs`
- `lib/i18n/messages/app/fr.mjs`
- `lib/i18n/messages/app/hi.mjs`
- `lib/i18n/messages/app/ja.mjs`
- `lib/i18n/messages/app/ko.mjs`
- `lib/i18n/messages/app/pt.mjs`
- `lib/i18n/messages/app/ru.mjs`
- `lib/i18n/messages/app/zh.mjs`
- `lib/productKnowledge.js`
- `middleware.js`
- `scripts/editor-vision-assets.mjs`
- `scripts/prepare-editor-vision.mjs`
- `tests/oddlingsPublic.test.mjs`
- `tests/videoEnhanceGraphics.test.mjs`
- `worker.js`
- `wrangler.jsonc`
- `app/veyrnox/_lib/liveEdit/bilateral.js`
- `app/veyrnox/_lib/liveEdit/engine.js`
- `app/veyrnox/_lib/liveEdit/faceClient.mjs`
- `app/veyrnox/_lib/liveEdit/masks.js`
- `app/veyrnox/_lib/liveEdit/renderer.js`
- `app/veyrnox/_lib/liveEdit/shaders.js`
- `app/veyrnox/app/photo-studio/Controls.jsx`
- `app/veyrnox/app/photo-studio/PhotoEditor.jsx`
- `app/veyrnox/app/photo-studio/StickerHandles.jsx`
- `app/veyrnox/app/photo-studio/layout.js`
- `app/veyrnox/app/photo-studio/page.js`
- `docs/adr/0338-local-photo-studio.md`
- `docs/face-filters/PHOTO-STUDIO-S0-S1-REPORT.md`
- `e2e/photo-studio-proof.config.mjs`
- `e2e/photo-studio.proof.mjs`
- `lib/editorVisionAdmission.mjs`
- `lib/i18n/photoStudioEnglish.mjs`
- `lib/photoStudioGate.mjs`
- `packages/live-edit/effects.js`
- `packages/live-edit/looks.js`
- `packages/live-edit/regions.js`
- `packages/live-edit/smoothing.js`
- `packages/live-edit/stickers.js`
- `public/photo-studio/stickers/flower.svg`
- `public/photo-studio/stickers/heart.svg`
- `public/photo-studio/stickers/spark.svg`
- `scripts/editor-vision-notices/FACE-NOTICE.txt`
- `scripts/face-landmarker-worker.mjs`
- `scripts/probe-photo-studio-worker.mjs`
- `tests/fixtures/photo-studio-browser-proof.mjs`
- `tests/liveEditAdmission.test.mjs`
- `tests/liveEditLifecycle.test.mjs`
- `tests/liveEditMath.test.mjs`

## Design goal criteria

The goal is met when… (statuses below are evidence limits, not a visual sign-off).

### Layout and spacing

- **Checked** — No piece of information appears twice on one screen (a balance, a price, a title or a status is shown in one place). (source review: one title/status location.)
- **Not applicable** — Mobile: every gap, padding and margin is a `ds.space` step (2/4/8/12/16/20/24/32/40/56), and the screen gutter is 20. (no mobile changes.)
- **Checked** — Web: every gap is on the Tailwind 4 px scale, with no arbitrary `[13px]` values. (source: Tailwind 4 px spacing.)
- **Checked** — Mobile radii come from the set 6/10/14/20/28/999 and web radii from `rounded-xl` (16), `rounded-2xl` (24) and `rounded-3xl` (32). An inner piece has a smaller radius than the card around it, never the same or larger. (source: web rounded-xl/2xl hierarchy.)
- **Checked** — Light-mode shadows use `e1` or `e2` only. Dark and OLED mode have no shadow, so depth comes from `bgElevated1`, `bgElevated2` and `surface`. (no shadows introduced.)
- **Checked** — Rhythm is intentional: not every section has the same padding, and the page has one clear primary action (`.claude/rules/ecc/web/design-quality.md`). (source: photo-led layout and one primary export action.)

### Colour, type and brand

- **Not applicable** — Mobile: no hex or `rgb()` literal outside `theme.ts`; every colour is a semantic token (`bg`, `surface`, `textPrimary`, `accent`, `danger`…). (no mobile changes.)
- **Not checked** — Web: every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`, `text-vx-accent`…), and both themes are checked. (vx token classes used; both themes need host review.)
- **Checked** — Amber (`money` / `warning`) appears only on money and credit amounts. Aqua (`accent`) marks actions. `danger` marks errors and destructive actions only. (source: action/error semantics; no amber.)
- **Not checked** — Text on its background is at least 4.5:1 (3:1 for large text and for icons and borders that carry meaning), in light, dark and OLED, and for each of the five mobile accents. (contrast requires rendered theme review.)
- **Checked** — Fonts: web uses Inter (body), Archivo (display) and JetBrains Mono (small labels) and nothing else. Mobile uses only the selected Typeface pair (studio, editorial or technical). Mobile text uses a `type` step, with no numeric `fontSize` on the screen. (source: inherited Inter, Archivo and JetBrains tokens.)
- **Not applicable** — No weight 800 or 900 in new mobile code (ADR-0264). (no mobile changes.)
- **Not applicable** — No model or provider is shown failing in marketing visuals; say the refund promise in words. (no marketing visuals.)
- **Checked** — Nothing on a customer-facing surface uses wallet or on-chain wording (`scripts/check-hard-wall.sh`). (new copy contains no wallet/on-chain wording.)

### Ease of use and accessibility

- **Checked** — Every tappable control is at least 44 pt (mobile) or 44 CSS px (web touch). A visually small mobile button gets `hitSlop` to reach 44. Primary buttons are 52. (source: controls at least 44 CSS px, primary export 52.)
- **Not checked** — At the largest in-app text size (XL, ×1.25) and at OS scaling 1.5 nothing is clipped, overlapped or pushed off-screen, and the primary button is still visible without horizontal scroll. (largest text/OS scaling needs host browser.)
- **Checked** — Every control has an accessible name, and every status change (loading finished, error shown, saved) is announced, not only coloured. (source: named controls and status/alert regions.)
- **Not checked** — Every focusable web element shows a visible focus ring and can be reached and used from the keyboard. (focus styles/key handlers present; complete keyboard journey is host-run.)
- **Checked** — With reduced motion on, press scaling, confetti and looping animation are off and the screen still makes sense. (no motion, press scaling or loops introduced.)
- **Not checked** — Layout holds at 375 px wide and at 1280 px wide with no horizontal page scroll. (375/1280 px rendered layout remains host-run.)

### Money screens

- **Not applicable** — Every price and balance is read from the catalog or the API. No price is computed in the app layer. (no price or balance.)
- **Not applicable** — Before a Credit spend, the user sees the exact cost; after it, the new balance. A failed submit shows that the Credits were returned. (no Credit spend.)
- **Not applicable** — A paid action cannot be double-submitted: the button is disabled while the request runs and the request carries an idempotency key. (no paid operation.)

### Reachable states

| State | Status and evidence |
| --- | --- |
| Empty | Checked in source: explanation and Choose photo. Rendered review not run. |
| Loading | Not checked for the 100 ms timing claim. Source reserves the preview area and shows a decoding status immediately. |
| Error | Checked in source: safe localized message and retry/change source; no raw vendor payload. |
| No internet | Checked in source: online/offline listener and model-download notice; loaded edits retained. Network journey not run. |
| Slow network | Checked in source: persistent model preparation explanation, ordinary colour controls available, bounded timeout. Timing not measured. |
| Service outage | Not applicable to this local editing operation; existing global status UI was not changed. |
| No search results | Not applicable: no search. |
| Permission denied | Checked in code/tests: disabled route is 404; storage failure has a recovery message. No camera permission is requested. |
| Session expired | Not applicable to local editing: no session is required by this tool and source pixels are not submitted. Shared shell behavior unchanged. |
| Form validation | Checked in source/tests: selected file type/size/dimensions validated; invalid choice preserves existing photo. |
| Success | Checked in source: ready-to-download announcement and download action. Actual browser download not run. |

- **Not checked** — The screen-specific goal is met when an accepted photo's actual
  preview and PNG export match at source resolution, every effect visibly changes
  its intended pixels, and browser requests carry no image/landmark content. The
  runnable synthetic proof is supplied; integrated and real-face host evidence
  remains outstanding.
