# Passkeys on a native build: harness note for spike S2

Parity plan item S2. **Not built in the app yet.** This note says what is already done and what the spike must prove.

## Already in the app (no native module)

- The Account security screen lists the passkeys on the account (`GET /auth/v1/passkeys`) and removes one
  (`DELETE /auth/v1/passkeys/:id`). A passkey on a lost device is only removable from a signed-in session, so this
  matters before enrolment does.
- `mapAppLink` and the sign-in screens are unchanged.

## What the web does (the contract to match)

`app/lib/passkeys.js`:

- **Enrol (signed in):** `POST` the register-options route with an optional `friendly_name` and the bearer token →
  `{ challenge_id, options }`; run the platform ceremony with `options`; `POST` the verify route with
  `{ challenge_id, credential }`. No captcha: the bearer token is the gate.
- **Sign in (signed out):** `POST` the sign-in options route with `gotrue_meta_security.captcha_token` (Turnstile is
  enforced, ADR-0026) → `{ challenge_id, options }`; run the ceremony (discoverable credential, no email); `POST` the
  verify route → a normal token response, adopted like any other sign-in.
- `decodeOptions` / `encodeCredential` convert the base64url fields to and from `ArrayBuffer`; the mobile module has
  to return the same JSON shape.

## What the spike must prove, on a device

1. A native WebAuthn module (an Expo module or `react-native-passkey`) can create and get a **discoverable**
   credential on iOS and Android for the relying-party id the server uses.
2. **The relying-party id.** The web uses the site's domain. A native app can use it only if the domain publishes the
   app association (`apple-app-site-association` with the `webcredentials` service, and `assetlinks.json` with the
   `delegate_permission/common.get_login_creds` relation). Today `lib/mobileAppLinks.js` publishes `applinks` only.
   **A server change** (and the owner's Apple Team ID and Android fingerprints) is needed, or passkeys stay a
   web-only feature.
3. Supabase accepts the **origin** the native ceremony reports (iOS reports the RP id; Android reports an
   `android:apk-key-hash:` origin). If it rejects it, the allowed-origins setting must change, which is also a server
   change.
4. Sign-in passes the Turnstile check: the sign-in options call needs a captcha token, and the app already gets one for
   email sign-in (`lib/auth/turnstile.ts`).
5. The result of a failed or cancelled ceremony returns the app to where it was (no half-enrolled state; a Supabase
   factor created and abandoned stays unverified and is harmless).

## Harness

A throwaway Expo dev client (not this app's build) with the candidate module, pointed at **staging**, with a test
account: run enrol, then sign out, then sign in with the passkey, on one iPhone and one Android phone. Record: the RP id
used, the origin Supabase saw, any error codes. Delete the test passkeys afterwards from the Account security screen.

## Decision to take after the spike

Ship enrolment and sign-in in the app, or keep passkeys as list-and-remove here and enrol on the web. If shipping:
the server association files and the origin setting come first (a separate, owner-approved server PR), then one app
PR for the module (a new dependency: stop and ask).
