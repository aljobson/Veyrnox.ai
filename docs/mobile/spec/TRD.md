# TRD: Veyrnox.ai mobile app

**Status:** Source refresh 2026-10-20 against checkout HEAD `df14bedb`; live deployment and device behaviour not verified.

**Evidence boundary:** Source baseline and PR-query evidence are recorded in [README.md](README.md). Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to this checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).
**Reads with:** [PRD.md](PRD.md), [SCHEMA.md](SCHEMA.md), [../../../CLAUDE.md](../../../CLAUDE.md), `apps/mobile/AGENTS.md`.

The server stack is inherited from the web product and is not repeated here. This document records the client stack and the decisions an agent would otherwise guess at, with what each one rejected.

## 1. Stack (do not re-litigate without an ADR)

| Layer | Choice | Where |
|-------|--------|-------|
| Framework | Expo `~58.0.14`, React Native `0.88.0`, React `19.3.0`, TypeScript `~6.0.3` | `apps/mobile/package.json` |
| Navigation | Expo Router `~58.0.23` (file routes in `src/app/`), `typedRoutes` on | `src/app/**` |
| Auth | Supabase Auth through plain `fetch`, Apple (native on iOS), Google and Apple-on-Android through a PKCE browser session | `src/lib/auth/*` |
| Secure storage | `expo-secure-store` (refresh token), memory (access token) | `src/lib/auth/sessionStore.ts` |
| Store billing | RevenueCat SDK (`react-native-purchases` `^10.14.0`) | `src/billing/BillingProvider.tsx` |
| Media | `expo-video` (playback and HLS), `expo-image-manipulator`, `expo-image`, `expo-image-picker`, `expo-document-picker`, `expo-file-system`, `expo-media-library`, `expo-sharing` | `src/components`, `src/lib/uploads.ts` |
| Push | `expo-notifications`, Expo push service | `src/push/*` |
| Crash reports | `@sentry/react-native` `~8.28.0`, release builds with a DSN only | `src/lib/crash.ts`, `scrub.ts` |
| Build and release | EAS Build and Submit; profiles `development`, `preview`, `production` | `eas.json` |
| CI | `.github/workflows/mobile-ci.yml`: registry/locales, typecheck, Jest, iOS/Android bundles; paths include mobile, ADRs and ADR index script | repo root |
| Tests | Jest unit tests; `dev/mock-server.mjs` for a local fake API | `apps/mobile/__tests__` |

The app has its own `package.json` and `node_modules`. The repo root has no workspaces, so the Cloudflare Workers build never installs it. `metro.config.js` resolves only from `apps/mobile/node_modules`.

Expo changes between SDKs. Before touching an Expo, EAS or React Native API, read the matching versioned docs (`https://docs.expo.dev/versions/v58.0.0/`) and `https://docs.expo.dev/llms.txt`; do not answer from memory. `ios/` and `android/` are generated (Continuous Native Generation); never edit them by hand.

## 2. Decisions and what was rejected

### 2.1 Expo, not a bare React Native app or Flutter
Chosen: Expo with config plugins and EAS. Rejected: bare React Native (more native upkeep for a small team), Flutter (the web is React; two stacks). Consequence: any library with native code needs a development build, not Expo Go.

### 2.2 The app is a client of `/api/v1`, with no backend of its own
The phone sends `Authorization: Bearer <Supabase ES256 JWT>`; `middleware.js` verifies ES256/JWKS and claims (`lib/supabaseJwt.js`). Native clients may omit Origin; browser origins must match configuration (`packages/security/context.js`). There is no cookie or Turnstile requirement on this gateway. Supabase Auth calls go directly to `/auth/v1` at the configured Supabase origin; public preview reads and signed-media fetches also bypass the authenticated gateway. Server work the app needs is built as separate server PRs (S1 deletion, S2 push, S3 app links, S4 connect return, S10 blocks).

### 2.3 Store billing through RevenueCat; no web checkout
Apple 3.1.1 and Google Play require their own purchase for digital credits. RevenueCat webhooks reach `POST /api/webhook/revenuecat`, which credits through `credit_top_up` and claws back through the existing refund path (ADR-0108). Rejected: direct StoreKit and Play Billing code (two integrations to keep correct), and any Stripe link in the app (policy).

### 2.4 Editing: open decision, a spike first
The owner requires the full web editor on the phone (2026-10-19). The web editor decodes, composites and exports in the browser (WebCodecs, canvas, workers), and its own ADR calls Safari preview-only with no real-device export evidence. Options: (A) the web editor in a web view, (B) a native timeline with a new server renderer, (C) a native shell for bin, Library, generation, stems, brand, review and credits with the web engine in a web view for preview and export. Owner-selected approach: C, conditional on Spike S1 in [../PARITY-2026-10-19.md](../PARITY-2026-10-19.md). The S1 harness exists at `src/app/(app)/dev-s1-editor.tsx` with `react-native-webview` `14.0.1`; export on a real iPhone remains blocked/unproved. Until then quick edit (trim, join, captions, sound; ADR-0134/0157) stays. Rejected for now: FFmpegKit (retired), Skia video export (beta). Any web-view route needs a sign-in bridge and must drop the editor's Stripe credits dialog (store-only rule).

