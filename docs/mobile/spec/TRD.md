# TRD: Veyrnox.ai mobile app

**Status:** Proposed 2026-10-19, checked against `apps/mobile/package.json`, `app.json`, `eas.json` and `src/` on `main` at `4768d535`.
**Reads with:** [PRD.md](PRD.md), [SCHEMA.md](SCHEMA.md), [../../../CLAUDE.md](../../../CLAUDE.md), `apps/mobile/AGENTS.md`.

The server stack is inherited from the web product and is not repeated here. This document records the client stack and the decisions an agent would otherwise guess at, with what each one rejected.

## 1. Stack (do not re-litigate without an ADR)

| Layer | Choice | Where |
|-------|--------|-------|
| Framework | Expo SDK 58, React Native 0.88, React 19.3, TypeScript | `apps/mobile/package.json` |
| Navigation | Expo Router 58 (file routes in `src/app/`), `typedRoutes` on | `src/app/**` |
| Auth | Supabase Auth through plain `fetch`, Apple (native on iOS), Google and Apple-on-Android through a PKCE browser session | `src/lib/auth/*` |
| Secure storage | `expo-secure-store` (refresh token), memory (access token) | `src/lib/auth/sessionStore.ts` |
| Store billing | RevenueCat SDK (`react-native-purchases`) | `src/billing/BillingProvider.tsx` |
| Media | `expo-video` (playback and HLS), `expo-image`, `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-media-library`, `expo-sharing` | `src/components`, `src/lib/uploads.ts` |
| Push | `expo-notifications`, Expo push service | `src/push/*` |
| Crash reports | `@sentry/react-native`, release builds with a DSN only | `src/lib/crash.ts`, `scrub.ts` |
| Build and release | EAS Build and Submit; profiles `development`, `preview`, `production` | `eas.json` |
| CI | `.github/workflows/mobile-ci.yml`: typecheck, Jest, bundle iOS and Android on any change under `apps/mobile/**` | repo root |
| Tests | Jest unit tests; `dev/mock-server.mjs` for a local fake API | `apps/mobile/__tests__` |

The app has its own `package.json` and `node_modules`. The repo root has no workspaces, so the Cloudflare Workers build never installs it. `metro.config.js` resolves only from `apps/mobile/node_modules`.

Expo changes between SDKs. Before touching an Expo, EAS or React Native API, read the matching versioned docs (`https://docs.expo.dev/versions/v58.0.0/`) and `https://docs.expo.dev/llms.txt`; do not answer from memory. `ios/` and `android/` are generated (Continuous Native Generation); never edit them by hand.

## 2. Decisions and what was rejected

### 2.1 Expo, not a bare React Native app or Flutter
Chosen: Expo with config plugins and EAS. Rejected: bare React Native (more native upkeep for a small team), Flutter (the web is React; two stacks). Consequence: any library with native code needs a development build, not Expo Go.

### 2.2 The app is a client of `/api/v1`, with no backend of its own
Middleware needs only `Authorization: Bearer <Supabase ES256 JWT>`. There is no cookie, Turnstile or Origin requirement on `/api/v1`, and React Native sends no Origin. Server work the app needs is built as separate server PRs (S1 deletion, S2 push, S3 app links, S4 connect return, S10 blocks).

### 2.3 Store billing through RevenueCat; no web checkout
Apple 3.1.1 and Google Play require their own purchase for digital credits. RevenueCat webhooks reach `POST /api/webhook/revenuecat`, which credits through `credit_top_up` and claws back through the existing refund path (ADR-0108). Rejected: direct StoreKit and Play Billing code (two integrations to keep correct), and any Stripe link in the app (policy).

### 2.4 Editing is a server render, not an on-device timeline
Quick edit (trim, join, captions) sends a request and renders on the server (ADR-0134). Rejected: FFmpegKit (retired), Skia video export (beta), and porting the browser editor (it depends on browser decode and encode). A multi-track timeline stays on the web.

### 2.5 Playback with `expo-video` on signed HLS
`cinema/play` mints a 15-minute Cloudflare Stream token; the app plays `.../manifest/video.m3u8` and replays the heartbeat contract against `cinema/play/heartbeat`. Fallback: a web view on the `/iframe` URL (loses native casting). Not proved on a device; see the spike note.

