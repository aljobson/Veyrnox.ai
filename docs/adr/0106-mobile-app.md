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

- Supabase redirect allowlist (production and staging) must include `ai.veyrnox.app://auth/callback`.
- Supabase Apple provider: add `ai.veyrnox.app` to the authorized client IDs, besides the Services ID (native iOS tokens carry the bundle id as audience).
- Apple Developer: App ID `ai.veyrnox.app` with Sign in with Apple; App Store Connect record. Google: Android OAuth client is not needed for the browser flow.
- Confirm the bundle id before the first store build; it cannot change afterwards.

## Verification

M0: typecheck and 13 unit tests (API client retry and session loss, token grants, PKCE helpers). Sign-in against a real Supabase project needs the prerequisites above and is not claimed until done.
