# Native Wobnimo stage 2B advisory proof

Frozen order SHA256: `7ae31af4a945053136101babe7701784348bbf3162478a19078f087996f9076c`.
Implemented in `mobile-native-stage2b`, relative to this checkout. No commit, push, publication, dependency install, native build, Metro/mock server, simulator or additional worktree was created. Other checkouts were not edited.

## Implementation

- `apps/mobile/scripts/sync-wobnimo-bundle.mjs`: SHA-pinned extraction of upstream Brain, Rig, Fx and seeded random; build-time compilation of the 20 selectable specs; deterministic output and `--check`. Upstream shape changes fail closed.
- `apps/mobile/scripts/wobnimo/translate.mjs`: explicit GLSL-to-SkSL rules, including entry/exit, Y flip, constant loop bounds, expression constants, tetrahedron bit operations and the LED zigzag. The final gamma expression is unchanged.
- `apps/mobile/src/lib/wobnimoEngine.generated.js`, `wobnimoData.generated.ts`, `wobnimoPrograms.generated.ts`: actual headless ES module, compiled rig/behaviour data and 20 shader programs/layouts. Each includes the full upstream MIT notice. Generated code is exempt from the source line limit; programs are approximately 538 KiB uncompressed because each mascot has its own complete raymarcher.
- `apps/mobile/src/lib/wobnimoEngine.generated.d.ts`: typed boundary for the extracted upstream classes.
- `apps/mobile/src/lib/wobnimoNative.ts`: behaviour timing and uniform adapter; capped physical target sizing; explicit sRGB offscreen rendering; deterministic resource cleanup and error propagation.
- `apps/mobile/src/components/WobnimoView.tsx`: native sRGB Canvas displays the offscreen image at logical size; RN animation frames throttled near 30 fps; state updates preserve the engine; reduced motion mirrors upstream's two settled frames; background/focus/unmount pause; errors call the existing robot fallback.
- `apps/mobile/src/components/VeyCharacter.tsx`: update stale WebView/WebGL comments.
- Delete `apps/mobile/src/lib/wobnimoBundle.generated.ts`; no consumers remain.
- `apps/mobile/__tests__/veyCharacterChoice.test.ts`: replace the obsolete HTML-bundle assertion with native catalog coverage.
- `apps/mobile/__tests__/wobnimoRender.test.ts`: real CanvasKit compilation, independent expected uniform sizes, all-character rendering and alpha sanity, density framing, gamma/color regressions, finite data across all 200 character/state combinations, renderer failure/disposal checks, generator freshness and browser-free source checks.
- `apps/mobile/__tests__/fixtures/wobnimoColorGoldens.ts`: fixed-time RGB/alpha reference samples for Volt, Ember and Berry, with an explicit regression-only limitation.
- `apps/mobile/__tests__/wobnimoView.test.tsx`: mocked Skia component lifecycle, state forwarding, resolution, reduced motion, frame throttle, pause, failure and disposal checks.

## Accepted review fixes (round 2)

Only these implementation/test files changed in this round, plus this report:

- `apps/mobile/src/lib/wobnimoNative.ts`: R2-001 converts every snapshot with `makeNonTextureImage()` and disposes the texture in `finally`; null/throw readback failures propagate to the fallback. R2-003 lazily caches compiled effects per character and Skia runtime for that runtime's lifetime. Views own their paint and surface, and resizing disposes the old surface without recompiling. R2-004 ports upstream's adaptive thresholds and factors, clamping quality to 0.55–1 before multiplying the physical render size.
- `apps/mobile/src/components/WobnimoView.tsx`: R2-002 uses the existing `expo-router/react-navigation` NavigationContext export, subscribes to focus/blur only when present, and treats missing navigation as focused. R2-004 samples every RAF independently of the 30 fps drawing throttle, then resizes the target and updates uResolution together.
- `apps/mobile/__tests__/wobnimoView.test.tsx`: real NavigationContext with no useIsFocused mock; no-provider rendering; focus subscriptions and cleanup; actual renderer with mocked Skia handles proving raster-only display, texture disposal and readback error fallback; two mounts compile once; mocked-clock shrink, floor and recovery tests.
- `apps/mobile/__tests__/wobnimoRender.test.ts`: allocation failure now asserts that a shared effect is retained. Existing all-character compilation, density 1/2/3 framing and color assertions are unchanged.

