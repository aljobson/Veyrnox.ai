# S5a implementation report — advisory, awaiting independent review

Implemented only WEB Photo Studio 2D wig overlay on committed S0–S4
`395e3d030`, in this checkout. Frozen PLAN.md SHA-256 verified:
`81d054aa1f9c50d8c4ed5c74ccb195a4c2c8e906ac99c18e4d3e362473383ce9`.
No commit, staging, push, publish or activation was performed.

**These six original code-authored SVGs are stylised placeholders that prove
 the pipeline, not photo-real wigs.** No image generation provider, Credits,
third-party artwork, upload or new dependency was used.

R4 is binding: the overlay never erases or reconstructs natural hair. Visible
hair outside a wig remains visible. Uncovered hair above the documented 15%
threshold shows “Tuck your hair or choose a longer style” via a literal t() key.
The hair mask only provides edge blending, coverage estimation and existing
recolour. Face protection clips only the wig. Tint shares hair pigments and the
same luminance-preserving function; controls/history/export are integrated.

## Proof actually executed

```text
node --test tests/liveEdit*.test.mjs
ℹ tests 48
ℹ suites 0
ℹ pass 48
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0

node scripts/audit-public-i18n.mjs --app
{"summary":{"translated":5655,"allowlisted":1803,"unresolved":0}}

node scripts/sync-vey-knowledge.mjs
Updated Vey knowledge (120 routes, 62 document sections).

git diff --check
(no output; pass)
```

All commands above exited zero. Node emits the existing MODULE_TYPELESS_PACKAGE_JSON
warning; no dependency/package changes were made to silence it. JS syntax checks
passed for the changed proof, layer and shader modules and Playwright entry.
Installed TypeScript's transpileModule reported no JSX syntax diagnostics for
Controls, PhotoEditor and WigControls; this is **not** a typecheck or lint run.

New CPU cases verify installed SDK 1.0.1 anchor membership, six file hashes and
provenance, SVG resource restrictions, similarity translation/scale/roll on
rectangular images, clamps/pivots, yaw/pitch fade, coverage and long-hair fixture,
source-over opacity invariants, history, lazy image lifecycle/cancellation,
load failure, and export snapshot/close races. The regular npm test glob includes
the new node:test files in CI. Existing focused Photo Studio tests also pass.

## Host-only proof: NOT executed here

Per the work order, the sandbox cannot launch Chromium or take the build lock.
The following were not attempted and have **no result claimed**:

- `npm test` (full suite), `npm run typecheck`, `npm run lint`.
- `npm run check:vey-knowledge` (generation ran; host check still required).
- `npm run build:worker`, `npm run check:worker-size`.
- `node scripts/verify-editor-vision.mjs .open-next/assets`.
- `node scripts/probe-photo-studio-worker.mjs` and its `--serve` mode.
- `npx playwright test --config=e2e/photo-studio-proof.config.mjs`.
- Visual/browser keyboard, theme, responsive layout, reduced-motion, network,
  real portrait and assistive-technology qualification.

The existing host config retains SwiftShader flags. Run the Playwright command
against the built local Worker started by the probe's `--serve` mode. Host heavy
commands must use `~/.local/bin/with-build-slot`; persistent probe serving must
not hold that slot. Stop a host-started preview after qualification.

The extended GPU proof decodes all six real SVGs through same-origin assets
under the strict page CSP; asset URLs are not intercepted. It checks transparent
openings, every changed pixel against an independent synthetic silhouette,
protected eyes/brows/nose/mouth, exact zero and compare, monotonic opacity,
yaw/pitch fading, no-face/multiple/face-loss off, unchanged long hair/no holes,
translucent-source alpha, tint luminance, undo/redo and exact combined PNG export
while comparing. Only flat plateaus or relations are used, tolerance 2/255
(exact zero/PNG/alpha where stated). Every violating pixel/channel is retained
with expected/actual; scenario exceptions and all wig misses are returned, and
the complete result is logged before Playwright assertions. These are authored
checks, **not evidence of a successful GPU run**. No real photos are committed.

## Deviations, bounds and blocked/denied actions

- SVG replaces the plan's PNG assets as explicitly requested for this run.
- Optional piecewise-affine fitting is omitted by judgment; five-anchor
  least-squares similarity proves fit without claiming photographic realism.
- Pose is a depth proxy, fading 20°–35°, not calibrated physical head pose.
- Overlay rasterization is capped at 1024 pixels on the longest edge; the photo
  and export stay at source resolution. This is an explicit bounded-memory
  quality tradeoff; edges can soften on large exports.
- Ear-adjacent face-oval landmarks are used, not detected ear geometry. Side
  angles, hats, glasses outside the oval, and long natural hair limit fit.
- Existing dark-preview English copy is shared by web locales; reviewed
  localized rollout remains deferred under the existing S0–S4 mechanism.
- The ADR was 498 lines. Its existing S4 text was moved verbatim to a linked
  appendix to keep the amended ADR and every authored source/doc below 500.
- **Proposed line-limit exception:** the pre-existing generated product
  inventory is 13,061 lines. It was regenerated by the required script, never
  hand-edited. Splitting the generator/output would broaden this frozen slice;
  the reviewer should accept this existing generated-file exception or request
  a separately scoped generator change. No silent redesign was made.
- No action was rejected by automatic approval review in this run. Host-only
  actions were intentionally not attempted, rather than reported as executed
  and denied. No forbidden file, mobile code, Worker prefix or configuration
  changed. No new checkout, dependency install, server or native build was made.
  No worktree was created or made unused by this run; other chats' checkouts
  were not inspected, modified or archived.

