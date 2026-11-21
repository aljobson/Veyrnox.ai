# ADR-0369: Mobile OTA runtime follows the app version

Date: 2026-11-21
Status: Accepted when merged. Supersedes the fingerprint-runtime decision in [ADR-0306](0306-mobile-over-the-air-updates.md) for version 1.0.1 and later.

## Context

ADR-0306 selected Expo's fingerprint runtime policy so a JavaScript update could not reach a build with incompatible native code. Continuous Native Generation now makes that policy unstable in the EAS production build path. EAS CLI calculates the submitted fingerprint before prebuild, while the worker recalculates it after generating `ios/` or `android/`. The generated native directory and local `modules/veyrnox-vision` source changed the worker fingerprint, so two Android production builds failed in `Configure expo-updates` before compilation.

The latest finished iOS store build is Veyrnox.ai 1.0.0 (62). Since that build, the app has added native dependencies and config-plugin behavior, including `react-native-audio-api`. Reusing runtime 1.0.0 would allow incompatible updates to target the older native binary.

Expo currently recommends the `appVersion` runtime policy for production and describes fingerprint policy as experimental.

## Decision

- `runtimeVersion` uses `{ "policy": "appVersion" }` from Veyrnox.ai 1.0.1 onward.
- The first build under this policy advances `expo.version` from 1.0.0 to 1.0.1. The EAS remote build number remains independently auto-incremented.
- Any native compatibility change must increment `expo.version` before a production build. This includes adding, removing or upgrading a native library; changing Expo SDK or React Native; changing a config plugin; or changing app configuration that affects generated native projects.
- Build numbers, simulator build numbers and values under Expo `extra` do not select the runtime. They may change without changing OTA compatibility.
- Production and preview updates remain manually published to their existing EAS channels. A publisher must confirm that the checked-out `expo.version` matches the intended native cohort before publishing.

## Existing 1.0.0 installations

Existing 1.0.0 builds retain their fingerprint runtime. Updates published from current main resolve to runtime 1.0.1 and do not reach those installations. Users must install the 1.0.1 store build to enter the new update cohort.

If an emergency 1.0.0 JavaScript-only hotfix is required before users upgrade, its reference is iOS store build `85beedf0-30cd-4d28-8cf6-94754cb349fe`, Git commit `423b191926499fe3774251c8b5a3f2a338dd5475`, and embedded runtime `9c0ec97f2df8548f002ccdf7a26af81e0fa7d8d4`. It must be published from that exact source and dependency state. Before publishing, run `npx expo-updates runtimeversion:resolve --platform ios` and require the resolved value to equal the recorded runtime. Current main must not be used for that update. The next Android production build also uses app version 1.0.1.

## Consequences

- Local and EAS production runtime resolution is deterministic across CNG prebuild, removing the configuration-stage fingerprint mismatch.
- Native compatibility is protected by a version-bump rule instead of an automatically derived hash. `apps/mobile/scripts/check-native-version-bump.mjs`, enforced by `mobile-ci`, rejects native dependency, plugin, module, native-project or native configuration changes that do not also bump `expo.version`.
- Mobile Dependabot PRs are held for owner review instead of being auto-merged, so the version guard can be satisfied deliberately.
- Version 1.0.0 receives no later current-main OTA updates. Store adoption, rather than OTA, moves those users to the new runtime.
- A JavaScript-only change may keep the same app version and publish an OTA update to that version's channel cohort.
