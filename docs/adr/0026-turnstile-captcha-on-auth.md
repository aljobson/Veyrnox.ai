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

## Amendment 3 (2026-10-09): a check that waits for a click says so

Seen on production on 2026-10-09, signed out, in an embedded browser: the
check failed with 600010 and the dialog said "It will retry by itself". By
then the widget had retried and was showing its checkbox, unticked. The
dialog told the person to wait while the widget waited for the person.
Someone who believes the notice waits for ever.

### What Turnstile reports

Read on 2026-10-09 in Cloudflare's widget configuration reference and
client-side errors page, and in the script the widget loads
(`challenges.cloudflare.com/turnstile/v0/api.js`). This widget is Managed
mode, rendered explicitly, and leaves every option at its default:
`retry: auto`, `retry-interval: 8000`, `refresh-timeout: auto`,
`appearance: always`.

| Callback | When the script calls it |
|---|---|
| `error-callback` | The challenge frame reports a failure. With `retry: auto` and a handler that returns `true`, the script loads the challenge again 2 seconds plus `retry-interval` later: 10 seconds here. |
| `before-interactive-callback` | The challenge frame says it is entering interactive mode: it shows its checkbox and waits for a click. Managed mode only. It is called every time, so also when a retry ends on the checkbox. |
| `after-interactive-callback` | The frame has left interactive mode: the box was ticked, or the wait timed out and the widget is about to refresh itself. |
| `timeout-callback` | The box was not ticked in time. With `refresh-timeout: auto` the widget then refreshes itself. |
| `unsupported-callback` | The frame refuses the browser as unsupported. There is no box to tick. |

So what was seen was `error-callback`, the retry, then
`before-interactive-callback`. The dialog listened to the first and not the
last. A callback does report the wait, so the dialog can say what is true in
each state and needs no wording that hedges between the two.

### Decision

1. `components/Turnstile.jsx` registers `before-interactive-callback` and
   calls a new `onWaiting` prop. It registers nothing else new.
2. `components/AuthGate.jsx` remembers the wait where it remembers the error
   code, as the word `waiting` (`CAPTCHA_WAITING`), so a submit without a
   token says the same thing. A notice about the check that is already on
   screen changes to the new wording. No notice is raised from nothing: a
   first check that asks for a click has not failed, the widget is on screen
   and says what it wants, and an error notice next to it would be noise.
3. The wording is in `app/lib/turnstileFailure.js`: "The security check above
   is waiting for you to tick its box. If it doesn't pass after that, reload
   the page, or open veyrnox.ai in your usual browser if you're inside
   another app. Continue with Google doesn't need the check." It does not
   quote the widget's label. The widget follows the browser's language and
   the dialog is in English, so "Verify you are human" would be the wrong
   words in every other language. The widget has one box and sits directly
   above the notice.
4. It ends the way every notice about the check ends. A token or closing the
   dialog clears it. A new failure replaces it with that failure's wording,
   and the next wait replaces that.

### What the dialog says in each state

For a check that did not pass in this browser (300* and 600*). After any
other failure the second row is the same: if the box is showing, ticking it
is the next step.

| The widget | The dialog |
|---|---|
| has failed and will retry in 10 seconds | "The security check didn't pass in this browser. It will retry by itself. …" (unchanged) |
| shows its checkbox after that failure | "The security check above is waiting for you to tick its box. …" |
| shows its checkbox and has not failed | nothing, until a submit without a token; then the same sentence |
| has issued a token | nothing |

### Not used, and why

- `after-interactive-callback`. Every way out of the wait ends in a token, a
  failure or another wait, and each of those already sets the notice.
  Clearing the notice here would lose it when an unticked box times out and
  the widget refreshes to a box again. The cost is a few seconds in which the
  notice still says to tick the box and there is none to tick: while the
  widget verifies a tick, and when a refresh after a timeout runs without
  asking for one.
- `timeout-callback`. The widget already refreshes itself, and the refreshed
  checkbox reports itself through `before-interactive-callback` again.
- `unsupported-callback`. A different case with no box to tick. The dialog
  still says nothing about it until a submit. Not fixed here.

### What does not change

The check: same site key, same mode, every option still at its default,
automatic retry on, and no request to Auth without a token. A callback is
something the page listens to; it does not change how the check runs. The
CSP is untouched.

