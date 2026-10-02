# App Flow — Veyrnox.ai

**Status:** Current · 2026-10-02 (audited against `main` at `2da81dc`)
**Reads with:** [PRD.md](PRD.md), [UI-UX.md](UI-UX.md). Feature flows (e.g.
[face-filters/APP-FLOW.md](../face-filters/APP-FLOW.md)) extend this one.
**Diagrams:** [auth-flow](diagrams/auth-flow.html) ·
[job-lifecycle](diagrams/job-lifecycle.html) ·
[system-architecture](diagrams/system-architecture.html).

## 1. Phases of the product

| phase | the user is… | surfaces |
|---|---|---|
| 1. Discover | anonymous, reading prices | `/`, `/pricing`, `/presets`, `/app` |
| 2. Join | signing up, confirming email | `AuthGate` modal, confirmation email, `/auth/callback` |
| 3. Create | spending Credits | `/app/create`, `/app/library` |
| 4. Pay | topping up | `/app/credits` → Stripe → back |
| 5. Distribute | scheduling posts | `/app/publish` |
| 6. Manage | security and data | `/app/account` |
| (7. Watch / publish series) | Cinema viewer or creator — **off in production** | `/social-cinema/*` |

## 2. Route map

Files under `app/veyrnox/*` are served at the root by `next.config.mjs`
rewrites (`app/veyrnox/app/create/page.js` → `/app/create`). Old
`/veyrnox/*` URLs 308 to the root; `/cinema` 302s to `/social-cinema`.
`usePathname()` returns the root form. Page auth is client-side; the API is
the authority.

| route | purpose | auth | gate |
|---|---|---|---|
| `/` | landing with the live PriceSlip | public | — |
| `/pricing` | Credit Packs + every model price | public | — |
| `/presets` | preset gallery ("Gallery" in nav) | public | — |
| `/app` | **Explore** — preset gallery | public | — |
| `/app/create` | **Studio** — the only place a job is created | to submit | Auto Short: `veyrnox_auto_short=1` |
| `/app/library` | past generations, 90-day retention | signed in | Clip Editor: `veyrnox_editor=1` |
| `/app/credits` | balance, packs, statement, top-up history | buy needs sign-in | — |
| `/app/account` | 2FA, password, sessions, data requests | signed in | — |
| `/app/publish` | Veyrnox Publish | signed in | none (see ISSUES.md) |
| `/app/projects`, `/app/projects/[id]` | workspaces, project document editor | signed in | `veyrnox_projects=1` + `TENANT_PROJECTS_ENABLED` |
| `/app/admin`, `/app/admin/violations` | ops metrics, content violations | admin + aal2 | Cloudflare Access |
| `/app/admin/cinema`, `…/submissions` | creator and publication review | Cinema admin + fresh MFA | Access + Cinema flags |
| `/social-cinema` (+ `/creator`, `/pass`, `/title/[id]`, `/watch/[id]`) | Cinema | mixed | `CINEMA_*` (off in prod) + `veyrnox_social_cinema=true` |
| `/legal/{terms,privacy,gdpr,refund,aup}` | legal | public | — |
| `/auth/callback` | OAuth PKCE exchange → `/` | — | — |
| `/social/connect/callback/[network]` | Publish OAuth landing | signed in | — |
| `/media/social/[token]` | signed media proxy for TikTok pull | token | — |
| `/design-system` | token and component reference | public, noindex | — |
| `/m/*` | mobile design prototype, sample data | — | not linked |

## 3. Navigation

- **Landing nav:** Social Cinema · Explore (`/#explore`) · Models
  (`/#models`) · Presets · Pricing · FAQ, plus search, theme toggle, auth.
- **Marketing nav** (other public pages): Home · Gallery · Social Cinema ·
  Pricing.
- **App nav:** Explore · Create · Library (+ Projects when previewing);
  signed in shows a balance + asset-count pill and the account menu.
- **Signed out:** "Log in" / "Sign up" open the modal.
- **Account menu:** Social Cinema · Open Studio · Library · Veyrnox Publish
  · Credits · Account & security · Sign out (confirm → revoke + clear).
- **Footer:** sign-up CTA (`/app?auth=sign_up`), model links
  (`/app/create?model=…`), legal, support email.

## 4. Join

The modal (`components/AuthGate.jsx`) is mounted once. It opens on any
`/api/v1/*` 401 (`veyrnox:auth-required` event), on the nav buttons, and on
`?auth=sign_in|sign_up|magic` on any URL.

```
modal ─┬─ Continue with Google / Apple ─► Supabase authorize (PKCE)
       │      ─► /auth/callback ─► code exchange ─► /  (signed in)
       ├─ email + password + Turnstile ─► signed in
       ├─ sign up + Turnstile ─► "Check your email" ─► confirm link
       │      ─► 10 Free Credits granted ─► sign in
       ├─ magic link + Turnstile ─► "Check your email" ─► link ─► signed in
       └─ passkey + Turnstile ─► signed in   (only if enabled; no enrolment UI)
```

- Sign-up never signs you straight in (Confirm email is on).
- The Turnstile token is single-use; the widget reissues after each attempt
  and a closed modal discards it.
- Google/Apple show only when Supabase reports them enabled.
- Sign-out revokes the Supabase session **and** clears `localStorage`.

## 5. Create

### Click sequence

1. Enter the Studio from a preset, a landing tile, the hero slip (prompt
   carried in `sessionStorage`) or `/app/create?model=<id>&duration=10s`.
