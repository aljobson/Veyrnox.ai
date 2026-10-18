# ADR-0106 — Mobile app (iOS and Android, Expo / React Native)

**Status:** Proposed 2026-10-17
**Related:** CLAUDE.md "Identity & sessions" and "API gateway", [ADR-0030](0030-sign-in-with-apple.md), [ADR-0026](0026-turnstile-captcha-on-auth.md), [ADR-0102](0102-browser-refresh-cookie.md)

## Context

The product is web only. The owner wants a mobile app for iOS and Android with every feature. That is months of work, so it ships in slices; each slice is a real, testable app, not a skeleton.

The `/api/v1/*` surface is Bearer-only and already carries everything the core loop needs (`balance`, `chat`, `generations`, `jobs`, `library`, `session/me`), so the app is a client of the existing API. No new server surface is needed for slice M0.

## Decision

1. **Expo (React Native, TypeScript, Expo Router) in `apps/mobile`.** Own `package.json` and `node_modules`; the repo root has no workspaces, so the Cloudflare Workers build never installs it. `metro.config.js` resolves only from `apps/mobile/node_modules` so the Next.js copy of React is never bundled. `ios/` and `android/` are generated (Continuous Native Generation) and git-ignored. Bundle id and Android package: `ai.veyrnox.app`.
2. **Auth is Supabase Auth with the same providers as the web: Apple and Google.**
   - iOS Apple: native `expo-apple-authentication`, identity token exchanged at `/auth/v1/token?grant_type=id_token` with a hashed nonce to Apple and the raw nonce to Supabase.
   - Google, and Apple on Android: system browser session with PKCE (`/auth/v1/authorize`, then `grant_type=pkce`).
   - Refresh token in Keychain / Keystore (`expo-secure-store`); access token in memory only; refresh is single-flight because Supabase rotates refresh tokens. The browser cookie BFF (ADR-0102) is not used; it is for browsers.
   - `redirect_to` is the constant `ai.veyrnox.app://auth/callback`, never user input. The scheme is the bundle id, not `veyrnox://`: the sibling Veyrnox wallet app claims `veyrnox://`, so a redirect on that scheme could be taken by the wrong app (hard wall). This is the one non-web origin we control and amends CLAUDE.md's "origin we control" rule for the app scheme only.
3. **Email and password sign-in, with Turnstile hidden.** Supabase enforces Turnstile on every email path (ADR-0026) and we do not loosen that setting: it keeps the signup grant from being farmed. The app runs the same check in a web view that is invisible unless Cloudflare asks for an interaction (`appearance: interaction-only`), so people see no Cloudflare widget in the normal case. The web view loads with the web origin as its base URL (Turnstile checks the hostname), may navigate only to Cloudflare, and talks to the app by validated `postMessage` only. Tokens are single-use, so the check restarts after every submit. Not yet verified on a real device: in the iOS simulator the check did not complete.
4. **Billing is deliberately out of M0.** Apple and Google require their own in-app purchase for digital credits, so Stripe checkout cannot be used in the app. Credits bought on the web still show in the app. M2 designs store billing (RevenueCat is connected to this workspace) as its own ADR, including how store purchases reach `credit_top_up` and the refund and dispute paths.
5. **Slices.** M0: sign-in (Apple, Google, email), balance. M1: chat with Vey. M2: generation, job status, library. M3: billing. M4+: editor, Cinema, Publish, projects, account. Nothing ships to the stores before M2.

## Owner prerequisites (not visible from the repo)

- Supabase redirect allowlist: no longer required for Google and Apple sign-in (amendment 1). Keep `ai.veyrnox.app://auth/callback` listed if it is already.
- Supabase Apple provider: add `ai.veyrnox.app` to the authorized client IDs, besides the Services ID (native iOS tokens carry the bundle id as audience).
- Apple Developer: App ID `ai.veyrnox.app` with Sign in with Apple; App Store Connect record. Google: Android OAuth client is not needed for the browser flow.
- Confirm the bundle id before the first store build; it cannot change afterwards.

## Verification

M0: typecheck and 13 unit tests (API client retry and session loss, token grants, PKCE helpers). Sign-in against a real Supabase project needs the prerequisites above and is not claimed until done.

## M4: release plumbing (2026-10-17)

- `apps/mobile/eas.json`: `development` (dev client, simulator), `preview` (internal distribution, staging, store billing on) and `production` (auto-incremented remote version, production). Public settings only; keys and the Sentry DSN come from EAS environment variables.
- `.github/workflows/mobile-ci.yml` typechecks, tests and bundles iOS and Android on any change under `apps/mobile/**`. The mobile app is outside the root install, so no other workflow or the Worker build is affected.
- Crash reporting: `@sentry/react-native`, started only in release builds with a DSN. Reports carry no user, no request bodies or headers and no URL query or fragment (an OAuth return URL holds a one-time code); `src/lib/scrub.ts` is unit-tested. The privacy policy and the App Store privacy label and Play data-safety form must say crash data is collected.
- `ITSAppUsesNonExemptEncryption` is `false` (the app uses only the system's HTTPS); the owner confirms that declaration.

**Owner steps before a build exists:** an Expo account and `npx eas-cli init` in `apps/mobile` (writes the project id into `app.json`); Apple Developer team and an App Store Connect API key for `eas submit`; a Google Play service account; a Sentry project with its DSN as `EXPO_PUBLIC_SENTRY_DSN` and an auth token as `SENTRY_AUTH_TOKEN` (EAS secrets); the RevenueCat public SDK keys as `EXPO_PUBLIC_REVENUECAT_IOS_KEY` and `_ANDROID_KEY`.

## Amendment 1 (2026-10-18): OAuth redirects through the site

The staging Supabase project kept falling back to its Site URL for `redirect_to=ai.veyrnox.app://auth/callback`, so Google sign-in ended on the website. The app now sends `redirect_to=<apiBase>/auth/mobile`, an address on the site's own origin that Supabase always allows. `app/auth/mobile/route.js` answers a 302 to the fixed `ai.veyrnox.app://auth/callback`, forwarding only a well-formed PKCE `code` or a short error word; the target is a constant, so it is not an open redirect, and a code is useless without the verifier held in the app. The auth session still ends on the app address, so the rest of the flow is unchanged. `tests/authMobileBridge.test.mjs` and `apps/mobile/__tests__/supabaseAuth.test.ts` pin both halves.
