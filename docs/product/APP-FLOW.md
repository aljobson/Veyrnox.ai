# App Flow — Veyrnox.ai

**Status:** Current · 2026-09-21
**Reads with:** [PRD.md](PRD.md), [UI-UX.md](UI-UX.md). Feature flows (e.g.
[face-filters/APP-FLOW.md](../face-filters/APP-FLOW.md)) extend this one.

## 1. Route map

Files live under `app/veyrnox/*`; `next.config.mjs` rewrites them to the root,
so `app/veyrnox/app/create/page.js` is served at `/app/create`. Old
`/veyrnox/*` URLs 308 to the root form. (Consequence: `usePathname()` returns
`/app/create`, never `/veyrnox/app/create`.)

| route | purpose | auth |
|---|---|---|
| `/` | landing | public |
| `/pricing` | Credit Packs and model prices | public |
| `/presets` | curated starting points | public |
| `/legal/{terms,privacy,gdpr,refund}` | legal | public |
| `/app` | **Explore** — model and preset browsing | public, actions need auth |
| `/app/create` | **Studio** — the only place a job is created | required to submit |
| `/app/library` | past generations and their assets | required |
| `/app/credits` | balance, Credit Packs, top-up history | required |
| `/app/admin` | metrics, MFA enrolment | admin |
| `/auth/callback` | OAuth PKCE code exchange | — |
| `/m/*` | mobile prototype; reachable only from its own links | — |

Nav: **Explore** (`/app`) · **Create** · **Library**, plus a live balance pill
and an account menu once signed in.

## 2. Signing in

The sign-in modal (`components/AuthGate.jsx`) is mounted once at the root.
It opens on:
- any `/api/v1/*` 401 — the app dispatches `veyrnox:auth-required`;
- a `?auth=sign_in|sign_up|magic` query on any page (marketing CTAs use it).

```
open modal ─┬─ Google ──► Supabase authorize (PKCE) ──► /auth/callback ──► signed in
            ├─ email + password + Turnstile ──► sign in ──► signed in
            ├─ sign up + Turnstile ──► "check your email" ──► confirm link ──► 50 Free Credits
            └─ magic link + Turnstile ──► "check your email" ──► link ──► signed in
```

- Sign-up never signs you straight in: Confirm email is on. The confirmation
  link lands on the Site URL; the user then signs in.
- The CAPTCHA token is single-use; the widget reissues one after every
  attempt, and a closed modal discards it (#198).
- Sign-out revokes the Supabase session **and** clears `localStorage`.

## 3. Generating

```
Studio: model + prompt ──► cost shown (catalog) ──► Submit
  POST /api/v1/generations {model_id, idempotency_key, inputs}
    validate ─► catalog row (active?) ─► price ─► rate limit (10/60s)
    ─► ledger_debit + jobs row ─► submit to provider ─► {job_id, balance_after}
  poll GET /api/v1/jobs/:id every 2s
provider webhook ─► verify signature ─► webhook_events dedupe ─► copy to R2
  (SHA-256 taken) ─► job_stored ─► STORED
  GET /api/v1/jobs/:id/asset ─► presigned GET (≤15 min) ─► result renders
```

The balance updates immediately from `balance_after`; a
`veyrnox:balance-changed` event refreshes every balance display on the page.

### `?model=` deep links
`/app/create?model=<catalog id>` preselects a model. **An id that is not an
active catalog row silently falls back to the first ungated model.** So any
link naming a model must change in the same PR as a catalog swap that retires
that id — #200 fixed the Nano Banana links that 0075 left pointing at the
retired row.

## 4. Buying Credits

```
/app/credits ─► pick pack ─► accept immediate-supply notice ─► Buy credits
  POST /api/v1/top-ups ─► LemonSqueezy checkout ─► pay
  LemonSqueezy webhook (HMAC over raw body) ─► order re-fetched from API
  ─► webhook_events dedupe ─► credit_top_up ─► balance rises
  /api/v1/top-ups/:id/return shows the result
```

## 5. When things fail

| what fails | user sees | credits |
|---|---|---|
| Not signed in | sign-in modal | none moved |
| Insufficient balance | submit routes to Credits | none moved |
| Rate limited | retry-after | none moved |
| Model inactive / unknown | `model_not_found` | none moved |
| Provider rejects submit | typed error | debit + refund |
| Provider fails after accepting | job `failed` | debit + refund |
| Asset fails to store | job `failed` (sweep) | debit + refund |
| Breached password on sign-up | "appeared in a data breach" | — |
| CAPTCHA blocked by an extension | "security check couldn't load… or sign in with Google" | — |
| Account Frozen (dispute/refund-after-spend) | generation refused | balance held |