### 2.5 Playback with `expo-video` on signed HLS
`cinema/play` mints a 15-minute Cloudflare Stream token; the app plays `.../manifest/video.m3u8` and replays the heartbeat contract against `cinema/play/heartbeat`. Fallback: a web view on the `/iframe` URL (loses native casting). Not proved on a device; see the spike note.

### 2.6 Polling plus push for long jobs
Job status polling runs while the job screen is active; exact polling timing is **not verified** in this refresh. Push registration/delivery is independently gated (section 3) and is not a guarantee of completion notification. Rejected: a socket per job (server cost and battery for a minutes-long wait).

### 2.7 Cache and offline: stale-while-revalidate, never queue a paid action
`src/lib/cache.ts` and `appCache.ts` hold per-user balance/Library, favourites, Create draft and imported Film Studio text; the catalogue policy is public rather than per-user; an offline banner shows; a paid action refuses to start offline. Oddlings passports and the builder draft instead use install-scoped document storage, outside `appCache`; account isolation and cleanup are unresolved (SCHEMA section 2). Rejected: an offline write queue (a queued debit is a surprise charge).

### 2.8 Translations reuse the web's keys
11 locales (`en` plus es, zh, hi, ar, fr, pt, ru, ja, de, ko). English is split by area under `src/lib/i18n/messages/en/`; `apps/mobile/scripts/gen-en-registry.mjs` generates `en.ts`. Do not edit the frozen `_order.ts`. `src/lib/i18n/` holds the catalogues and `webKeys.json`; new keys go to the localization process through the ignored `I18N-NEW-KEYS.md` report, generated with `cd apps/mobile && node scripts/sync-web-i18n.mjs`. Do not commit the report or machine-translate new strings in the PR. Arabic needs right-to-left layout.

### 2.9 Auth redirects go through the site
`redirect_to` is `<apiBase>/auth/mobile`, which answers a 302 to the constant `ai.veyrnox.app://auth/callback` (ADR-0106 amendment 1). Publish connect uses `/social/connect/mobile/<network>` to the constant `ai.veyrnox.app://social/callback` (ADR-0136). The scheme is the bundle id, not `veyrnox://`, because the wallet app claims that scheme (hard wall).

## 3. Configuration and flags

All server values below were read from **`wrangler.jsonc` at the pinned checkout revision**: top-level `vars` is production; `env.staging.vars` is staging and does not inherit production. Cinema effective states were checked against **`lib/cinema/features.js`**. This is checked-in configuration, not a claim that a deployment has received it. Live flags, remote EAS settings, secrets and migration application are **not verified**. `FLAG-PLAN-2026-10-19.md` is historical planning, not a source of current flag values.

| App setting | Checked-in value / effect | Source |
|-------------|---------------------------|--------|
| `EXPO_PUBLIC_APP_ENV` | development/preview: staging; production: production | `apps/mobile/eas.json`, resolved by `src/lib/config.ts` |
| `EXPO_PUBLIC_STORE_BILLING_ENABLED` | preview `true`; other profiles omit it, client default off | `apps/mobile/eas.json`, `src/billing/BillingProvider.tsx` |
| `EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED` | Omitted from all profiles; client default off | `apps/mobile/eas.json`, `src/lib/accountDeletion.ts` |
| `EXPO_PUBLIC_PUSH_ENABLED` | Omitted from all profiles; client default off | `apps/mobile/eas.json`, `src/lib/push.ts` |
| `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` | Runtime SDK keys; external provisioning **not verified** | `src/billing/BillingProvider.tsx` |
| `EXPO_PUBLIC_SENTRY_DSN`, `SENTRY_AUTH_TOKEN` | DSN/source-map setup; external provisioning **not verified** | `src/lib/crash.ts`, `apps/mobile/eas.json` |

| Worker setting | Production `vars` | Staging `env.staging.vars` |
|----------------|-------------------|----------------------------|
| `STORE_BILLING_ENABLED`, `STORE_BILLING_ALLOW_SANDBOX` | Absent/off | `true` |
| `PUSH_NOTIFICATIONS_ENABLED` | Absent/off | `true` |
| `ACCOUNT_DELETION_ENABLED` | Absent/off | Absent/off |
| `PUBLISH_UPLOADS_ENABLED`, `PROJECT_MEDIA_UPLOADS_ENABLED` | `false` | `true` |
| `CINEMA_ENABLED` | `true` | `true` |
| `CINEMA_UPLOAD_RECOVERY_ENABLED`, `CINEMA_UPLOAD_REMOVAL_ENABLED` | `true` | `true` |
| `CINEMA_PROXY_UPLOADS_ENABLED` | Absent/off | Absent/off |

