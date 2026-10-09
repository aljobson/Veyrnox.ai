# ADR-0026 — Turnstile CAPTCHA on sign-up and sign-in

**Status:** Accepted 2026-09-21
**Related:** CLAUDE.md "Identity & sessions" (signup gate) and "Web security" (CSP), [ADR-0006](0006-auth-and-db-amendment-eu-residency.md) (Supabase Auth)

## Context

The signup faucet is closed: Confirm email is on and `check-signup-gate`
reports `mailer_autoconfirm: off`, so an unconfirmed address no longer holds
credits. What remains open is volume. Anyone can still POST
`/auth/v1/signup` in a loop, and every call makes Supabase send a
confirmation email through our Cloudflare Email Sending account. That
account starts at 200 emails/day. A bot that never clicks a link costs no
credits, but it can exhaust the quota and lock real users out of confirming,
and a high bounce rate on throwaway addresses damages sending reputation for
`veyrnox.ai`.

Supabase Auth has built-in CAPTCHA (hCaptcha or Cloudflare Turnstile). Once
enabled, GoTrue rejects `/signup`, `/token?grant_type=password` and `/otp`
unless the body carries `gotrue_meta_security.captcha_token`. The frontend
sent no such token, so enabling it in the dashboard first would have broken
every email/password sign-up and sign-in.

## Decision

1. **Provider: Cloudflare Turnstile.** Same Cloudflare account as DNS,
   Workers and Email Sending; no new vendor; free; usually no visible puzzle
   (Managed mode). hCaptcha would add a vendor for nothing.

2. **Widen the CSP by exactly one host, in exactly two directives:**
   `https://challenges.cloudflare.com` in `script-src` and `frame-src`.
   This is Cloudflare's documented requirement and nothing more.
   `connect-src` is **not** widened. `tests/securityHeaders.test.mjs` pins
   this: that host and no other in script-src, frame-src only that host,
   connect-src unchanged.

   `frame-src` is new. Without it frames fall back to `default-src 'self'`
   and the widget iframe is blocked. `frame-ancestors 'none'` is unaffected;
   it controls who may frame us, not what we frame.

3. **The frontend sends the token whenever it has one, and the site key is
   the feature switch.** `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is public (like
   the anon key) and lives in `next.config.mjs` `env`. While it is empty,
   no widget renders and no token is sent, which is exactly today's
   behaviour. GoTrue ignores the token while CAPTCHA is off in the
   dashboard. So every step of the rollout is independently safe:

   | Site key in build | Dashboard CAPTCHA | Result |
   |---|---|---|
   | empty | off | today's behaviour |
   | set | off | widget shown, token sent and ignored — harmless |
   | set | **on** | enforced |
   | empty | **on** | **all email/password auth broken — never do this** |

4. **The secret key never enters the repo.** It is pasted only into the
   Supabase dashboard (Authentication → Attack Protection). Supabase does the
   server-side verification; we add no siteverify call of our own.

5. **Tokens are single-use.** The widget is reset after every submit, pass
   or fail, so a retry never reuses a spent token.

## Rollout

1. Widget `veyrnox.ai auth` created (Managed, hostname `veyrnox.ai`, no
   pre-clearance). Its site key ships in the same change as the code: row
   two of the table, so the deploy is harmless with the dashboard still off.
2. Deploy. Check the widget renders in the sign-in modal and that sign-up
   and sign-in still work.
3. Supabase → Attack Protection → CAPTCHA on, Turnstile, secret key.
4. Sign up and sign in with a real address.

Rollback is the dashboard toggle. Never clear the site key while the toggle
is on (row four of the table).

## Consequences

- One third-party script now runs on every page that mounts `AuthGate`.
  It loads lazily, only when the modal opens.
- Users with aggressive blockers that block `challenges.cloudflare.com`
  cannot sign up or sign in with email. Google sign-in is unaffected (no
  CAPTCHA on the OAuth path).
- `refresh_token` grants are not challenged, so existing sessions keep
  working through the switch.

## Amendment 1 (2026-10-09): a failed check is said and logged

On 2026-10-09 the widget failed in an embedded browser with Cloudflare's
client error 600010. The dialog said nothing until submit, and then only
"Complete the security check first". A check that fails in the browser sends
nothing to Supabase, so it is in no auth log either.

- `components/Turnstile.jsx` passes the error code from Turnstile's
  `error-callback` to a new `onFailure` prop, and still drops the token.
- `components/AuthGate.jsx` shows a notice in its status region when the
  failure happens, and clears it when a token arrives. A submit without a
  token repeats the reason. The wording is in `app/lib/turnstileFailure.js`:
  the check did not pass in this browser (300* and 600*), the device clock is
  wrong (200100), the widget could not load (200500, same advice as a blocked
  script), and one sentence for anything else. No code is shown.
- The code is written to the browser console once per failure, and nothing
  else is. The callback returns `true`: Cloudflare treats a non-falsy return as
  handled, and otherwise adds a console warning of its own on every retry.

The check itself is unchanged: same site key, same widget options, automatic
retry left on, and no request to Auth without a token.

Not done here: counting failed checks. A console line in the visitor's browser
tells them and us nothing in aggregate, so how many people are stopped is
still unknown.
