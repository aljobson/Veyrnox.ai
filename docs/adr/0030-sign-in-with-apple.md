# ADR-0030 — Sign in with Apple as a first-time onboarding provider

**Status:** Accepted 2026-09-22, configured and live 2026-09-23
**Related:** CLAUDE.md "Identity & sessions" (signup grant, OAuth `redirect_to`),
[ADR-0004](0004-auth-and-db-bundle.md) (Supabase Auth),
[ADR-0026](0026-turnstile-captcha-on-auth.md) (Turnstile on the email paths)

## Context

`AuthGate` has offered "Continue with Apple" since the OAuth work landed, but
the button has never rendered. It is gated on `external.apple` from
`/auth/v1/settings`, and the live project reports:

```
{"external":{"apple":false,"google":true,...},"mailer_autoconfirm":false}
```

Google goes through exactly the same code — `signInWithOAuth(provider)`,
PKCE verifier in `sessionStorage`, `/auth/callback` exchanging `?code=`. So
nothing in this repo blocks Apple. What is missing sits in two consoles
neither the codebase nor CI can see: an Apple Developer Services ID with the
Supabase callback registered, and the Apple provider filled in on the
Supabase side. This is the same class of invisible drift that
`check-signup-gate` exists to catch.

Enabling it is not a neutral UI change. A new sign-up path is a new path to
`grant:signup` and its 50 credits, so it belongs in an ADR whether or not the
diff that accompanies it is small.

## Decision

1. **Apple is a sign-up provider, on the same footing as Google.** Not
   iOS-only, not sign-in-only for existing accounts. A first-time Apple user
   gets a `public.users` row and the signup grant through the existing
   `auth.users` triggers — no second provisioning path (CLAUDE.md forbids
   one).

2. **The Services ID's registered domain is the Supabase host, not ours.**
   Domain `xdxdzmsztyzbnzeforxx.supabase.co`, Return URL
   `https://xdxdzmsztyzbnzeforxx.supabase.co/auth/v1/callback`. Apple
   verifies the domain that receives the `form_post`, which is Supabase's
   callback and not `veyrnox.ai`. Nothing is served from our `public/` tree
   for this, and no CSP directive changes: the flow is a top-level
   navigation, so `connect-src` is untouched.

3. **The provider stays invisible until it is actually configured.**
   `AuthGate` keeps reading `external.apple` and rendering nothing when it is
   false. A half-finished console leaves users a working Google button rather
   than an Apple button that dead-ends on a Supabase 400.

4. **Apple's button follows Apple's rules.** Its mark, one of its approved
   strings ("Continue with Apple"), and `currentColor` so the dark theme gets
   the white variant and the light theme the black one — both permitted,
   one asset, no second file to keep in sync.

5. **The client secret is a six-month expiring credential and is treated as
   one.** Apple requires the OAuth secret JWT to be regenerated from the
   `.p8` signing key every six months. The `.p8` never enters this repo; it
   lives with the other service credentials.

## Consequences

- **A missed rotation is a silent total outage of Apple sign-in.** Nothing
  here can detect it: the secret is only used at token exchange, so the
  authorize redirect still looks healthy and `/auth/v1/settings` still
  reports `apple: true`. There is no cheap probe equivalent to
  `check-signup-gate`; the control is a calendar reminder and the stored
  `.p8`. Accepted knowingly rather than papered over with a check that
  cannot fail when it should.

- **OAuth sign-up does not pass Turnstile.** ADR-0026's CAPTCHA covers
  `/signup`, `/token?grant_type=password` and `/otp` — not `/authorize`.
  This is already true of Google; Apple widens the same gap rather than
  opening a new one. An Apple ID is a materially higher bar than an email
  address, so the volume risk 0026 was written against does not transfer
  cleanly, but the grant path is genuinely uncaptcha'd and should be read
  that way in any future faucet review.

- **Hidden-email users arrive as `@privaterelay.appleid.com`.** Reaching
  them at all requires registering our sending domain under *Sign in with
  Apple for Email Communication*; without it those relayed addresses bounce.
  Confirmation mail is not the issue — OAuth identities arrive already
  confirmed, so `grant:signup` fires on insert — but every later
  transactional email to those users depends on it.