### 2.6 Polling plus push for long jobs
The job screen polls every 3 seconds for up to 10 minutes and stops when it closes; push (off by flag) wakes the person after that. Rejected: a socket per job (server cost and battery for a minutes-long wait).

### 2.7 Cache and offline: stale-while-revalidate, never queue a paid action
`src/lib/cache.ts` and `appCache.ts` hold the balance, Library list and model list per user; an offline banner shows; a paid action refuses to start offline. Rejected: an offline write queue (a queued debit is a surprise charge).

### 2.8 Translations reuse the web's keys
11 locales (`en` plus es, zh, hi, ar, fr, pt, ru, ja, de, ko). `src/lib/i18n/` holds the catalogues and `webKeys.json`; new keys are listed in `I18N-NEW-KEYS.md` for the localization process, never machine-translated in the PR. Arabic needs right-to-left layout.

### 2.9 Auth redirects go through the site
`redirect_to` is `<apiBase>/auth/mobile`, which answers a 302 to the constant `ai.veyrnox.app://auth/callback` (ADR-0106 amendment 1). Publish connect uses `/social/connect/mobile/<network>` to the constant `ai.veyrnox.app://social/callback` (ADR-0136). The scheme is the bundle id, not `veyrnox://`, because the wallet app claims that scheme (hard wall).

## 3. Configuration and flags

| Setting | Effect | Where set |
|---------|--------|-----------|
| `EXPO_PUBLIC_APP_ENV` | `staging` or `production` API base | `eas.json` per profile |
| `EXPO_PUBLIC_STORE_BILLING_ENABLED` | Shows Buy credits and the Publish paywall | `preview` profile `true` |
| `EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED` | Enables the Delete account button | EAS env, per environment |
| `EXPO_PUBLIC_PUSH_ENABLED` | Registers a push token | EAS env |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and the Android key | RevenueCat SDK | EAS secrets |
| `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | Crash reporting and source maps | EAS secrets |

Server flags (`STORE_BILLING_ENABLED`, `PUSH_NOTIFICATIONS_ENABLED`, `ACCOUNT_DELETION_ENABLED`, `CINEMA_VIEWING_ENABLED`) are Worker variables. Production vars are at the Cloudflare text-binding cap, so a new server flag needs a slot freed first. Absent means off. An assistant never flips a flag.

## 4. Security requirements

- Refresh token in Keychain or Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); access token in memory only; refresh is single flight because Supabase rotates refresh tokens.
- `redirect_to` and every deep-link target are constants; the app never accepts a return URL from input.
- The Turnstile web view is restricted to Cloudflare origins. Email sign-in keeps the bot check; it is not loosened.
- Signed asset URLs are short lived and never stored.
- Crash reports carry no user, request bodies, headers or URL query or fragment (`scrub.ts`, unit tested).
- Every list or detail call sends the Bearer token; a 401 triggers one refresh and one retry, then `onSessionLost`.
- No wallet or crypto wording on any screen, in any store listing, or in review notes.

## 5. Performance and reliability budgets

Proposed; not measured.

- Cold start to first interactive screen under 2.5 s on a mid-range phone.
- Cinema feed: one active player; scrolling at 60 fps; the next title poster prefetched.
- Token renewal for a playing title about 3 minutes before expiry with no visible gap in a 20-minute soak.
- Surface `Retry-After` on a 429 (the client does not parse it yet); carrier networks share addresses.

## 6. Testing

- Unit: pure logic (API client, auth, cache, chat parsing, billing, publish, i18n parity) stays covered by Jest; `npm test` and `npm run typecheck` in `apps/mobile` pass before a PR opens.
- Component and flow tests: none yet. Add Maestro or Detox flows for sign-in, create, and result next steps against `dev/mock-server.mjs` (proposed).
- Device: the 16-check pass in `DEVICE-PASS-2026-10-18.md` on a signed `preview` build.
- Accessibility: VoiceOver and TalkBack on sign-in, Create, Account; Larger Text at maximum; 44 pt targets (ADR-0133).

## 7. Constraints that bind every slice

1. One PR per slice; no flag enabled by an assistant; no edits to server, migrations or `wrangler.jsonc` from a mobile PR.
2. Take the next free ADR number after checking open PRs and `main`.
3. One native build environment is kept on this Mac (owner rule, 2026-10-18); do not recreate other Pods or Metro servers.
4. Secrets never enter the repo. The scan covers all branches, so a test fixture that looks like a key blocks every PR.
