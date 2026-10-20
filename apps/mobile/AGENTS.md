This is an Expo/React Native mobile application. Prioritize mobile-first patterns, performance, and cross-platform compatibility.

## Expo has changed — do not trust your training data

Expo ships breaking changes every SDK release. APIs you remember are likely renamed, moved, or removed. Before writing any code that touches an Expo, EAS, or React Native API:

1. Read the major version of the `expo` package in `package.json`.
2. Fetch the matching versioned docs: `https://docs.expo.dev/versions/v<major>.0.0/`
3. For anything else, fetch https://docs.expo.dev/llms.txt — an index of all Expo docs with corrections to common LLM misconceptions. Follow its links to the specific page you need; never answer from memory.

## Commands

Use `bunx` instead of `npx` if the project uses bun (`bun.lock` present).

```bash
npx expo install <package>  # ALWAYS use instead of npm/yarn/pnpm/bun add — resolves SDK-compatible versions
npx expo start              # start the dev server
npx expo lint               # lint
npx tsc --noEmit            # typecheck
npx expo-doctor             # diagnose dependency and config issues
npx expo install --fix      # fix incompatible package versions
```

Run lint and typecheck before declaring any task done.

## Navigation & Routing

- Use **Expo Router** for all navigation. Routes live in `src/app/` — every file there is a screen, `_layout.tsx` files define navigators. Keep non-route code (components, hooks, utils) outside `src/app/`.
- Import `Link`, `router`, and `useLocalSearchParams` from `expo-router`.
- Docs: https://docs.expo.dev/router/introduction.md

## Building with EAS

Use EAS to build, sign, and submit the app in the cloud (`eas build`, `eas submit`) and to ship over-the-air updates (`eas update`) — no local Xcode or Android Studio required. Run EAS CLI as `bunx eas-cli <command>` in Bun projects, or `npx eas-cli@latest <command>` otherwise; substitute that for bare `eas` in docs examples.
Docs: https://docs.expo.dev/eas/index.md

## Rules

- If `ios/` and `android/` directories do not exist, they are generated (Continuous Native Generation). Never create or edit them by hand — configure native behavior in `app.json` and config plugins.
- Expo Go only includes its bundled native modules. After adding a library with native code, the app needs a development build: `npx expo run:ios|android` locally, or `eas build --profile development`.
- Prefer recommended Expo modules over third-party libraries, and check your available skills before adding dependencies. Docs: https://docs.expo.dev/versions/latest/index.md

## Shared catalogs and ADRs

- English keys live in `src/lib/i18n/messages/en/<area>.ts`, one area per key prefix before the first dot (for example, `chat.*` goes in `chat.ts`). Preserve values, placeholders and key comments. `_order.ts` is frozen historical enumeration metadata; never add new keys there. New keys follow the historical keys in sorted area filename order and insertion order within each area. Different areas merge independently; edits to the same area can still conflict.
- Each area file contains a single `export default { ... } as const;` object of string values, with no imports or additional executable code. Comments and blank lines, including trailing comments after the export, are allowed.
- After creating an area, run `node scripts/gen-en-registry.mjs` from `apps/mobile`. `en.ts` is the generated import/spread registry; resolve any conflict there by running that command, then stage the result when preparing your commit. `--check` verifies it in CI and Jest.
- The localization list is generated on demand: run `node scripts/sync-web-i18n.mjs` from `apps/mobile` to write `docs/mobile/I18N-NEW-KEYS.md`. Do not commit this ignored file; CI uploads the `i18n-new-keys` artifact. On a modify/delete conflict run `git rm docs/mobile/I18N-NEW-KEYS.md`. `--check` checks committed locale catalogs only; the wiring test checks the in-memory app-only list. Older ADR references describe this same generated list.
- Create standalone ADRs with the next free number after checking main and open PRs. Include a first `#` heading and a `Status:` line. Do not edit `docs/adr/README.md` or `index-baseline.txt`. Read the full index with `node scripts/adr-index.mjs` from the repository root, or list `docs/adr/`; filenames distinguish amendments and repeated numbers.
