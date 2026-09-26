# ADR-0060 — Whole-site dynamic rendering for nonce CSP

Status: Whole-site implementation selected by the owner on 25 September 2026;
preview validation in PR #322. Production rollout pending authenticated journey
proof. Related issue: #4.

## Decision

Render all HTML dynamically and give each response a cryptographically random
128-bit nonce. Middleware overwrites inbound nonce/CSP headers, passes the policy
to Next's renderer, and emits the same response policy with private/no-store
caching. The root layout forces dynamic rendering, including public, legal,
mobile-prototype and app/auth pages. API JWT verification remains unchanged.
Next's static headers supply a restrictive policy to API responses only, avoiding
a duplicate policy on HTML. The framework asset namespace bypasses page middleware. Other metadata
responses may carry the policy but contain no executable HTML scripts. Script unsafe-inline is removed;
existing host allowlists and style-src remain unchanged.

Public pages share the origin and session storage with the app. App-only nonce
coverage therefore cannot protect the entire session. A scoped preview also
proved that client navigation from a static public page retained its permissive
document policy. Whole-site coverage removes that difference and preserves
normal Next client routing; the temporary full-document app-link workaround is
removed.

## Cost and alternatives

HTML loses static prerendering and shared cache reuse, increasing Worker rendering
and origin-data work. JS, CSS, fonts and other static assets keep their caching.
Measure production render latency, Worker CPU/request usage and origin request
volume during rollout; local preview timings do not establish production cost.
No claim of free performance parity is made.

Keeping public HTML static would require a separately proven hash strategy or
an origin/session architecture change. That work is outside this PR. Partial
app/auth coverage was useful for compatibility testing but does not meet #4's
whole-site objective.

## Implementation and proof

The installed stack is Next 15.5.25 / OpenNext Cloudflare 1.20.2. Next's
[nonce guide](https://nextjs.org/docs/15/app/guides/content-security-policy)
requires dynamic rendering for request nonces. Existing API middleware must be
extended without weakening JWT checks or trusting client identity headers.

Use Node 22/npm 10 with the committed lockfile and `npm run build:worker`.
Start `wrangler dev --local --port 8795`, then run
`node scripts/check-nonce-runtime.mjs`. It checks public/legal/mobile and
app/auth pages plus 404s twice each, requiring fresh nonces, matching executable
inline framework scripts, no script unsafe-inline and private/no-store caching.

The installed local workerd was too old for compatibility date 2026-09-01.
The isolated preview uses workerd 1.20260925.1 via MINIFLARE_WORKERD_PATH; the
production compatibility date and dependency lockfile are unchanged.

Before rollout, require successful Worker build, security/JWT/session regression
tests, real-browser hydration and bidirectional public/app navigation, and a
blocked harmless unapproved inline-script probe. Also verify OAuth return,
Turnstile, authenticated generation controls and Stripe return handling on an
approved host. Local Turnstile returns error 300030, so localhost cannot prove a
successful CAPTCHA or authenticated journey. Do not substitute a local test for
live payment evidence required by #101.

## Rollout and rollback

Keep PR #322 draft until the remaining journey evidence is recorded. After merge,
verify production headers/nonces/cache behavior and monitor hydration/CSP errors,
render latency, Worker usage and origin load. This requires no database migration.
Rollback is a reviewed revert of the nonce/rendering change, restoring the prior
static policy and cache behavior; record that it also restores the previous
script unsafe-inline risk. Do not auto-close #4 from an incomplete preview.

## Whole-site preview results — 25 September 2026

- Production Worker build, hard-wall and all 603 application tests passed;
  one existing opt-in test was skipped. The temporary navigation helper and its
  two tests were removed with the full-document workaround.
- The HTTP probe passed 26 responses across 13 public/legal/mobile/app/auth/error
  paths. All nonces were distinct and matched executable inline scripts;
  script unsafe-inline was absent and every response was private/no-store.
- The first local homepage response took 1369ms and the second 138ms; the other
  samples ranged from 25–96ms. These are diagnostic samples, not production
  capacity or latency claims.
- Browser app → legal → homepage and fresh homepage → app client navigation
  rendered successfully. The harmless unapproved inline-script probe was
  blocked on the fresh homepage and after entering the app. The sign-in modal
  rendered; no console errors were observed during the navigation checks.
- No successful account login, CAPTCHA, OAuth return, authenticated generation
  or Stripe return was performed. Those proof requirements remain outstanding.
