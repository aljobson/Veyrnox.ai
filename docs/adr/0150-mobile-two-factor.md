# ADR-0150: Mobile two-factor sign-in (parity plan P7, slice 2)

**Status:** Proposed 2026-10-19. Builds on ADR-0149 (stacked on its branch).

## Context

The web lets a person turn on an authenticator-app factor (`MfaPanel.js`) and Supabase then issues an `aal2` token only
after the code. The phone could not enrol, would sign a person with a factor in at `aal1`, and could not remove one.
A mistake here can lock someone out, so the rules below lean toward always leaving a way back.

## Decision

- **Calls** (Supabase Auth, as `app/lib/authClient.js`): `POST /auth/v1/factors` (enrol, `factor_type: totp`),
  `POST /auth/v1/factors/:id/challenge` then `POST .../verify { challenge_id, code }` (finish enrolment, step up, or
  sign-in challenge), `DELETE /auth/v1/factors/:id` (remove). Verify answers with a new token pair; the app adopts it
  (`AuthProvider.adoptSession`) because the old token stays `aal1`.
- **Security screen** gains a Two-factor card: off → Set up (setup key as selectable text and "Open my authenticator
  app" using the `otpauth://totp/` address; code; Turn on); on and the session is `aal1` → enter a code to unlock;
  on and `aal2` → Turn off, with a confirm. Removal is never offered below `aal2` (the server also refuses it).
- **Challenge at sign-in:** `MfaGate` wraps the signed-in stack. It reads the profile and the token's `aal`; if a
  *verified* factor exists and the session is not `aal2` (an unreadable level counts as not satisfied) it shows a
  six-digit code screen instead of the app. Sign-in screens are unchanged. The gate never blocks on an unfinished
  enrolment (only `verified` factors count), and Sign out is always on screen, so a lost authenticator never traps the
  person on this step (they can still use the web's recovery or support).
- **Fail open on a failed check:** if the profile cannot be read within 4 s (offline, server error) the app opens. The
  gate is a prompt, not the boundary: the server still demands `aal2` where it matters (admin). Failing closed would
  lock people out of an app they can otherwise use on a bad connection.
- A refresh keeps the session's `aal`, so a returning launch is not asked again until the session itself ends.

## Not built

- **QR code.** There is no QR or SVG library in the app and this lane may not add a dependency. The setup key and the
  open-in-app link cover the same job on the phone that holds the authenticator; showing a QR for scanning from another
  device needs `react-native-svg` plus a QR encoder.
- Recovery codes (Supabase TOTP has none; the web has none either).

## Not proved

- Against real Supabase Auth, a simulator or a phone: unit tests with a mocked `fetch` only, and the screens and the gate
  have no component tests (the app has no render test tooling). The pure decision, every state, and every call are
  tested.
- Whether `PUT /auth/v1/user` (password change) asks for the second factor on an `aal2`-less session: the error text
  covers it; the unlock card is the way through.
- VoiceOver and TalkBack.
