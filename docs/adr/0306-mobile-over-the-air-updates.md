# ADR-0306: Mobile over-the-air updates

Status: Accepted; takes effect with the next native build

## Context

Every fix to the mobile app currently waits on an App Store build and review. Most fixes are JavaScript and assets only.

## Decision

The app uses `expo-updates` with EAS Update. A published update changes JavaScript and assets only; anything that touches native code needs a new store build.

- `runtimeVersion` uses the `fingerprint` policy. An update reaches only builds with an identical native fingerprint, so a native change (a new plugin, an SDK bump) can never be paired with JavaScript that expects it.
- Each build profile in `eas.json` has a channel of the same name: `development`, `preview`, `production`. `production-simulator` extends `production`. An update is published to one channel and reaches only builds made for it.
- `checkAutomatically` is `ON_LOAD` with `fallbackToCacheTimeout` 0. At launch the app starts at once on the bundle it has, downloads a newer one in the background, and runs it from the next cold start. Nothing interrupts a creation, an editor session or a purchase, and the app shows no new text.
- Updates are published by hand: `npm run update:preview -- --message "..."` and `npm run update:production -- --message "..."`. Publish to `preview` first and open it on a device. EAS keeps earlier updates, so `eas update:rollback` or republishing the previous update reverts a bad one.

## Consequences

- No update reaches any phone until a build containing `expo-updates` is in the App Store: the current store build has no update client.
- Each new build carries a new fingerprint. Updates published before it do not reach it.
- Store billing, sign-in, push and the editor are all native-dependent. An update that changes how JavaScript calls a native module must ship as a build.
- Not decided here: code signing of updates (`codeSigningCertificate`), and automated publishing from CI, which needs an `EXPO_TOKEN` secret.
