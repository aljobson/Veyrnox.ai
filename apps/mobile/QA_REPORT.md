# Mobile automated QA — 2026-10-25

## Release verdict

The signed-in iOS application, Social Cinema route, native Editor, Creative Tools directory, and all 22 Creative Tool detail workflows pass automated device journeys on iPhone 17 Pro. The generation-source mock now supports the same grant + raw PUT sequence used by the app.

The repository is not globally green because six pre-existing Oddlings assertions and seven pre-existing lint errors remain outside this change. They are listed below rather than hidden by retries or exclusions.

## Automated evidence

| Area | Result | Evidence |
| --- | ---: | --- |
| Native smoke suite | 4/4 passed | Explore/Create/Editor/Library/Publish, menu, Social Cinema, Creative Tools catalogue, saved Editor project |
| Creative Tool device matrix | 22/22 passed | Example media, exact required upload count, Library alternative, source permission, final review |
| Focused unit/component regression | 44/44 passed | Mock parity, tab shell, full Editor, uploads, Creative Tool screens |
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

## Known repository/product gaps

- Full Jest baseline: 197/200 suites passed and 3,599/3,605 tests passed. The six failures are unchanged Oddlings parity assertions (`oddlingsBuilder`, `oddlingsAnimate`, and `oddlings`) caused by web/mobile cast and continuity drift.
- Full lint baseline: 7 errors and 308 warnings remain in unchanged files. CI currently does not run lint. All files changed by this QA pass lint cleanly.
- Android App Links remain disabled until real SHA-256 signing fingerprints are configured. Those values must not be invented.
- Universal/App Link association lists do not yet cover every nested Editor, Creative Tool, Cinema, Publish, OAuth, and review path supported by the in-app mapper.
- AI Lip Sync and Talking Objects currently present still examples for video-output workflows. Six other tool examples are WebM; their detail renderer does not provide a poster/fallback for iOS playback failure.

## Repeat locally

```sh
cd apps/mobile
npm test -- --runInBand __tests__/devMockParity.test.ts __tests__/tabShell.test.ts __tests__/fullEditorScreen.test.tsx __tests__/uploads.test.ts __tests__/creativeFeatureScreen.test.tsx
npm run typecheck
npm run test:e2e -- --target ios-simulator --tag smoke
npm run test:e2e -- tests/creative-tools.e2e.ts --target ios-simulator
```

Run the two device commands through `~/.local/bin/with-build-slot` when sharing the host with another heavy build.
