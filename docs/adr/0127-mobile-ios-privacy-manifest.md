# ADR-0127 — Mobile: iOS privacy manifest and permission strings

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md), [ADR-0128](0128-mobile-ai-sharing-consent.md), `docs/mobile/M7-STORE-SUBMISSION-CHECKLIST.md` section 6

## Context

Since 2024 Apple rejects an upload whose code uses a "required reason" API without a reason in a privacy manifest, and wants the data the app collects declared. React Native and Expo modules ship their own manifests, but the app itself declares none (`ios.privacyManifests` was absent). The prebuild also added an unused `NSFaceIDUsageDescription` through `expo-secure-store`'s default, although the app stores tokens with no biometric prompt.

## Decisions

1. **`ios.privacyManifests` in `app.json`**, with the keys from the Expo SDK 58 config types:
   - `NSPrivacyTracking: false`, no tracking domains.
   - Required-reason categories Expo and React Native code reaches, with Apple's standard reasons: file timestamp (`C617.1`, `0A2A.1`, `3B52.1`), user defaults (`CA92.1`), system boot time (`35F9.1`), disk space (`E174.1`, `85F4.1`).
   - Collected data, all for app functionality and none for tracking: email address, user id, device id (the push token), purchase history, other user content (prompts and chats), photos or videos and audio data (files the person adds), all linked to the account; crash data (Sentry, account data scrubbed) not linked. This is the list in the store checklist.
2. **Face ID string removed** (`expo-secure-store` `faceIDPermission: false`). The only usage strings left are the two photo-library ones, which say what the app does (read a chosen photo or video; save a finished creation). Camera and microphone stay off.
3. **A unit test pins these facts** so a later change to `app.json` shows up in review.

## Not decided here

- **Android permissions.** `expo-media-library` adds `READ_EXTERNAL_STORAGE`, `WRITE_EXTERNAL_STORAGE`, `READ_MEDIA_VISUAL_USER_SELECTED` and `READ_MEDIA_IMAGES/VIDEO/AUDIO`. The app picks files with the system picker and only saves, so Google Play's photo and video permission policy may ask for a declaration. Narrowing them (`granularPermissions: []`, blocked permissions) is untested on a device, so it is left for the Android pass (owner step O11).
- Whether the manifest wins over the pod manifests on conflicts is checked by the first signed build's privacy report (Xcode: Product, Archive, Generate Privacy Report); not run here.

## Consequences

- No dependency change, but `app.json` is native config: it takes effect on the next native build.
