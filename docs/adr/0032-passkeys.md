# ADR-0032 — Passkeys, hand-rolled against the GoTrue REST API

**Status:** Proposed 2026-09-23
**Related:** [ADR-0030](0030-sign-in-with-apple.md) (Apple), [ADR-0026](0026-turnstile-captcha-on-auth.md)
(Turnstile), CLAUDE.md "Bundler traps" and "HARD WALL vs. the Veyrnox wallet product"

## Context

Veyrnox.ai has three ways in: Google, Apple and email. All three end in a
shared secret or a redirect to somebody else's identity provider. A passkey is
neither — the user proves possession of a private key held by the device or
password manager, and nothing phishable crosses the wire.

A passkey binds to the **account**, not to how the account was created. Someone
who signed up with Google or Apple can register one and afterwards sign in with
the passkey alone. That was the explicit ask: passkeys for Google and Apple
users, not a fourth parallel silo.

Supabase Auth ships passkey support and the project has the switch
(`passkeys_enabled`, currently false). Both REST endpoints already answer on
the live project with `passkey_disabled`, so the surface exists and is
reachable.

## Decision

1. **Hand-rolled against the two-step REST API, not `@supabase/supabase-js`.**
   Supabase documents `supabase.auth.registerPasskey()` from v2.105+, but that
   library is banned from the SSR import graph — it breaks Cloudflare Workers
   Builds, bisected across PRs #25/#27/#38/#40, and is the reason
   `authClient.js` is hand-rolled `fetch` in the first place. The documented
   two-step endpoints (`/auth/v1/passkeys/{registration,authentication}/{options,verify}`)
   do the same work, so passkeys cost **no new dependency**.

2. **The ceremony lives in `app/lib/passkeys.js`, not in `authClient.js`.**
   That file is at the 500-line ceiling. The new file imports the GoTrue
   `post`/`authed` helpers and `adoptSession` rather than re-implementing the
   fetch and error mapping, so there is still one place that talks to GoTrue.

3. **The button needs the project setting AND a capable browser.** It renders
   only when `/auth/v1/settings` reports `passkeys_enabled` *and*
   `window.PublicKeyCredential` exists in a secure context. Same shape as the
   OAuth buttons reading `external.apple`: no deploy needed to turn it on, and
   it is never offered where clicking it could only throw.

4. **Relying Party ID is `veyrnox.ai`.** Origins `https://veyrnox.ai`. This is
   effectively **permanent**: passkeys are cryptographically bound to the RP
   ID, so changing it later makes every enrolled passkey unusable and forces
   every user to re-enrol. Picking the bare apex domain keeps subdomains
   available without a future change.

5. **A dismissed prompt is not an error.** `navigator.credentials` throws
   `NotAllowedError` both when the user cancels and when the ceremony times
   out, and cancelling is by far the commonest outcome. Both resolve to `null`
   and leave the dialog untouched rather than showing a failure.

## The hard wall

`scripts/check-hard-wall.sh` banned the bare term `passkey`, so this work
failed CI on its own vocabulary.

The entry was removed, and only that entry. The reasoning:

- It is not wallet vocabulary. It is the standard WebAuthn term; Apple's own
  sign-in page offers "Sign in with Passkey".
- It was there for the wallet's *"passkey wallet recovery"*, and `wallet` is
  independently banned — so that phrase still trips the wall. Verified by
  putting the phrase in the scanned tree and watching the check fail, then
  removing it and watching it pass.

This is a **narrowing, not a brand convergence**. Every other term stands and
the wall loses no coverage. CLAUDE.md asks for terms to be removed one at a
time with a comment explaining why; the comment is in the script.

## Consequences

- **Upstream calls passkey support experimental** and reserves the right to
  change the API without notice. We are pinned to request and response shapes
  that carry no compatibility promise. If passkey sign-in breaks after a
  Supabase Auth release, that is the first place to look — and it argues for
  keeping passkeys as an additional way in, never the only one.

- **The verify request bodies are inferred.** The options endpoints are
  documented and confirmed live; the field names on the verify calls
  (`challenge_id` + `credential`) are taken from the JS client's
  `{ challengeId, credential }` and the snake_case convention of the rest of
  GoTrue. They cannot be confirmed until the project setting is on. This must
  be exercised against the live endpoint before anyone relies on it.

- **No management UI yet.** `listPasskeys()` and `deletePasskey()` exist in the
  client because revoking a lost device's passkey is a security need rather
  than a nice-to-have, but nothing renders them. Until an account screen does,
  revocation is only possible through the Supabase admin API. This is a real
  gap, named rather than hidden.

- **Passkey sign-in does not pass Turnstile**, for the same reason OAuth does
  not (ADR-0026 covers `/signup`, `/token` and `/otp`). Registration requires
  an existing confirmed account, so it opens no new path to `grant:signup`.

## Rollout

1. Supabase → Authentication → Passkeys: enable, RP display name "Veyrnox",
   RP ID `veyrnox.ai`, origins `https://veyrnox.ai`.
2. Confirm the options endpoints return a `challenge_id` rather than
   `passkey_disabled`, and check the live response shape against
   `decodeOptions`.
3. Register a passkey on a real account, sign out, sign in with it.
4. Then, and only then, treat the verify bodies in decision 1 as confirmed.