The count of failed checks (amendment 2) is untouched: one report per error
code per page load, sent from `error-callback` and from a script that cannot
load, and from nowhere else. A wait is not a failure, so it writes no console
line and sends no report. `waiting` is not a code either: `turnstileErrorCode`
turns it into `unknown`, so it could not be logged or sent as itself.

### What was and was not seen

Seen on a local build on 2026-10-09, with Cloudflare's published test site
keys in place of ours (never committed), and without the checkbox ever being
ticked:

- The key that forces an interactive challenge. The widget showed its
  checkbox and the dialog said nothing. A submit without a token gave the new
  wording, which it can only do if `before-interactive-callback` fired. With
  a notice about the check already on screen, the notice changed to the new
  wording by itself when the checkbox appeared.
- The key that always fails. It fails with 600010, the code seen on
  production. The "retry by itself" notice stayed through the retries, with
  one console line and one report for the page load.
- Our own key on localhost: 110200 and the generic notice, as before.

Not seen before the merge: a failure followed by a retry that stops on the
checkbox, which is what happened on production. No test key does both, and
our site key lists `veyrnox.ai` only.

Seen on production later on 2026-10-09, once this amendment was deployed, in
the embedded browser where the failure was first seen, signed out:

- Left unticked for 10 minutes, the widget stayed on its checkbox and did not
  fail. The dialog said nothing, and no report was sent.
- With the box unticked and no token, "Sign in with a passkey" gave the new
  wording. Before the deploy the same press gave "Complete the security check
  first."
- The owner then ticked the box. Times are seconds since the page loaded.
  The first row is when the failure report was sent. The others are what a
  reading of the page found at that time:

  | Time | The widget | The dialog |
  |---|---|---|
  | 182 s | the tick has failed with 600010 | not read |
  | 194 s | empty space, retrying | "The security check didn't pass in this browser. It will retry by itself. …" |
  | 207 s | back on its unticked checkbox | "The security check above is waiting for you to tick its box. …" |
  | 222 s | the same | the same |

  One report was sent for the page load. Nothing went to Auth and no token
  was issued.

That is one browser and one run. The challenge frame's own code is not
public, so beyond it the behaviour rests on Cloudflare's reference and on the
script, which calls the callback for every `interactiveBegin` message the
frame sends.

## Amendment 4 (2026-10-09): an unsupported browser is told so

Amendment 3 left one case alone. When Turnstile refuses a browser as out of
date or unsupported, the widget shows a state of its own and reports no
error, so the dialog said nothing. A submit then said "Complete the security
check first", which that browser cannot do. This has not been seen on the
site. It is closed because the person it happens to has no way to find out
what is wrong.

### What Turnstile reports

Read on 2026-10-09 in Cloudflare's widget configuration reference, its widget
states and its supported browsers page, and in the script the widget loads.

- `unsupported-callback` is "invoked when a given client/browser is not
  supported by Turnstile". The script calls it when the challenge frame
  rejects the browser with the reason `unsupported_browser`.
- The script calls nothing else then: not `error-callback`, and not
  `before-interactive-callback`. It does not retry.
- Cloudflare lists Internet Explorer as unsupported, and browsers more than
  five years old and embedded or heavily modified browsers as limited.

### Decision

1. `components/Turnstile.jsx` registers `unsupported-callback` and calls a
   new `onUnsupported` prop.
2. `components/AuthGate.jsx` keeps it where it keeps the error code, as the
   word `unsupported` (`CAPTCHA_UNSUPPORTED`), and shows the notice straight
   away by the rule a failure follows: unless the dialog is answering
   something the person just did. This is not the wait of amendment 3. The
   check cannot be passed in this browser, so the dialog says so without
   waiting for a submit.
3. The wording is in `app/lib/turnstileFailure.js`: "The security check can't
   run in this browser: it is out of date or not supported. Update the
   browser, or open veyrnox.ai in a different one. Continue with Google
   doesn't need the check." It does not say to reload and does not say the
   check will retry. Neither is true here.
4. Closing the dialog clears it, like every notice about the check. No token
   can arrive in this state.

### Not counted

