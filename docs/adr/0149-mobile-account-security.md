# ADR-0149: Mobile account security (parity plan P7, slice 1)

**Status:** Proposed 2026-10-19. First slice of the account lane; two-factor and the brand kit follow as their own slices.

## Context

The phone's Account screen had notifications, history, referrals, help, safety, legal and delete, but none of the web
Account page's security controls: no way to set a password, end other sessions or see which assistants can reach the
account. The owner decided that every web feature exists on the phone.

## Decision

- Account shows the person's **email and how they signed in** (from `GET /auth/v1/user`; best effort, so a failure shows
  nothing rather than an error), and a row to a new **Account security** screen (`/security`).
- **Set a new password:** `GET /auth/v1/reauthenticate` emails a code, then `PUT /auth/v1/user { password, nonce }`.
  Same rules as the web: 8 to 72 characters, a 6 to 10 digit code.
- **Signed-in devices:** `POST /auth/v1/logout?scope=others` (every session but this one) and `scope=global` (all of them;
  the phone then signs itself out the usual way). Both ask first. The web uses the same two scopes.
- **Connected assistants:** `GET /auth/v1/user/oauth/grants` lists them and
  `DELETE /auth/v1/user/oauth/grants?client_id=` revokes one. This is what the web's `OAuthGrantsPanel` calls
  (`lib/authClient.js`, `listOAuthGrants` and `revokeOAuthGrant`). Only the web client code was read: the consent page
  (`app/veyrnox/oauth/consent`) only answers an authorization request and has no grant list. The response shape is
  tolerated both as a list and as `{ grants }`, and a row without a valid client id is dropped, as the web does.
- The calls go straight to Supabase Auth with the user's access token (refreshed once on a 401), as the web does. To
  allow that, `AuthProvider` now exposes `getAccessToken`. Nothing about sign-in changed.
- Left out on purpose: the web's "Manage billing" row, which opens Stripe. Credits are bought only through the store.

## Not proved

- Run against the real Supabase Auth: only unit-tested with a mocked `fetch`. The grants list shape is the least certain
  part (it is read from the web client, not from a live answer).
- On a phone or simulator (no build was run for this slice), and with VoiceOver or TalkBack.
- A password change for an account that has a second factor needs an `aal2` session; the screen says so
  ("Confirm with your authenticator code first") but the step-up itself arrives with the two-factor slice.
