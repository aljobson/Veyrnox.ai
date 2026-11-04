# ADR-0026 amendment 7 — Resend pending authentication email

Status: Implemented locally; staging verification pending (2026-11-04)

Relates: [ADR-0026](0026-turnstile-captcha-on-auth.md), frozen signup-resend
work order SHA-256 `20057da353d764d48cf717ddc7f754a5055c297ce1f3e4e0afb1104c3eb4d5d0`.

After signup or a magic-link request, offer resend and address correction.
Each resend requires a fresh Turnstile token. Success or a rate response
starts a 60-second cooldown. Five dispatched resend attempts exhaust the UI
budget, including requests whose response is lost; missing CAPTCHA sends
nothing and consumes no attempt. Changing address or resetting the form starts
a new attempt. No server, database, flag, grant or Auth settings change.

Password signup uses `/auth/v1/resend` with `type: signup`, never `/otp`.
Compatibility evidence (captured 2026-11-04T22:02Z, outside the build sandbox).
The production project's `GET /auth/v1/health` returned
`{"version":"v2.197.0","name":"GoTrue","description":"GoTrue is a user registration and authentication API"}`.
In `supabase/auth` at tag `v2.197.0`, `internal/api/resend.go` has, verbatim:

```go
CodeChallenge       string `json:"code_challenge"`          // line 18
CodeChallengeMethod string `json:"code_challenge_method"`   // line 19
validatePKCEParams(p.CodeChallengeMethod, p.CodeChallenge)   // line 27
flowType := getFlowFromChallenge(params.CodeChallenge)       // line 130
if isPKCEFlow(flowType) {                                    // line 131
    generateFlowState(tx, models.EmailSignup.String(), models.EmailSignup,
        params.CodeChallengeMethod, params.CodeChallenge, &user.ID) // line 132
```

and the file contains no password field and no password write. Not verified:
the staging project's Auth version, and the owner's staging checks below.

Mobile uses the same resend endpoint without PKCE, matching its signup.

Web signup and initial magic-link requests retain their existing writes.
Resends read `veyrnox_pkce_magic_verifier` from localStorage, derive the same
S256 challenge, and never write, remove or refresh the record. The record is
`{ verifier, at }`, expires after 15 minutes, and is consumed by `takeVerifier`
on the callback (after checking the per-tab OAuth sessionStorage slot).
At least five minutes must remain at the read, including exactly five minutes.
Missing, malformed, inaccessible or older records send nothing and return to
the pending flow's editable form with a start-again notice. `keepMagicVerifier`,
`takeVerifier` and callback behavior are unchanged.

The existing single shared slot remains a limitation: a new signup/magic-link
attempt in another tab replaces the slot. Resends cannot overwrite a newer
record or restore a consumed one. Tests compare the complete stored bytes,
including timestamps, through failures, lost responses and reversed responses.
Only the newest emailed link works. GoTrue v2.197.0 replaces the confirmation or
magic-link token whenever it sends another email (`models.CreateOneTimeToken`
deletes the previous token of that type), so after any accepted resend, including
one whose response was lost, the earlier email stops working. Reusing the verifier
keeps the newest link completable; it cannot keep the superseded one valid. The
tests model this: the superseded code is rejected by the server and the newest
completes with the stored verifier.

Known limitations, deferred: (1) `completeOAuthFromCode` deletes the verifier
before the exchange, so opening a superseded link in the same browser burns the
verifier and the newest link then needs a fresh start; deleting only after a
successful exchange would remove this and is a separate change to the callback.
(2) The "email sent" notice does not yet tell people to use the newest email
after an uncertain network result; adding that copy needs all 22 catalogs.

Pending state binds the address and flow. Correction returns web magic-link
users to magic mode without a password, web signup users to signup, and mobile
users to signup with an empty password and a fresh CAPTCHA. The pending state
hides the regular email submit/password controls so they cannot accidentally
start another send; the email remains visible and becomes editable on reset.

The web state hook, the controls and the error copy (`humanAuthError.js`, moved unchanged with its comments and diagnostic log) are separate to keep AuthGate below 500 lines.
Exception: authClient.js was already 651 lines; the frozen plan's public helpers
add 18 net lines there rather than refactoring unrelated session machinery.
Additional localized keys cover address labels, readiness and the required
start-again notice. All eleven locales have matching placeholders; translated
wording still needs native review.

Owner staging checks remain unverified: staging Auth version, resent web link
confirmation/sign-in, original chosen password sign-in afterwards, and mobile
confirmation. No live email was sent by these tests.