2. Pick a model → duration (5/10 s) and aspect options come from the
   catalog capabilities; cost updates in amber. 10 s video = 2 × the 5 s
   price.
3. Optional upload → tick the Acceptable Use attestation →
   `POST /api/v1/uploads` → presigned PUT straight to R2.
4. **Generate** → `POST /api/v1/generations {model_id, idempotency_key,
   inputs}`.
5. Server: validate payload + capability registry → catalog row active? →
   gated? (402) → BytePlus from the US? (blocked) → rate limit →
   `ledger_debit` + `jobs` row → submit to provider → `{job_id,
   balance_after}`. A refused submit refunds at once.
6. Balance updates from `balance_after`; `veyrnox:balance-changed` refreshes
   every balance on the page.
7. Studio polls `GET /api/v1/jobs/:id` every 2 s (gives up after 30
   consecutive failures). `JobWatcher` keeps announcing if the user leaves.
8. Completion: fal / kie / OpenRouter by signed webhook; GrsAI / BytePlus by
   the 5-minute poll; Auto Short by step webhooks + sweep. Output copied to
   R2 with a SHA-256 → `STORED`.
9. `GET /api/v1/jobs/:id/asset` → presigned GET (≤ 15 min) → result renders.
   It also appears in the Library.

### `?model=` deep links
An id that is not an active catalog row **silently falls back** to the first
ungated model. Any link naming a model changes in the same PR as a catalog
swap that retires it.

### Job states
`DEBITED → SUBMITTED → SUCCEEDED → STORED`; transient provider errors go
`SUBMITTED → FAILOVER → SUBMITTED` (bounded, ADR-0009); any failure ends
`FAILED → REFUNDED` with the exact debit returned. See
[job-lifecycle](diagrams/job-lifecycle.html).

### Library
Merges local history with `GET /api/v1/jobs`, hydrates 12 at a time, polls
running jobs every 3 s. Clip Editor (flag): select clips → `EditSheet` →
`POST /generations` with `clip-edit`.

## 6. Pay

```
/app/credits ─► pick pack ─► tick supply consent ─► Buy credits
  POST /api/v1/top-ups ─► create_pending_top_up ─► Stripe Checkout session
  ─► top-level redirect to Stripe ─► pay
  ─► back to /app/credits?… ─► POST /api/v1/top-ups/:id/return (records session)
     ─► poll GET /api/v1/top-ups/:id
Stripe webhook checkout.session.completed ─► verify Stripe-Signature
  ─► re-fetch session, check top-up HMAC + livemode ─► webhook_events dedupe
  ─► credit_top_up ─► balance rises
Lost webhook ─► 5-minute cron backfill (ADR-0033)
Refund / dispute webhook ─► apply_top_up_refund / apply_dispute_event
  ─► claw back; may Freeze
```

## 7. Distribute — Veyrnox Publish

1. `/app/publish` → **Connect** a network →
   `POST /api/v1/social/accounts/:net/connect` → provider consent →
   `/social/connect/callback/:net` → `POST …/callback` (tokens encrypted).
2. **Compose:** pick one Library asset, write text, choose accounts and a
   time → `POST /api/v1/social/posts` (idempotency key).
3. Cron claims due targets: Instagram / LinkedIn / X post directly; TikTok
   lands as a **draft in the creator's TikTok inbox** (`delivered`);
   YouTube uploads resumably, one chunk per tick.
4. Status and `last_error` show in the scheduled list. Disconnect →
   `DELETE /api/v1/social/accounts/:id`.

## 8. Manage — `/app/account`

TOTP enrol / verify / remove · change password by emailed code · sign out
other devices or everywhere · data export or deletion by email request.

## 9. Cinema (built, off in production)

Creator: profile → apply → admin approves → draft series/episodes → upload
to Stream (tus) → submit → admin review → published in the catalogue.
Viewer: title page → entitlement (free / unlocked / pass / locked) → unlock
for 6 Credits or buy a Cinema Pass (Stripe subscription) → player with
heartbeat; Pass plays count toward a 3,000-minute monthly ceiling.
Every Cinema API returns 503 `*_not_open` while its flag is off.

## 10. When things fail

| what fails | user sees | Credits |
|---|---|---|
| not signed in | sign-in modal | none moved |
| balance below cost | Generate blocked, top-up prompt | none moved |
| rate limited | retry-after message | none moved |
| model inactive / unknown | `model_not_found` | none moved |
| model gated (Veo 3.1) | `model_gated` (402) | none moved |
| BytePlus model from the US | `model_region_unavailable` | none moved |
| upload without attestation | `consent_required` | none moved |
| upload too large / wrong type | upload error copy | none moved |
| topic refused (Auto Short) | `topic_refused` | none moved |
| provider rejects submit | typed `provider_*` error | debit + refund |
| provider fails after accepting | job failed | debit + refund |
| output fails to store | job failed (sweep) | debit + refund |
| account Frozen | `account_frozen`; top-ups 403 | balance held |
| checkout not configured / failed | `top_ups_not_configured` / `checkout_failed` | none moved |
| Cinema unlock without balance | `insufficient_credits` (402) | none moved |
| Cinema feature off | `*_not_open` (503) | none moved |
| Publish target fails | `last_error` on the post target | — |
| breached password on sign-up | "appeared in a data breach" | — |
| CAPTCHA blocked by an extension | "security check couldn't load… or sign in with Google" | — |
| session expired mid-flow | 401 → modal → retry | none moved |
