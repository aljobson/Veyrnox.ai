# Mobile automated QA — 2026-10-25

## Release verdict

The signed-in iOS application, Social Cinema route, native Editor, Creative Tools directory, and all 22 Creative Tool detail workflows pass automated device journeys on iPhone 17 Pro. A full creation journey also submits an image generation, observes completion, renders its output, and finds the ready creation in Library. The generation-source mock supports the same grant + raw PUT sequence used by the app.

The complete mobile Jest suite is green. Seven pre-existing full-lint errors remain in unchanged files; they are listed below rather than hidden by exclusions.

## Automated evidence

| Area | Result | Evidence |
| --- | ---: | --- |
| Native smoke suite | 4/4 passed | Explore/Create/Editor/Library/Publish, menu, Social Cinema, Creative Tools catalogue, saved Editor project |
| Generated-output device journey | 1/1 passed | Prompt submitted, job completed, output rendered, ready creation found in Library; three screenshots retained |
| Creative Tool device matrix | 22/22 passed | Example media, exact required upload count, Library alternative, source permission, final review |
| Focused unit/component regression | 44/44 passed | Mock parity, tab shell, full Editor, uploads, Creative Tool screens |
| Complete mobile Jest suite | 3,607/3,607 passed | 200/200 suites, including regenerated Oddlings web/mobile parity |
| Accessibility/navigation specialist | 1,269/1,269 passed | 11 focused suites covering first run, auth, tabs, menu, Editor reachability, and link mapping |
| Creative upload specialist | 37/37 passed | 22 tool definitions, six live model mappings, slot contracts, and 35 example URLs |
| TypeScript | Passed | `tsc --noEmit` |
| Changed-file lint and syntax | Passed | ESLint, `node --check`, and `git diff --check` |
| Expo exports | Passed | iOS and Android Hermes exports completed in the specialist build sweep |
| Upload HTTP contract | Passed | `POST /api/v1/uploads` 200, raw `PUT /mock-upload/:id` 200 |

Device runs use `e2e.config.ts`, iPhone 17 Pro, one worker, no retries, and retain traces/video on failure.

## Defects fixed by this QA pass

- Social Cinema appeared in the menu but resolved back to Explore. It now owns a real stack route at `/cinema`.
- The development backend listed saved Editor projects but omitted document reads and project assets, so opening one ended in “Check your connection.” Both contracts are now implemented and the native Editor journey passes.
- Creative Tool upload controls existed, but the QA backend omitted generation upload grants and raw uploads. The mock now validates type/size, mints a grant, and accepts the PUT.
- Product Video Generator showed 12 credits in the mobile mock while production reports 26. The mock now matches production.
- The native Editor tool rail now has a stable test identifier for black-box automation.
- Oddlings mobile data and prompt continuity had drifted from the curated web cast. The generated cast, roster assertions, and continuity-lock prompt logic now match the web source of truth.

## Known repository/product gaps

- Full lint baseline: 7 errors and 308 warnings remain in unchanged files. CI currently does not run lint. All files changed by this QA pass lint cleanly.
- Android App Links remain disabled until real SHA-256 signing fingerprints are configured. Those values must not be invented.
- Universal/App Link association lists do not yet cover every nested Editor, Creative Tool, Cinema, Publish, OAuth, and review path supported by the in-app mapper.
- AI Lip Sync and Talking Objects currently present still examples for video-output workflows. Six other tool examples are WebM; their detail renderer does not provide a poster/fallback for iOS playback failure.

## Relight and Video Upscale (QA rows 4.T6, 4.T12)

Neither is missing from the code. Both are catalog rows that are inactive, so the Tools page (which lists only what the live catalog serves) correctly omits them:

- **Relight** is the Face filters model `face-relight` (`fal-ai/iclight-v2`, 7 Credits provisional). Migration 0357 left it inactive: fal billed 2.00 megapixels ($0.20, double the $0.10 recorded) in a test that did not use the pinned canvas. It appears under Face filters once one job with the pinned payload is verified and a migration activates it.
- **Video Upscale** is `topaz-upscale-video` (`fal-ai/topaz/upscale/video`, 49 Credits, worst-case flat tier). Migration 0202 staged it inactive until a real staging generation is checked against fal's usage page.

The phone already has the `video-upscale` task and lists `face-relight`, matching the web `/tools` page. The QA expectation should read "shown when the catalog serves it". No endpoint was activated or invented here.

## Repeat locally

```sh
cd apps/mobile
npm test -- --runInBand __tests__/devMockParity.test.ts __tests__/tabShell.test.ts __tests__/fullEditorScreen.test.tsx __tests__/uploads.test.ts __tests__/creativeFeatureScreen.test.tsx
npm run typecheck
npm run test:e2e -- --target ios-simulator --tag smoke
npm run test:e2e -- tests/generation.e2e.ts --target ios-simulator
npm run test:e2e -- tests/creative-tools.e2e.ts --target ios-simulator
```

Run the two device commands through `~/.local/bin/with-build-slot` when sharing the host with another heavy build.