The table's direct flags come from `wrangler.jsonc`; absent/off describes exact-`true` gates, not provider readiness. `lib/cinema/features.js` handles the packed flags below: a separate flag overrides its packed key; malformed/unknown/oversize JSON fails closed, absent keys are off, and dependent capabilities require profiles/viewing/content or subscriptions as appropriate. The master `CINEMA_ENABLED` gates them all.

| `CINEMA_RUNTIME_FLAGS` keys | Production effective value | Staging effective value |
|-----------------------------|----------------------------|-------------------------|
| `creators`, `content`, `profiles`, `uploads`, `freeCeiling`, `publishing`, `viewing` | On | On |
| `subscriptions`, `unlocks` | Explicit `false` / off | On |
| `voting`, `audience`, `rankings`, `retention`, `creatorAnalytics`, `comments`, `storyPolls` | Absent / off | On |
| `watchProgress` (override `CINEMA_WATCH_PROGRESS_ENABLED`) | Absent / off | Absent / off |
| `monetisation`, `ppv`, `premieres`, `recommendations` | Absent / off | Absent / off |

Sources: the two `CINEMA_RUNTIME_FLAGS` objects in `wrangler.jsonc` and the name mapping/dependency rules in `lib/cinema/features.js`. Grouping is already implemented (ADR-0145); the dated plan's “pending consolidation” is obsolete. An enabled creator-upload capability does not prove a native phone uploader or scanner readiness.

`PUBLISH_RUNTIME_FLAGS` in both source environments enables `multiAccount`, `plans`, `inbox`, `inboxWorkflows`, `smartlinks`, `contentPresets`, `queues`, `approvals`, `teams`, `variants`, `reports`, `scheduledReports`, `reportExports`, `reportDelivery`, `customerApi`, `customerWebhooks`, `ads`, `commerce`, `rssAutolists`, `automation`; `videoDestinations` is explicitly false. These are configured switches, not proof of provider approval or complete phone UI. No assistant flips flags as part of this spec refresh. Binding headroom in the live Worker is **not verified**; the historical “every new flag needs a freed slot” assertion must be checked before a rollout.

Face Filters catalogue activation is migration state, not a Worker flag: #1439 merged `packages/db/schema/supabase/0357_activate_face_filters.sql`, activating A1, A2, A4, A5. A3 relight remains inactive; A6–A8 are absent. Production application is **not verified from the repo**. The dedicated phone surface (#1453) and related docs (#1446) are in review.

## 4. Security requirements

- Refresh token in Keychain or Keystore (`AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`); access token in memory only; refresh is single flight because Supabase rotates refresh tokens.
- `redirect_to` and every deep-link target are constants; the app never accepts a return URL from input.
- The Turnstile web view is restricted to Cloudflare origins. Email sign-in keeps the bot check; it is not loosened.
- Signed asset URLs must remain short lived. Cache policies and consumers require expiry checks; absence of every persisted signed URL is **not verified** by this source refresh.
- Crash reports carry no user, request bodies, headers or URL query or fragment (`scrub.ts`, unit tested).
- Authenticated list/detail calls send the Bearer token; anonymous preview uses public reads; a 401 triggers one refresh and one retry, then `onSessionLost`.
- No wallet or crypto wording on any screen, in any store listing, or in review notes.

## 5. Performance and reliability budgets

Proposed; not measured.

- Cold start to first interactive screen under 2.5 s on a mid-range phone.
- Cinema feed: one active player; scrolling at 60 fps; the next title poster prefetched.
- Token renewal for a playing title about 3 minutes before expiry with no visible gap in a 20-minute soak.
- `src/lib/api.ts` now parses `Retry-After`; consistent visible countdown/retry treatment across screens is **not verified**. Carrier networks share addresses.

## 6. Testing

- Unit: pure logic (API client, auth, cache, chat parsing, billing, publish, i18n parity) stays covered by Jest; `npm test` and `npm run typecheck` in `apps/mobile` pass before a PR opens.
- Automated native end-to-end coverage is **not verified**. Add Maestro or Detox flows for sign-in, create, and result next steps against `dev/mock-server.mjs` (proposed).
- Device: the 16-check pass in `DEVICE-PASS-2026-10-18.md` on a signed `preview` build.
- Accessibility: VoiceOver and TalkBack on sign-in, Create, Account; Larger Text at maximum; 44 pt targets (ADR-0133).

## 7. Constraints that bind every slice

1. One PR per slice; no flag enabled by an assistant; no edits to server, migrations or `wrangler.jsonc` from a mobile PR.
2. Take the next free ADR number after checking open PRs and `main`.
3. One native build environment is kept on this Mac (owner rule, 2026-10-18); do not recreate other Pods or Metro servers.
4. Secrets never enter the repo. The scan covers all branches, so a test fixture that looks like a key blocks every PR.