- **Apple's consent screen names `xdxdzmsztyzbnzeforxx.supabase.co`** until a
  Supabase custom domain is configured. Supabase's own documentation calls
  this a phishing-susceptibility problem. Not blocking, but it is the first
  thing a new user sees and it does not say Veyrnox.

## As configured (2026-09-23)

Apple Developer, team **Veyrnox LTD** (`R54268MWFV`):

| | |
|---|---|
| App ID | `ai.veyrnox.app` — "Veyrnox AI Web", Sign In with Apple as primary |
| Services ID | `ai.veyrnox.web` — the OAuth `client_id` |
| Domain | `xdxdzmsztyzbnzeforxx.supabase.co` |
| Return URL | `https://xdxdzmsztyzbnzeforxx.supabase.co/auth/v1/callback` |
| Signing key | `LP7U6TPVNV` |
| Client secret expires | **2027-03-24** |

None of these are secrets: the Services ID travels in every authorize URL, and
the Team and Key ids ride in the JWT header. The `.p8` is the secret and is not
in this repo, in any environment, or in any chat log.

A fresh App ID was registered rather than reusing `com.veyrnox.app`. That one
belongs to the Veyrnox **wallet** product — a different company behind the hard
wall in CLAUDE.md — and hanging this platform's Apple identities off it would
have bound two businesses' user records together. Apple's Services ID form only
offers App IDs with Sign in with Apple set as primary, so the separation is
visible there too: the wallet App ID never appeared in the list.

Two things worth knowing before anyone repeats this:

- Apple rejects `.` in an identifier's **description** (and `-`, though the
  form only warns about `@ & * ' "`). `Veyrnox.ai Web` was refused with
  "not a valid name for an app id"; the bundle id `ai.veyrnox.app` was always
  fine. The rejection arrives as a modal that then covers the Register button,
  so it reads like a dead button rather than a validation error.
- The domain Apple verifies is the **Supabase** host, not `veyrnox.ai`. Apple
  registers whoever receives the `form_post`. Nothing is served from `public/`
  for this and no CSP directive changed.

## Verified

Checked after the provider was saved:

- `/auth/v1/settings` reports `apple: true`.
- `/auth/v1/authorize?provider=apple` returns 302 to `appleid.apple.com` with
  `client_id=ai.veyrnox.web`, the registered `redirect_uri` and
  `response_mode=form_post`.
- Apple's sign-in page loads and names the Services ID: "Use your Apple Account
  to sign in to 'Veyrnox AI Web Sign In'." That is Apple validating the
  Services ID, the primary grouping and the return URL.
- `veyrnox.ai` renders the Apple button with no deploy — `AuthGate` reads
  `external.apple` at mount.
- The minted client secret verifies against its own key's public half, with
  `alg ES256`, `kid LP7U6TPVNV`, `iss R54268MWFV`, `sub ai.veyrnox.web`,
  `aud https://appleid.apple.com`, and a 183-day life (Apple's cap).

**Not yet proven:** the client secret is only exercised at token exchange,
which needs a real sign-in. Every check above passes without it being used
once. The secret is therefore correct by construction, not by round trip,
until a first Apple sign-up completes and the ledger shows exactly one
`grant:signup` row with `reconcile_free_credits()` returning zero.

## Rollout


Each step was safe on its own; the button appeared only after the last one.
Steps 1-2 are done; step 3 is the outstanding live check above.

1. Apple Developer: App ID with the Sign in with Apple capability
   (Server-to-Server notification endpoint left blank — Supabase does not
   support it), then a Services ID, its Website URLs per decision 2, and a
   signing key. Register the email source.
2. Supabase Auth → Providers → Apple: enable, Client ID = the Services ID,
   Secret = the JWT minted from the `.p8`.
3. Verify a real first-time sign-up end to end: a new `public.users` row, a
   single `grant:signup` ledger row, and `reconcile_free_credits()` clean.
4. Record the secret's expiry date and set the rotation reminder.
