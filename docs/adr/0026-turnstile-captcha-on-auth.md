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
  failure happens, and clears it when a token arrives or the dialog closes. A
  submit without a token repeats the reason, and that now includes a blocked
  script. The wording is in `app/lib/turnstileFailure.js`: the check did not
  pass in this browser (300* and 600*), the device clock is wrong (200100),
  the widget could not load (200500, same advice as a blocked script), and
  one sentence for anything else. No code is shown.
- The code is written to the browser console once per failure, and nothing
  else is. The callback returns `true`: Cloudflare treats a non-falsy return as
  handled, and otherwise adds a console warning of its own on every retry.

The check itself is unchanged: same site key, same widget options, automatic
retry left on, and no request to Auth without a token.

Not done here: counting failed checks. A console line in the visitor's browser
tells them and us nothing in aggregate, so how many people are stopped is
still unknown. Amendment 2 does it.

## Amendment 2 (2026-10-09): failed checks are counted

A check that fails in the browser sends nothing to Supabase Auth and nothing
to us. The owner could not tell whether it stops one person a week or fifty a
day. The browser now tells our own server the error code, and the server
writes it to the Worker's log.

### What happens

1. **The browser sends the code.** `components/Turnstile.jsx` calls
   `reportTurnstileFailure` (`app/lib/reportTurnstileFailure.js`) where it
   already writes the console line, and when the widget's script cannot load
   (sent as 200500, the code the dialog already files that under). It is a
   same-origin `fetch`: `POST /api/turnstile-failure`, and the body is the
   code and nothing else. It is sent without cookies (`credentials: 'omit'`)
   and without the page address: the referrer is cut to the site's origin
   (`referrerPolicy: 'origin'`). It is not `no-referrer`, because that policy
   can also blank the `Origin` header, which step 2 needs from a browser too
   old to send `Sec-Fetch-Site`. One report per code per page load, five per
   page load at most. Nothing waits for it, retries it or shows its result: a
   report that cannot be sent is dropped.
2. **A route outside the gate takes it.** The person is not signed in, so it
   cannot live under `/api/v1`. The route takes a POST from our own pages
   (`Sec-Fetch-Site: same-origin`, or an `Origin` that matches the host where
   a browser sends no `Sec-Fetch-Site`), a body of 16 bytes at most, and only
   a body that is 3 to 9 digits or `unknown`: the same rule as
   `turnstileErrorCode`. It answers 204 with no body, and a typed error
   otherwise. It reads no identity header.
3. **`worker.js` rate limits it before the app.** A Workers rate-limit
   binding, `TURNSTILE_REPORT_RATE_LIMITER`: 10 requests per 60 seconds per
   connecting IP, per Cloudflare location. An IPv6 address counts as its /64,
   because one connection holds a whole /64. It is the mechanism of
   [ADR-0039](0039-admin-edge-rate-limit.md) with its own binding and
   namespace, so reports and admin traffic never share a counter. Over the
   limit is a typed 429. A wrong method is a typed 405. A missing or failing
   binding is a typed 503: the report is not counted, and the log says the
   limiter was unavailable.
4. **The server writes one line:** `{ event: 'auth.turnstile_check_failed',
   code }`. It is logged as an object, not as text, because Workers Logs
   indexes an object's keys, so the count can be grouped by `code`.

### What the number is

Reports accepted: one per error code per page load on which the widget
reported a failure or could not load. It is not a count of people.

- It runs low when a content blocker stops the report, the device is offline,
  the tab closes first, or many people behind one address fail in the same
  minute.
- It runs high because a check that fails and then passes on Turnstile's own
  retry is still counted, a reload is a new page load, and a bot that
  Turnstile stops is counted if it ran our page. Anyone can also send a valid
  code to the route. The rate limit holds one connection to 10 a minute. It
  does not hold a sender with many addresses.

So read it as a trend, and by code:

| Code | Meaning |
|---|---|
| `110200` | the site key does not list this hostname (expected on staging and localhost) |
| `200100` | the device clock is wrong |
| `200500` | the widget or its script could not load |
| `300*`, `600*` | the challenge did not pass in this browser |
| `unknown` | the widget gave no usable code |

### What is not kept

Our line holds the event name and the code. It holds no IP address, user
agent, email, token, page address, session or account id, and the route does
not read any of them.

Two things have to be said next to that:

- The connecting IP (the /64 of an IPv6 one) is used once in the Worker, as
  the key of Cloudflare's rate-limit counter. It is not logged or stored by
  us.
- Like every request the Worker serves, the report has Cloudflare's own
  request record in Workers Logs, with the request's metadata and headers.
  This change adds nothing to that record. Sending the report without cookies
  and without the page address means it carries less than a page view does.

### How the owner reads it

Cloudflare dashboard, Workers & Pages, `veyrnox-ai`, Observability. Search for
`auth.turnstile_check_failed` (or filter on the field `event`), show a count,
and group by the field `code`. Workers Logs keeps 7 days on the paid plan, so
that is the longest range. `npx wrangler tail veyrnox-ai` shows the lines as
they arrive.

Staging is a separate Worker (`veyrnox-ai-staging`) with its own log. Its
widget fails with 110200 on every dialog open, because the site key lists
`veyrnox.ai` only, so its count means nothing and never mixes with
production's.

### Why not a database table

A table needs a migration through the owner-approved workflow, a
`SECURITY DEFINER` writer, a retention rule and a screen to read it. It would
also let someone who is not signed in cause database writes. The log answers
the question without any of that. The cost is history: 7 days, not for ever.
If the owner wants a longer history or the number on the admin dashboard,
that is a table and a new decision.

### What does not change

The check: same site key, same widget options, automatic retry on, and no
request to Auth without a token. The CSP: `connect-src 'self'` already allows
a same-origin POST, and `tests/securityHeaders.test.mjs` is untouched. The
dialog: `components/AuthGate.jsx` is not edited, and a report that fails, is
refused or is rate limited is never seen by it.
