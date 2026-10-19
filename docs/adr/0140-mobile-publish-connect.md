# ADR-0140 — Mobile: connect a social account (M11 slice 4)

**Status:** Proposed 2026-10-19
**Related:** [ADR-0136](0136-mobile-publish-connect-return.md) (the server's mobile return target this calls); [ADR-0106](0106-mobile-app.md) (the app and its sign-in auth session); [ADR-0121](0121-mobile-publish-overview.md) (Accounts)

## Decision

A **Connect an account** screen (`/publish/connect`, reached from Accounts) for the four released networks: YouTube, LinkedIn, X and TikTok. No new server route, flag or dependency. It follows ADR-0136 exactly:

1. Make a PKCE pair on the phone (the existing `createPkce`).
2. `POST /api/v1/social/accounts/<network>/connect` with `{ codeChallenge, client: "mobile" }` returns `{ authorizeUrl }`.
3. Open that link in an in-app authentication session (`openAuthSessionAsync`) watching `ai.veyrnox.app://social/callback`, the same mechanism as sign-in.
4. Read `network`, `code`, `state` (or `error`) from the returned address.
5. `POST /api/v1/social/accounts/<network>/callback` with `{ code, state, codeVerifier, client: "mobile" }`; the answer is `{ ok, account }` or a typed refusal.

## Checks the app makes on its own

- The authorize link must be **https**. Plain `http` is accepted only for `localhost` and only in a development build, so a mock can stand in; anything else (other schemes, other hosts) is refused and never opened.
- The returned address must be exactly the app's return address, for the network that was asked for, and its **state must equal the state in the authorize link** (a local guard against a forged or stale return). The code must be printable and at most 2048 characters. Anything else ends the attempt with "nothing was connected" and the callback is never called.
- The verifier is sent once, in the last call's body. It is never in a URL, never in the first call and never given to the browser.
- A provider error word is reduced to `access_denied` (shown as "nothing was connected", a cancel) or a generic one; provider text is never shown.
- Typed refusals have plain wording: account limit and no YouTube channel (both arrive as `{ ok:false, code }`, which the mapper reads), network not available, expired sign-in, network refused, not configured, rate limited, offline.
- One connect at a time; the other rows are disabled while one runs.

## What this cannot be proved without

**Not proved, and not provable from the repo or a simulator:**
- **A real provider round trip.** The owner must first add `https://veyrnox.ai/social/connect/mobile/<network>` to each provider app's allowed redirect URIs (staging: its own host). Until then a real connect fails at the provider with a redirect mismatch. Web connect is unaffected.
- The server's bridge page (`/social/connect/mobile/<network>`) answering a real redirect into the app's scheme on a real device, over https.
- Android (the same scheme and flow, not run).
- A real post to any network: nothing here posts.

**Proved against the mock server on the simulator:** the whole flow for X (authorize, a stand-in provider page redirecting to the app scheme, the callback with a PKCE verifier the mock checks against the challenge, "connected"); the account-limit refusal for LinkedIn; the provider saying no for TikTok (no callback call, "nothing was connected"). 17 unit tests cover the link and return checks, the ordering and contents of both calls, the verifier never leaking, cancel, forged state, non-https links and every error word.

## Choices that matter

- Connecting adds the account to the person's **own** brand (the server's callback uses the default brand), whichever brand is chosen in Publish. The screen says so.
- Removing an account stays on veyrnox.ai.
- Strings are `connect.*` keys, English only, listed in `docs/mobile/I18N-NEW-KEYS.md`.

## Follow-ups

Register the redirect URIs and try one real connect (the owner); Facebook, Instagram, Pinterest, Threads and the rest once released; a brand-aware connect, if the server's callback ever takes a brand.
