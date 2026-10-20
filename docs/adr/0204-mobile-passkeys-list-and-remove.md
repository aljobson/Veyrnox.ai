# ADR-0204: Mobile passkeys: list and remove (parity plan P7, slice 7)

**Status:** Proposed 2026-10-20. Builds on ADR-0149.

## Decision

The Account security screen gains a **Passkeys** card that lists the passkeys on the account
(`GET /auth/v1/passkeys`, the web's `listPasskeys`) with name, when it was added and when it was last used, and removes
one after a confirm (`DELETE /auth/v1/passkeys/:id`). A passkey on a lost device is only removable from a signed-in
session, so this is useful before any enrolment exists, and it needs no native module and no dependency.

Adding a passkey and signing in with one are **not built**: they need a native WebAuthn module, the relying-party
association files on our domain and Supabase accepting the app's origin. The card says adding is not available in the
app yet and points to the website. `docs/mobile/PASSKEYS-SPIKE-S2.md` is the harness note: the web contract to match,
the five things the device spike must prove, and the server changes (association files, allowed origin) and the new
dependency that would follow.

## Not proved

Unit tests with mocks (parsing both response shapes, id checks, the calls, error wording); not run against Supabase
Auth, a simulator or a phone. The list fields are those the web page reads.
