# ADR-0026 — Cloudflare Turnstile as the CAPTCHA for Supabase Auth

- **Status**: Accepted (2026-09-21)
- **Date**: 2026-09-21
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0013](0013-credit-expiry-policy.md) (Free Credits), migration `0071` (signup grant follows confirmation)

## Context

The signup faucet was closed on 2026-09-21: Confirm email is ON, so
`grant:signup` lands only when a real inbox confirms. That stops the ~$0.75 of
provider spend a throwaway address used to be worth. It does not stop the
confirmation mails themselves. Every POST to `/auth/v1/signup` sends one, the
Cloudflare Email Sending quota starts at 200 a day, and a script can burn it —
after which real users' confirmations bounce. Password sign-in and magic links
have the same shape: unauthenticated, and each one either tests a credential or
sends a mail.

CLAUDE.md already asks for Attack Protection (CAPTCHA) on sign-up. It could not
be switched on, because nothing in `app/`, `components/` or `lib/` sends a
CAPTCHA token. Supabase rejects every gated call without one, so enabling it in
the dashboard as things stood would have locked out every email user.

## Decision

Use **Cloudflare Turnstile**, Supabase's supported provider alongside hCaptcha.
The site is already on Cloudflare, the widget is WCAG 2.2 AA, and in Managed
mode most visitors never see a challenge.

- `components/Turnstile.jsx` renders the widget with explicit rendering, so the
  script never scans React-owned DOM.
- `app/lib/authClient.js` sends the token as `gotrue_meta_security.captcha_token`
  on the three calls Supabase gates: `signInWithPassword`, `signUp`,
  `sendMagicLink`. Refresh, PKCE exchange, OAuth and MFA are not gated.
- `components/AuthGate.jsx` remounts the widget after every attempt. A token is
  single-use and a failed sign-in spends it as surely as a successful one.
- The **site key** is public and committed in `next.config.mjs`, like the anon
  key. The **secret key** goes into the Supabase dashboard only; Supabase does
  the siteverify call, so the Worker never holds it.

### CSP

Turnstile needs `https://challenges.cloudflare.com` in `script-src` and a
`frame-src` naming the same origin — nothing else. The widget talks to
Cloudflare from inside its own frame, so **`connect-src` is unchanged**.

Both additions are conditional on a site key being set. With the key empty the
CSP is byte-for-byte what it was, and the form renders no widget.
`tests/securityHeaders.test.mjs` pins it both ways: no remote script origin and
no `frame-src` without a key; exactly Turnstile's origin with one.

This is the first remote origin in `script-src`. It is Cloudflare's, the same
operator already terminating TLS and serving the site, so it adds no new party
to the trust boundary — but it is a widening, which is why this is an ADR.

## Rollout order — the part that matters

The code must be live **before** the dashboard switch, never after. Supabase
ignores `gotrue_meta_security` while CAPTCHA is off, so shipping the client
first is harmless; enabling CAPTCHA first rejects every email sign-in.

1. Create a Turnstile widget (Cloudflare → Turnstile → Add widget), hostname
   `veyrnox.ai`, mode Managed.
2. Commit the **site key** as `TURNSTILE_SITE_KEY` in `next.config.mjs`. Deploy.
3. Confirm the widget renders on veyrnox.ai and a sign-in still succeeds.
4. Supabase → Authentication → Attack Protection → enable CAPTCHA, provider
   Turnstile, paste the **secret key**.
5. Sign in again with a password. It must succeed; a sign-in without the widget
   (e.g. a raw curl to `/auth/v1/signup`) must now fail.

Rollback from step 4 is the same toggle, off.

## Consequences

- Visitors whose browser or network blocks `challenges.cloudflare.com` cannot
  use email sign-in. The form says so and names the fix; Google sign-in is
  unaffected because OAuth is not gated.
- Local dev uses Cloudflare's test key `1x00000000000000000000AA` (always
  passes). Never commit it: it would put a widget on production that verifies
  nothing, while Supabase — holding the real secret — rejects its tokens.
- The Turnstile secret is a new credential. It lives only in Supabase's
  dashboard; rotate it there.