The count of failed checks (amendment 2) is a count of Turnstile's error
codes. The route takes 3 to 9 digits or `unknown` and nothing else, and
Turnstile gives this case no code. Counting it would mean the route accepting
a new word, which is a decision of its own. So an unsupported browser sends
no report and writes no console line, and the count runs low by however many
there are. `unsupported` is not a code: `turnstileErrorCode` turns it into
`unknown`, so it could not be logged or sent as itself.

### What does not change

The check: same site key, same mode, every option still at its default, and
no request to Auth without a token. One more callback is listened to. The
CSP is untouched. Amendment 3's wait is untouched.

### What was and was not seen

Not seen: Turnstile refusing a real browser. Three things were tried on a
local build on 2026-10-09 and none produced it:

- A headless browser sending Internet Explorer 11's user agent, with our own
  site key. The hostname check came first: 110200 and the generic notice.
- The same with Cloudflare's test key that always passes. The test key
  ignored the user agent and issued its dummy token.
- No test key refuses a browser.

So that Turnstile calls `unsupported-callback` for such a browser rests on
Cloudflare's reference and on the script. The challenge frame's own code is
not public.

Seen, on a local build with a stand-in for Cloudflare's script that records
the options the widget is given and lets each callback be called by hand:

- The widget passes six options: the site key and five callbacks, the two
  new ones among them.
- `unsupported-callback`: the dialog showed the new wording at once. No
  report was sent.
- "Sign in with a passkey" with no token repeated it, and nothing went to
  Auth. Closing the dialog cleared it, and a reopened dialog said nothing.
- In a new dialog: `error-callback` with 600010 gave "It will retry by
  itself" and one report; `before-interactive-callback` changed it to
  "waiting for you to tick its box"; `unsupported-callback` changed it to the
  new wording; a token cleared it. One report in all.

## Amendment 5 (2026-10-09): unsupported browsers are counted

Amendment 4 left an unsupported browser out of the count of failed checks,
because that count held Turnstile's error codes and this case has none. The
owner decided it belongs there: it is a person stopped at the check, and
that is what the count is for.

1. **The browser reports it.** `components/Turnstile.jsx` calls
   `reportTurnstileFailure` from `unsupported-callback` with the word
   `unsupported` (`CAPTCHA_UNSUPPORTED`). It is the request every report is:
   a same-origin POST whose body is that word and nothing else, without
   cookies or the page address, once per value per page load, five per page
   load at most, and dropped if it cannot be sent.
2. **One rule says what a report may hold, on both sides.**
   `turnstileReportCode` in `app/lib/turnstileFailure.js`: 3 to 9 digits,
   `unknown`, or `unsupported`. The browser sends only what it returns, and
   the route accepts only a body it returns unchanged. `turnstileErrorCode`
   is not changed: what the widget hands to `error-callback` is still cut to
   digits or `unknown`, so the word cannot come from the widget.
3. **The server writes the same line**, with the word in the same field:
   `{ event: 'auth.turnstile_check_failed', code: 'unsupported' }`.
4. **No console line.** That line carries an error code for someone looking
   into a failure. This case has none, and the notice says what happened.

The count gains one row: `unsupported`, Turnstile refused the browser as out
of date or unsupported. What amendment 2 says about the number holds for it:
page loads, not people; anyone can send it; a trend. One thing holds for this
row alone. The real widget has not been seen to refuse a browser (amendment
4), so a zero means either that no such browser came or that Turnstile did
not call the callback. It is not proof of the first.

Unchanged: the rate limit, our own pages only, 16 bytes at most (the word is
11), nothing about the sender read or kept, and a fixed list of bodies, one
word longer. The check, the CSP, the notices and the console line.

Seen on a local build on 2026-10-09 with the stand-in script of amendment 4:
two calls of `unsupported-callback` sent one report, the route answered 204
and wrote the line above, and the notice showed. Sent by hand, the route
refused `unsupportedx`, `Unsupported` and `waiting` with 400, and the word
from another site or with no browser headers with 403.

Seen on production on 2026-10-09, once this amendment was deployed. A GET
answered 405 and a POST with no browser headers 403. Then, on the owner's
word, one test report: the live home page, signed out, the stand-in script,
`unsupported-callback` called once. The route answered 204 and the notice
showed; nothing went to Auth. It was sent at 15:47:06 UTC, so the count holds
one `unsupported` line at that time that is no visitor. The log itself was
not read. Still not seen: Turnstile refusing a real browser.