## Changed files

- `app/veyrnox/_lib/liveEdit/engine.js`
- `app/veyrnox/_lib/liveEdit/hairShader.js`
- `app/veyrnox/_lib/liveEdit/renderer.js`
- `app/veyrnox/_lib/liveEdit/settings.js`
- `app/veyrnox/_lib/liveEdit/shaders.js`
- `app/veyrnox/_lib/liveEdit/wigLayer.js`
- `app/veyrnox/_lib/liveEdit/wigShader.js`
- `app/veyrnox/app/photo-studio/Controls.jsx`
- `app/veyrnox/app/photo-studio/PhotoEditor.jsx`
- `app/veyrnox/app/photo-studio/WigControls.jsx`
- `docs/adr/0335-local-photo-studio.md`
- `docs/adr/0335-photo-studio-s4-appendix.md`
- `docs/face-filters/PHOTO-STUDIO-S5A-REPORT.md`
- `e2e/photo-studio.proof.mjs`
- `lib/generatedProductInventory.js`
- `lib/i18n/photoStudioEnglish.mjs`
- `packages/live-edit/wigFit.js`
- `packages/live-edit/wigs.js`
- `public/photo-studio/wigs/bob.svg`
- `public/photo-studio/wigs/braids.svg`
- `public/photo-studio/wigs/curls.svg`
- `public/photo-studio/wigs/long.svg`
- `public/photo-studio/wigs/pixie.svg`
- `public/photo-studio/wigs/waves.svg`
- `tests/fixtures/photo-studio-browser-proof.mjs`
- `tests/fixtures/photo-studio-wig-fixture.mjs`
- `tests/fixtures/photo-studio-wig-proof.mjs`
- `tests/liveEditWigLifecycle.test.mjs`
- `tests/liveEditWigs.test.mjs`

## Design goal criteria — Photo Studio / WigControls

The goal is met when:

- **Not checked (browser required):** No piece of information appears twice on
  one screen (a balance, a price, a title or a status is shown in one place).
- **Checked (source):** Web: every gap is on the Tailwind 4 px scale, with no
  arbitrary `[13px]` values.
- **Checked (source, applicable web part):** Mobile radii come from the set
  6/10/14/20/28/999 and web radii from `rounded-xl` (16), `rounded-2xl` (24) and
  `rounded-3xl` (32). An inner piece has a smaller radius than the card around
  it, never the same or larger. No new nested card was added.
- **Checked (source; no new shadows):** Light-mode shadows use `e1` or `e2`
  only. Dark and OLED mode have no shadow, so depth comes from `bgElevated1`,
  `bgElevated2` and `surface`.
- **Not checked (visual review required):** Rhythm is intentional: not every
  section has the same padding, and the page has one clear primary action.
- **Not checked (both themes require host); tokens checked in source:** Web:
  every colour is a `vx` token class (`bg-vx-base`, `text-vx-fg`,
  `text-vx-accent`…), and both themes are checked. Wig pigment colours are art.
- **Checked (source):** Amber (`money` / `warning`) appears only on money and
  credit amounts. Aqua (`accent`) marks actions. `danger` marks errors and
  destructive actions only. No new amber or danger treatment was added.
- **Not checked (rendered contrast required):** Text on its background is at
  least 4.5:1 (3:1 for large text and for icons and borders that carry meaning),
  in light, dark and OLED, and for each of the five mobile accents.
- **Checked (source, applicable web part):** Fonts: web uses Inter (body),
  Archivo (display) and JetBrains Mono (small labels) and nothing else.
- **Not applicable:** No model or provider is shown failing in marketing
  visuals; say the refund promise in words. No marketing visuals were changed.
- **Checked (new copy):** Nothing on a customer-facing surface uses wallet or
  on-chain wording. No new copy uses that wording.
- **Checked (source), not device-measured:** Every tappable control is at
  least 44 pt (mobile) or 44 CSS px (web touch). New controls reuse min-h-11.
- **Not checked (host scaling required):** At the largest in-app text size
  (XL, ×1.25) and at OS scaling 1.5 nothing is clipped, overlapped or pushed
  off-screen, and the primary button is still visible without horizontal scroll.
- **Checked (source), not screen-reader-qualified:** Every control has an
  accessible name, and every status change (loading finished, error shown,
  saved) is announced, not only coloured. Labels and role=status are wired.
- **Checked (source), keyboard run not checked:** Every focusable web element
  shows a visible focus ring and can be reached and used from the keyboard.
- **Checked (source; no new animation), runtime not checked:** With reduced
  motion on, press scaling, confetti and looping animation are off and the
  screen still makes sense.
- **Not checked (host browser required):** Layout holds at 375 px wide and at
  1280 px wide with no horizontal page scroll.
- **Checked by CPU; GPU not checked:** A short wig preserves uncovered long
  natural hair and announces the hint; zero wig opacity contributes no pixels,
  face features stay protected and PNG export equals the edited preview.

Applicable state criteria: **Empty** (existing choose-photo action), **Loading**
(wig loading status and stable controls), **Error** (artwork failure with Retry
photo/another style), **No internet** (existing offline banner, loaded art
retained), **Slow network** (named loading status and 15-second failure bound),
**Success** (ready/status and existing download) are **checked in source, not
checked in browser**. The Loading <100 ms timing and Slow network timing require
host measurement. **Service outage**, **No search results**, **Permission
denied**, **Session expired** and **Form validation** are **not applicable to
this local overlay**; existing route/auth behavior was unchanged. Mobile-only
layout, typography, accents and weight rules, and all Money-screen criteria
are **not applicable** to this web-only, zero-Credit slice.
