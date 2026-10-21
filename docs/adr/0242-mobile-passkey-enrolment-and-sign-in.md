# ADR-0242: Mobile passkey enrolment and sign-in

Status: Proposed. Phone implementation behind disabled platform flags; S2 device proof pending.

Builds on [ADR-0032](0032-passkeys.md) and [ADR-0204](0204-mobile-passkeys-list-and-remove.md).

## Decision

Use the host-installed `react-native-passkeys` 0.4.2 Expo module for native platform-authenticator
registration and discoverable sign-in. Its JSON options and credentials match GoTrue's WebAuthn
contract without buffer conversions. Expo Modules supports the New Architecture; the package's
peer range permits Expo SDK 58, but actual SDK 58 device compatibility is not yet proved. The classic
bridge `react-native-passkey` alternative depends on legacy interop, and `expo-passkeys` targets an
older SDK. There is no config plugin. A native development rebuild is required; Expo Go and the old
development client cannot load the module. The wrapper loads lazily and treats unavailable support
as false so disabled builds remain usable.

`passkeyGate()` checks `EXPO_PUBLIC_PASSKEYS_IOS_ENABLED === 'true'` on iOS and
`EXPO_PUBLIC_PASSKEYS_ANDROID_ENABLED === 'true'` on Android, plus native support. Both flags default
off and neither is set in eas.json. Android remains off until its own device pass succeeds. The gate
protects the entry points, direct signed-out route, provider action, and enrolment action. A closed
route gate mounts no CAPTCHA and makes no settings or authentication request. Existing list/remove
behaviour is retained.

Registration uses authenticated GoTrue options and verify endpoints, with an optional trimmed name
capped at 64 characters. Sign-in uses a single-use Turnstile token for options and adopts the verified
token response through the existing AuthProvider path, including secure refresh-token storage and
cache identity binding. An explicit `passkeys_enabled: false` settings response stops sign-in; failed
settings reads permit the attempt, matching ADR-0032's amendment. Options and challenge IDs are
validated before the native prompt, and verification credentials use the web encoder's field whitelist.
Native error details are discarded. Cancellation is silent; iOS also reports cancellation when no
credential exists for the RP, so that case is necessarily silent. Existing MfaGate rules still require
TOTP for a verified factor when the adopted session is not aal2.

## Origin analysis and owner decision

Supabase Auth owns passkey verification; relying-party IDs and allowed origins are dashboard settings,
not repo routes. ADR-0032 and its 2026-10-04 amendment record production RP `veyrnox.ai` with only
`https://veyrnox.ai`, and staging RP `veyrnox-ai-staging.al-jobson.workers.dev` with its matching HTTPS
origin. Native iOS reports `https://<rpId>`, but requires an AASA `webcredentials` association. The
current server file provides only `applinks`. The phone declares both production and staging
`webcredentials` associated domains, retaining `applinks:veyrnox.ai`.

Android Credential Manager reports `android:apk-key-hash:<base64url SHA-256 signing-certificate hash>`,
which is absent from the allowed-origin lists. It also needs an assetlinks `get_login_creds` relation;
the existing server code has only `handle_all_urls` and empty fingerprints, returning 404. No Android
manifest change is needed for Credential Manager.

The owner chose a separate server PR and dashboard edits, outside this work order:

- Add `webcredentials: { apps: ["R54268MWFV.ai.veyrnox.app"] }` to AASA.
- Add `delegate_permission/common.get_login_creds` and the Play/upload SHA-256 fingerprints to assetlinks.
- Add the Android `android:apk-key-hash:...` origins to staging and production Supabase Auth Passkeys settings.

Whether the dashboard accepts a non-HTTPS origin remains unknown. If it refuses, Android stays web-only
with its phone gate off. The library's support check is never a substitute for this rollout decision.

## Proof and limits

Unit/render tests cover platform gates, options validation, credential normalisation, native error
classification, cancellation, enrolment list refresh, CAPTCHA consumption, shared session adoption,
and the existing MFA challenge rule. No native build, device run, live GoTrue verification, association
file change, dashboard edit, or Android fingerprint provisioning is performed by this implementation.

After the server work, S2 must use a rebuilt staging development client with the appropriate platform
flag enabled on one iPhone and one Android phone. Enrol, sign out, sign in, and delete the test passkey
from the same card. Setup errors indicate association/configuration investigation; a server refusal on
Android requires checking Auth logs for origin rejection. Do not enable Android shipping builds until
that proof succeeds.
