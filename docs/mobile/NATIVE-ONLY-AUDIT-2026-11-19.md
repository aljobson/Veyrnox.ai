# Native-only audit — apps/mobile (2026-11-19)

Owner rule (2026-11-19): everything on the phone app is native. This audit lists every web view and every web or
external link-out in `apps/mobile/src`, what it is for, what replaces it, and what the replacement costs. It was built
by reading the code on `main` at `e6c4bcd2e`; nothing here has run on a device.

Sizes: **S** under a day, **M** a few days, **L** a project of its own. "Rebuild" means a new store build is needed
because a native module or native config changes (a JavaScript-only change ships over the air).

## A. Web views (historical inventory; current imports are pinned by `noWebBreakout.test.ts`)

| # | File | What it is for | Native replacement exists? | What it would take | Unavoidable? | Stage |
|---|---|---|---|---|---|---|
| A1 | `app/(app)/editor/[projectId].tsx` (legacy `Editor` branch), `components/editor/EngineView.tsx`, `lib/editorStubEngine.ts`, `lib/editorSession.ts` | The first editor: a stub engine page inside a web view. | **Yes**: `components/editor/FullEditorScreen.tsx` (native timeline). Every EAS profile (`development`, `preview`, `production`) sets `EXPO_PUBLIC_FULL_EDITOR_ENABLED=true`, so the web view branch only runs where `EDITOR_ENABLED` is on and `FULL_EDITOR_ENABLED` is off (local jest/dev). | **S**: route to `FullEditorScreen` whenever the editor is enabled; delete the legacy branch, `EngineView`, the stub engine, the legacy session reducer and their tests. No native change, no rebuild. | No | **1** |
| A3 | `auth/TurnstileView.tsx` (used by `app/email.tsx`, `app/passkey.tsx`) | Cloudflare Turnstile CAPTCHA on sign-up and sign-in. | None: Turnstile has no native SDK. | — | **Yes** (bot check is a web challenge) | 4: keep |
| A4 | `components/cinema/YouTubeEmbed.tsx` (used by `app/editorial/[id].tsx`) | Plays a YouTube video inside the app (Cinema editorial). | No native YouTube player exists; every RN library wraps the same IFrame in a web view. Opening the YouTube app is a link-out, which is worse. | Only by dropping YouTube playback. | **Yes** (YouTube policy requires its embedded player) | Owner call |
| A5 | `components/WobnimoView.tsx` (used by `components/VeyCharacter.tsx`) | The Wobnimo mascot, drawn by a canvas engine in a locked-down web view. | No. `@shopify/react-native-skia` 2.14.0 is already installed. | **M**: port the drawing to Skia (no new native module, no rebuild); keep reduce-motion behaviour. | No | 2 |
| A6 | `components/oddlings/OddlingFigure.tsx` (used by `oddlings/build.tsx`) | Figure preview while building an Oddling. | No. Skia installed. | **M**, with A7 sharing one Skia puppet renderer. | No | 2 |
| A7 | `components/oddlings/OddlingPortrait.tsx` (used by `oddlings/[id].tsx`) | Moving preview over the still portrait (`lib/oddlingsPuppet.ts`). | No. Skia installed; stills already render natively through `expo-image`. | **M**; reuse A6 renderer. | No | 2 |
| A8 | `components/liveEdit/LiveCameraView.tsx` | Live camera frames fed to the face models (Photo Studio). | No (needs a native camera frame pipeline). | **L**: camera frame processor plus an on-device face model. Likely a **new native dependency and rebuild** (decided in its own plan). | No | 3 |
| A9 | `components/liveEdit/VisionBridge.tsx` (also `templates/SwapVisionHost.tsx`) | Face landmarks via a WASM model inside a web view. | No. | **L**, same project as A8 (native face-landmark model). Rebuild. | No | 3 |
| A10 | `components/liveEdit/Wig3dBridge.tsx` | three.js renders a 3D wig overlay in a hidden web view. | Partial: Skia could draw 2D overlays; 3D needs a native 3D path. | **L**, same project (Skia or expo-gl). Possible rebuild. | No | 3 |

## B. Link-outs (`Linking.openURL`, `WebBrowser.*`)

