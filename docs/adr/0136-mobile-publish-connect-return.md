# ADR-0136 — Publish connect return for the mobile app

**Status:** Accepted 2026-10-18
**Related:** [ADR-0061](0061-veyrnox-publish-social-scheduling.md) (Publish connect), [ADR-0106](0106-mobile-app.md) and its amendment 1 (`/auth/mobile`), [ADR-0110](0110-mobile-account-and-safety.md), `docs/mobile/PLAN-2026-10-18.md` section 2C (S4)

## Context

Every Publish connect route builds an https redirect, `/social/connect/callback/<network>`, and the web landing page there calls the matching `/callback` route with the PKCE verifier from its own `sessionStorage`. On a phone the provider's redirect lands in a browser with no session and no verifier, so the app cannot finish a connect.

## Options

**(a) App links claim `/social/connect/callback/*`.** Only the two association files change. Rejected: a universal link or app link is opened by the OS only for a tap, not for a server redirect inside a browser or auth session, so the redirect would still land on the web page. Android also needs signing fingerprints that `lib/mobileAppLinks.js` does not yet hold (the file answers 404 until they are set). It would not work reliably on either platform.

**(b) A mobile return target.** Connect accepts an optional `client: "mobile"`. The provider then redirects to a bridge on our own origin that hands the code to the app's fixed scheme, exactly the pattern `/auth/mobile` already proves for sign-in (an in-app auth session intercepts the scheme redirect). **Chosen.**

## Decision

1. **`client` on connect and callback.** `POST /api/v1/social/accounts/<network>/connect` and `/callback` (instagram, linkedin, twitter, youtube, tiktok, and the extended networks facebook, threads, pinterest, twitch, gmb) take an optional body field `client`: `"web"` (default when absent) or `"mobile"`. Anything else is `400 {error: "invalid_body"}`, checked before OAuth state is consumed. The value only selects one of two constant paths in `lib/social/connectReturn.js`; no part of a redirect comes from user input.
2. **Redirect URI per client.** Web stays `https://<PUBLIC_HOST>/social/connect/callback/<network>`. Mobile is `https://<PUBLIC_HOST>/social/connect/mobile/<network>`. The connect and callback calls of one attempt must send the same `client`, because the provider compares the token request's `redirect_uri` with the authorize one.
3. **Bridge `GET /social/connect/mobile/<network>`** answers a 302 to the constant `ai.veyrnox.app://social/callback` with `network`, `code` and `state` (or `error`). It forwards a `code` (printable ASCII, at most 2048 characters) and our signed `state` only when both are well formed, and a provider error word otherwise (`access_denied` is kept; anything odd becomes `invalid_request`). An unknown network, and Bluesky (no OAuth), give `error=unknown_network`. It reads no identity header, sets `no-store` and `Referrer-Policy: no-referrer`, and is listed in `tests/routesOutsideGate.test.mjs` and CLAUDE.md. The code is useless without the PKCE verifier the app holds and the user's Bearer token; the state is bound to the caller's auth id and network and is single use.
4. **App links are unchanged.** No association path is added.

## What the mobile session must call

1. Generate a PKCE verifier and S256 challenge. `POST /api/v1/social/accounts/<network>/connect` with `{ codeChallenge, client: "mobile" }` and the Bearer token; the response is `{ authorizeUrl }`.
2. Open `authorizeUrl` in an auth session (`openAuthSessionAsync`) that watches for the scheme `ai.veyrnox.app://social/callback`.
3. Read `network`, `code`, `state` (or `error`) from the returned URL. On `error`, stop with a message.
4. `POST /api/v1/social/accounts/<network>/callback` with `{ code, state, codeVerifier, client: "mobile" }` and the Bearer token. The answer is the existing one: `{ ok, account }`, a selection (`selectionId`, `choices`) to finish with `{ selectionId, resourceId, client: "mobile" }`, or a typed error.

## Owner prerequisites (not visible from the repo)

Each provider checks the redirect URI exactly, so for every network the app should offer, add `https://veyrnox.ai/social/connect/mobile/<network>` to the provider app's allowed redirect URIs (staging: its own host), beside the web one. Until a network's URI is registered, a mobile connect for it fails at the provider with a redirect mismatch; web connect is unaffected. Nothing else changes: no flag, no migration, no `wrangler.jsonc` var, no secret.

## Verification

`tests/socialConnectMobileReturn.test.mjs` (bridge: fixed target, forwarded fields, odd input, every OAuth network, closed enum), plus mobile cases in the Twitter connect and callback route tests and the extended connect test. Not verified: a real provider round trip, which needs the redirect URIs above.