The generated engine, programs, data and color goldens were not regenerated or edited in round 2. No unrelated source changes.

## Deviations, denied actions and limits

- No new scope deviation: the host explicitly allowed the retained offscreen path with raster readback and lifetime effect caching. Readback adds a per-frame GPU-to-CPU transfer; device performance remains unverified.
- No newly denied tool action in this round. Earlier ARTEMIS exploration was blocked by unavailable MCP tools, a misconfigured host and no device; that accepted finding was not retried. Earlier build-slot lock/cache/process-inspection denials remain recorded in the prior conversation; this round runs only the explicitly scoped proof, not a full suite or build.
- The old `jest wobnimo vey` overmatching issue is resolved by the newly agreed explicit test paths. It is not a blocker for this revision.
- The existing float uFxCount translation is unchanged. Color goldens remain CanvasKit regression baselines, not independent WebGL parity references or human approval. Device frame rate, GPU cost, visual parity and P3-versus-sRGB appearance remain unverified.
- Full mobile Jest and iOS/Android release bundles remain host checks. No dependency install, additional worktree, simulator, Metro/mock server, commit, push or publication occurred. Package manifests, lockfiles, app.json and eas.json remain unchanged. No unused worktree was created.

## Round 2 validation

Agreed command (executed exactly):

```sh
cd apps/mobile && npx jest __tests__/wobnimoRender.test.ts __tests__/wobnimoView.test.tsx __tests__/veyCharacterChoice.test.ts
```

Exit **0**. Raw output: `/private/tmp/veyrnox-s2b-r2-proof.log`.

```text
Test Suites: 3 passed, 3 total
Tests:       40 passed, 40 total
Snapshots:   0 total
Time:        154.645 s
```

All 20 programs still compile and render. Existing density 1/2/3 framing and color assertions pass after raster conversion. New component tests cover the four accepted fixes, including null/throw readback failures. The additional explicit VeyCharacter regression command is `cd apps/mobile && npx jest __tests__/veyCharacter.test.ts __tests__/veyInteractive.test.tsx` — exit **0**, **2 suites / 25 tests passed**, 12.139 seconds (`/private/tmp/veyrnox-s2b-r2-vey.log`).

- TypeScript: exit 0.
- ESLint on the four changed source/test files: exit 0, no errors; three existing test-only require() warnings.
- Generator `--check` and `git diff --check`: pass.
- The first component run caught a test-clock recovery assertion (16ms callbacks versus exact 60Hz); the final test uses 1000/60ms callbacks. Production thresholds were not changed to accommodate the test.

## CanvasKit CPU frame costs

Same seeded idle, 128×128, single-frame CPU proxy as round 1; now includes conversion to a non-texture image as well as draw and pixel readback. Effect construction and PNG encoding are outside the timer. These figures do not establish device frame rate.

| Character | Draw + raster conversion + readback (ms) |
| --- | ---: |
| volt | 6,456.00 |
| pip | 5,005.00 |
| mochi | 2,024.00 |
| boo | 1,640.00 |
| inky | 13,152.00 |
| miso | 9,688.00 |
| tad | 5,861.00 |
| pebble | 5,973.00 |
| rex | 11,937.00 |
| microduck | 8,338.00 |
| drift | 5,034.00 |
| cacti | 4,489.00 |
| latte | 2,438.00 |
| bumble | 2,347.00 |
| swirl | 6,209.00 |
| ember | 7,646.00 |
| cap | 2,847.00 |
| berry | 4,746.00 |
| bao | 5,261.00 |
| hop | 3,348.00 |

Raw timing JSON and rendered PNGs: `/var/folders/l3/4f36t9jn439c8fk_1zqgx8pc0000gn/T/veyrnox-s2b-proof/`. Shared-host load affects timing; no device frame-rate claim.