Guard: `__tests__/noWebBreakout.test.ts` lists every external call with a reason, and fails on any new or unused entry.
Its entries for the two stems screens are removed in stage 1.

| # | File | Call | What it is for | Native replacement? | Size / rebuild | Unavoidable? | Stage |
|---|---|---|---|---|---|---|---|
| B1 | `app/(app)/music/stems.tsx` | `openURL(archive.url)` | "Get ZIP": opens a 15-minute private link to the stems ZIP in the browser. | **Yes**: `expo-file-system` `File.downloadFileAsync` to cache, then `expo-sharing` (the pattern in `lib/output.ts`). Both installed, so **no rebuild**. | **S** | No | **1** |
| B2 | `app/(app)/music/target-stems.tsx` | `openURL(asset.url)` ×2 (isolated, residual) | Same, for one audio file. | **Yes**, same path as B1. | **S** | No | **1** |
| B3 | `auth/AuthProvider.tsx` (3 calls: `openAuthSessionAsync`, `maybeCompleteAuthSession`, result handling) | Google and Apple sign-in through the system authentication session, PKCE, fixed return `ai.veyrnox.app://auth/callback`. | Apple has a native sign-in module, Google a native SDK, but both are new native dependencies and Apple review prefers the system session. | M each, rebuild. | **Yes by decision** (stage 4) | 4: keep |
| B4 | `app/(app)/publish/connect.tsx` | `openAuthSessionAsync` | Connecting TikTok, YouTube and other social accounts (OAuth). The provider's own sign-in is the product. | No | — | **Yes** | 4: keep |
| B5 | `app/(app)/oauth-consent.tsx` | `openURL(target)` | Hands the OAuth consent result back to the requesting app. | No | — | **Yes** | 4: keep |
| B6 | `app/(app)/account.tsx` | `openURL(managementURL)`; `openURL(mailto:…)`; `openSettings()` | Store subscription management; contact support in the mail app; this app's page in phone Settings. | The mail and Settings calls are native system hand-offs, not web. Store management cannot be reproduced (Apple and Google own it). | — | **Yes** | 4: keep |
| B7 | `app/(app)/credits.tsx` | `openBrowserAsync(billing.managementURL)` | "Manage" the store subscription. | No (Apple and Google own the page). Could use `openURL` to open the store app, not the in-app browser; no gain. | **S** if the owner wants it | **Yes** | Owner call |
| B8 | `help.tsx`, `about.tsx`, `privacy-export.tsx`, `templates/SwapAttemptStatus.tsx`, `cinema/creator/UploadPanel.tsx` | `openURL(mailto:…)` | Write to support, legal or privacy in the mail app. | Native hand-off to the Mail app; no web page. | — | **Yes** (a system mail intent is native) | keep |
| B9 | `components/account/MfaCard.tsx` | `openURL(otpauth://…)` | Opens the authenticator app for TOTP enrolment. | Native hand-off between apps; gated by `isTotpUri`. | — | **Yes** | keep |
| B10 | `components/legal/LegalDocumentView.tsx` | `openURL(target.href)` | Only `mailto:` addresses inside legal text are tappable; other addresses are inert. | Same as B8. | — | **Yes** | keep |

Not found: no screen opens a `veyrnox.ai` web page as a feature. `lib/cinemaBrowse.ts` `WEB_ORIGIN` is only the base
URL of the YouTube embed document (A4). Credits are purchased only through the stores (roadmap decision 4, `PARITY-2026-10-19.md`).

## C. Stage map

| Stage | Scope | Size | Native module / rebuild |
|---|---|---|---|
| 1 | A1 legacy editor web view removed (route to native editor); B1, B2 stems save/share natively | S | None, JavaScript only. Ships over the air. |
| 2 | A5–A7 Wobnimo and Oddlings through Skia | M | None expected (Skia installed). |
| 3 | A8–A10 Photo Studio (camera, vision, 3D wig) as its own project | L | Likely a camera frame and ML dependency: rebuild. |
| 4 | Keep A3, B3–B6, B8–B10 as system flows (guard test documents each) | — | — |
| Owner calls | A4 YouTube playback; B7 in-app browser vs store hand-off | S | None |
