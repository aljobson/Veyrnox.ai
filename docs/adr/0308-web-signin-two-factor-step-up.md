# ADR-0308: Web sign-in two-factor step-up

Status: accepted (2026-10-31; plan independently reviewed and code independently inspected via claudex-loop)
Relates: F-03, MFA-01 through MFA-06, MFA-R1 through MFA-R5; existing GoTrue TOTP enrollment and API AAL enforcement.

## Context

An enrolled web account can sign in at `aal1`, but the web sign-in flow did not
ask for its authenticator code. Consequently `REQUIRE_AAL2_WHEN_ENROLLED` could
not be enabled without stranding enrolled users. The production flag remains
off in this change. This presentation change alone does not enforce MFA on API
requests; the server flag is the enforcement backstop.

## Decision

Mount `MfaSignInStepUp` immediately after `AuthGate` in the root public
`I18nProvider`. Observe session changes and evaluate once on mount. Password,
OAuth, passkey and magic-link sessions use the same gate. Leave `/auth/callback`
to establish its session, then evaluate at the destination, including client
navigation. Reuse the plain-fetch auth client; challenge and verify go directly
to GoTrue, so the future `/api/v1` AAL gate cannot block the step-up itself.

For `aal1`, list TOTP factors and prompt for the first verified factor. An
unenrolled, absent or `aal2` session renders nothing. A factor lookup failure
fails open on presentation and logs a fixed diagnostic without provider data.
A generation counter invalidates delayed factor lookups on session changes,
cancel, completion and cleanup; opening also requires the session still to be
`aal1` (MFA-01). Account identity alone cannot detect an `aal1` to `aal2` change.

The modal accepts six ASCII digits. Verify runs once while busy. Provider error
codes map to public translated copy; unknown errors use a safe fallback. Five
failed attempts disable the field and Verify for this sign-in (MFA-03). There
is no local timed cooldown: cancel signs out, and a fresh sign-in opens a fresh
challenge with a new allowance. The provider rate-limit message describes its
separate rate limit, not a reset of this local five-attempt allowance.

Challenge ownership is separate from lookup generation (MFA-06). A new session,
prompt, cancel, completion or cleanup invalidates old verification failures.
All failure writes, including clearing input, adding an attempt and clearing
busy, require the submitting challenge still to own the prompt. This also
protects a later sign-in to the same account.

Successful verification adopts the `aal2` session and fires the session observer
synchronously before its promise resolves. The observer closes the prompt;
the successful submit handler does nothing (MFA-04). No reload occurs on
success or cancel: reloading would discard unsaved OddlingStudio drafts and
selected File objects (MFA-05).

Close, Escape and Use a different account all call `signOut()`. This is deliberate
(MFA-R5-01): the step-up is a security gate, not a dismissible dialog, so every
abandon path ends the session rather than leaving a lingering `aal1` one — there is
no non-destructive dismiss, and Escape matches the other two. A hard tab-close
can leave an `aal1` session; the gate prompts again on the next load and server
enforcement remains the backstop. The modal has a translated accessible name,
initial/restored focus, a Tab trap, alerts and a polite status region, 44 px
controls (52 px primary action), and no animation. Known low-severity limitation
(MFA-R5-02): during the brief window while a verify is in flight the submit button
is disabled and focus rests on the dialog body, so the Escape/Tab-trap handler is
inert and Tab could reach controls behind the overlay until focus returns on
failure; the background is not `inert`. A later polish pass can hold focus in the
panel (or mark the background `inert`) while busy. All copy is in the public
catalog in English and ten translations. The support address is plain text;
there is no recovery flow or new recovery policy.

## Owner follow-ups before enforcement or broader enrollment

1. After this ships and is verified, and after the read-recovery prerequisite
   below is complete, set `REQUIRE_AAL2_WHEN_ENROLLED` to `"true"` in production
   `wrangler.jsonc`. This change does not edit the flag, middleware or enforcement.
2. There is **no 2FA account-recovery path and no recovery codes**. Decide and
   build a lost-authenticator recovery policy before offering enrollment to
   non-admins. Contacting support does not promise recovery or bypass.
3. **MFA-02 read-recovery prerequisite:** while the flag is off, `aal1` reads
   succeed and need no recovery. With the flag on, page reads during step-up
   can fail with 403 `mfa_required`. Library, editor and gateway ignore
   same-account session changes and do not automatically refetch after `aal2`.
   Before flipping the flag, add state-preserving refetch on `aal1` to `aal2`,
   or a reload gated on verified preservation of workspace state. This change
   deliberately does neither a reload nor edits to those consumers.

## Verification and scope notes

The two new Node suites cover selection/lockout logic, synchronous session
adoption, delayed lookups, stale failures across different and same-account
sign-ins, translated errors, abandonment, callback navigation, focus and
StrictMode cleanup. Run them alongside public/app catalog parity and coverage,
AuthGate lifecycle and account recovery UX suites. Hook mocks do not replace
browser, screen-reader, real GoTrue or production qualification.

ADR 0308 is free in this checkout and its local `origin/main` (latest ADR 0307).
An open-PR connector search for 0308 found no matches; remote file-level
collision checking was unavailable through the shell's GitHub connection.
Recheck the number during integration. Existing public catalogs and generated
product inventory already exceed 500 lines; adding the required adjacent keys
and regenerating source hashes preserves their format and order rather than
restructuring them. All newly authored files stay under 500 lines. The design
criteria document now has eleven state rows despite the
work order referring to nine; report all eleven during review.
