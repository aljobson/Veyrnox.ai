# App Flow — Veyrnox.ai

**Status:** Current · 2026-10-08 (audited against `main` at `42150476`; section 7 amended against `bee1ea4f`; first
written 2026-10-02 at `2da81dc`)
**Reads with:** [PRD.md](PRD.md), [UI-UX.md](UI-UX.md). Feature flows (e.g.
[face-filters/APP-FLOW.md](../face-filters/APP-FLOW.md)) extend this one.
**Diagrams:** [auth-flow](diagrams/auth-flow.html) ·
[job-lifecycle](diagrams/job-lifecycle.html) ·
[system-architecture](diagrams/system-architecture.html).

## 1. Phases of the product

| phase | the user is… | surfaces |
|---|---|---|
| 1. Discover | anonymous, reading prices | `/`, `/pricing`, `/presets`, `/tools`, `/models`, `/guides`, `/app` |
| 2. Join | signing up, confirming email | `AuthGate` modal, confirmation email, `/auth/callback` |
| 3. Create | spending Credits | `/app/create`, `/app/library`, `/app/chat` |
| 4. Pay | topping up | `/app/credits` → Stripe → back |
| 5. Distribute | scheduling posts — **dark in production** | `/app/publish` |
| 6. Manage | security, data, referrals | `/app/account` |
| (7. Watch / publish series) | Cinema viewer or creator — **off in production** | `/social-cinema/*` |
| (8. Video agent) | brief → plan → approve — **off, no price live** | `/app/video-agent` |

## 2. Route map

Files under `app/veyrnox/*` are served at the root by `next.config.mjs`
rewrites (`app/veyrnox/app/create/page.js` → `/app/create`). Old
`/veyrnox/*` URLs 308 to the root; `/cinema` 302s to `/social-cinema`. An
unknown guide or template address answers a real 404
(`lib/unknownStaticPage.js`). `usePathname()` returns the root form. Page auth
is client-side; the API is the authority.

| route | purpose | auth | gate |
|---|---|---|---|
| `/` | landing with the live PriceSlip | public | — |
| `/pricing` | Credit Packs + every model price | public | — |
| `/presets`, `/presets/[id]` | **Templates** gallery (categories, Popular sort) and one template's page with a one-click hand-off to the Studio | public | — |
| `/tools` | models that start from your own file, with prices | public | — |
| `/models`, `/models/[id]` | one page per live catalog model | public | — |
| `/guides`, `/guides/[id]` | five step-by-step guides | public | — |
| `/app` | **Explore** — preset gallery | public | — |
| `/app/create` | **Studio** — the only place a media job is created | to submit | Auto Short: `veyrnox_auto_short=1` |
| `/app/chat` | **LLM Chat** — priced text replies, Personas, Studio skills | signed in | `CHAT_ENABLED` (on); `chat_not_open` otherwise |
| `/app/library` | past generations, 90-day retention | signed in | Clip Editor: `veyrnox_editor=1`; captions: `veyrnox_editor_captions=1` |
| `/app/credits` | balance, packs, usage meters, statement, top-up history | buy needs sign-in | — |
| `/app/account` | 2FA, passkeys, password, sessions, referral panel, data requests | signed in | — |
| `/app/publish`, `/app/publish/calendar`, `/app/publish/analytics` | Veyrnox Publish | signed in | `PUBLISH_ENABLED` (**off in prod**; 503 `publish_not_open`); Free = 1 account; analytics, insights and device uploads each have their own flag; Facebook, Threads, Pinterest, Bluesky, Twitch and Business Profile also need `PUBLISH_EXTENDED_NETWORKS_ENABLED` (off in prod, on in staging) |
| `/app/video-agent` | video agent brief → plan → approve | signed in | `AGENT_VIDEO_ENABLED` (on in production since 2026-10-09); its own tab in the studio nav, no browser switch |
| `/app/projects`, `/app/projects/[id]` | workspaces, project document editor | signed in | `veyrnox_projects=1` + `TENANT_PROJECTS_ENABLED` |
| `/app/admin`, `/app/admin/violations` | ops metrics, content violations | admin + aal2 | Cloudflare Access |
| `/app/admin/cinema`, `…/submissions` | creator and publication review | Cinema admin + fresh MFA | Access + Cinema flags |
| `/social-cinema` (+ `/creator`, `/pass`, `/title/[id]`, `/watch/[id]`) | Cinema | mixed | `CINEMA_*` (off in prod) + `veyrnox_social_cinema=1` (or `true`) |
| `/legal/{terms,privacy,gdpr,refund,aup}` | legal | public | — |
| `/auth/callback` | OAuth PKCE exchange → `/` | — | — |
| `/social/connect/callback/[network]` | Publish OAuth landing; for Facebook, Pinterest and Business Profile it also hosts the Page / board / location chooser | signed in | — |
| `/media/social/[token]` | signed media proxy for TikTok pull | token | — |
| `/design-system` | token and component reference | public, noindex | — |
| `/m/*` | mobile design prototype, sample data | — | not linked |

## 3. Navigation

- **Announcement bar:** a dismissible strip above the marketing nav (today:
  "New: tools for your own images and video, and ready-made templates." →
  `/tools`); the dismissal is remembered per announcement id.
- **Landing nav:** Social Cinema · Explore (`/#explore`) · Models
  (`/#models`) · Templates · Tools · LLM Chat · Pricing · FAQ, plus search,
  theme toggle, auth.
- **Marketing nav** (other public pages): Home · Templates · Tools · LLM Chat
  · Social Cinema · Pricing.
- **App nav:** Explore · Create · LLM Chat · Library (+ Projects when
  previewing); signed in shows a balance + asset-count pill and the account
  menu.
- **Signed out:** "Log in" / "Sign up" open the modal.
- **Account menu:** Social Cinema · Open Studio · Library · Veyrnox Publish
  *(only when Publish is open)* · Credits · Account & security · Sign out
  (confirm → revoke + clear).
- **Footer:** sign-up CTA (`/app?auth=sign_up`), Product (Explore, Models,
  Pricing, Templates, Tools, Guides), model links (`/app/create?model=…`),
  Tools shortcuts, legal, support email.

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
       └─ passkey + Turnstile ─► signed in
```

- Sign-up never signs you straight in (Confirm email is on).
- The Turnstile token is single-use; the widget reissues after each attempt
  and a closed modal discards it.
- Apple and passkey options show in every mode (sign-in, sign-up, magic
  link); live Supabase settings gate starting the action, and a failed
  settings read still permits an attempt. A browser without passkey support
  gets a passkey-specific message.
- A passkey is added and removed on `/app/account`; adding one after a
  password sign-in may ask for an MFA unlock first.
- **Referral capture:** a landing URL with `?ref=<code>` stores the code in
  `localStorage` for three days and tidies the address (it must survive the
  email-confirmation tab). Once the visitor is signed in it is sent once to
  `POST /api/v1/referrals/attach`; an answer from the server is final and
  clears it. The server never says who the referrer is.
- Sign-out revokes the Supabase session **and** clears `localStorage`.

## 5. Create

### Click sequence

1. Enter the Studio from a template, a landing tile, the hero slip (prompt
   carried in `sessionStorage`) or `/app/create?model=<id>&duration=10s`. A
   Library image, a template page or a chat **Studio draft** can also hand off
   a pre-filled prompt.
2. Pick a model (an optional price-tier filter narrows the list) → duration
   (5/10 s) and aspect options come from the catalog capabilities; models that
   take them show a seed and a negative prompt; image models can generate 1–4
   images in one click. Cost updates in amber. 10 s video = 2 × the 5 s price.
   A model with a free allowance shows "0 Credits, free (N left today)" while
   the account has allowance left.
3. Optional upload (or a Library image as the start image) → tick the
   Acceptable Use attestation → `POST /api/v1/uploads` → presigned PUT
   straight to R2.
4. **Generate** → `POST /api/v1/generations {model_id, idempotency_key,
   inputs}`.
5. Server: validate payload + capability registry → catalog row active? →
   gated? (402) → BytePlus from the US? (blocked) → rate limit → if the model
   offers a free allowance and `FREE_ALLOWANCE_ENABLED` is on, try
   `submit_free_job` (0 Credits, no ledger row, job flagged
   `free_allowance`); when none is left it falls through to the normal
   `ledger_debit` + `jobs` row → submit to provider → `{job_id,
   balance_after}`. A refused submit refunds at once (a free job returns the
   allowance instead).
6. Balance updates from `balance_after`; `veyrnox:balance-changed` refreshes
   every balance on the page.
7. Studio polls `GET /api/v1/jobs/:id` every 2 s (gives up after 30
   consecutive failures). `JobWatcher` keeps announcing if the user leaves.
8. Completion: fal / kie / OpenRouter by signed webhook; GrsAI / BytePlus by
   the 5-minute poll; Auto Short and the Clip Editor by step webhooks + sweep.
   Output copied to R2 with a SHA-256 → `STORED`.
9. `GET /api/v1/jobs/:id/asset` → presigned GET (≤ 15 min) → result renders.
   It also appears in the Library (a free job reads FREE, not "0 cr").
   Download on a Library card asks the same route with `?download=1`: the
   same checks and quota, and a link the browser saves under a name made on
   the server (`veyrnox-<first 8 of the job id>.<ext>`).

### `?model=` deep links
An id that is not an active catalog row **silently falls back** to the first
ungated model. Any link naming a model changes in the same PR as a catalog
swap that retires it.

### Job states
`DEBITED → SUBMITTED → SUCCEEDED → STORED`; transient provider errors go
`SUBMITTED → FAILOVER → SUBMITTED` (bounded, ADR-0009); any failure ends
`FAILED → REFUNDED` with the exact debit returned. The Studio shows REFUNDED
only once the refund is recorded. See
[job-lifecycle](diagrams/job-lifecycle.html). Chat replies end `STORED` with
no asset (ADR-0067).

### Library
Merges local history with `GET /api/v1/jobs` (chat jobs are excluded), hydrates
12 at a time, polls running jobs every 3 s. Filter by type, grid or list,
star favourites. **Ask about this** opens a chat with that image attached.
Clip Editor (flag): select clips → `EditSheet` → `POST /generations` with
`clip-edit`; the sheet's **Add captions** switch (behind its own browser
switch) adds the last step and 7 billed units.

## 5a. Chat — `/app/chat`

1. Open from the nav. Empty chat: pick a model (two-level picker, price per
   reply shown), optionally a **Persona** or a **Studio skill** (both only
   fill the draft of a chat that has not started), then type. Options per reply
   show their extra Credits: Thinking, Web search, up to 4 images (upload,
   your own Library images, or a video as a few frames); Deep research appears
   only when a row offers it (off).
2. **Send** → `POST /api/v1/chat/threads/:id/messages`. The Worker checks the
   balance (before any paid search), runs a capped Web search first if chosen,
   then `ledger_debit` (one `jobs` row, `inputs.kind = chat`) and streams the
   reply. It shares the generation attempt limit.
3. **Stop:** before the first character → refund; after text appeared → text
   kept and charged (the work was received). A provider cut-off after partial
   text keeps the text and **refunds**. A quiet timeout counts as cut off.
4. The job ends `STORED` (`chat_complete_turn` writes both messages). A reply
   that was delivered but cannot be stored, for example because the chat was
   deleted meanwhile, is still charged (`chat_settle_unsaved_turn`). A free
   allowance applies only to a plain reply (no Thinking, Web search or images).
5. A skill's final **Open in Studio** card fills the Studio prompt through the
   same hand-off as a template; only the person's press of Generate there
   spends Credits.
6. Pin, rename, delete (deleting deletes), search, folders, star replies,
   per-chat instructions; unsent drafts are kept per chat in the browser.

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

Packs only: the Credits page says "Credit Packs are one-off purchases.
Nothing renews." Credit Subscriptions have routes (`/api/v1/subscriptions/*`)
and a webhook but no page and `SUBSCRIPTIONS_ENABLED` is off, so none of this
is reachable.

**Referral reward (no user action):** a friend's first credited Pack makes a
pending reward; the hourly sweep releases 10% of those Credits to the referrer
14 days later if the Pack was not refunded or disputed (labelled on the credit
statement; reversed as `reverse:referral` if the Pack is refunded or
disputed afterwards).

## 7. Distribute — Veyrnox Publish *(dark in production)*

1. `/app/publish` → **Connect** one of eleven networks (the button reads
   Setup required or Testing not enabled where the deployment is not ready) →
   `POST /api/v1/social/accounts/:net/connect` → provider consent →
   `/social/connect/callback/:net` → `POST …/callback` (tokens encrypted).
   Facebook, Pinterest and Business Profile stop at a chooser (Page, board,
   location; encrypted, single-use, ten-minute selection) before anything is
   stored. Bluesky has no redirect: handle plus a dedicated app password via
   `POST /api/v1/social/accounts/bluesky/connect`. Twitch connects for
   statistics and is not offered in the composer. Free = one connected account.
2. **Compose:** pick one Library asset or upload from the device, write text,
   choose accounts → **Post now** or a time → `POST /api/v1/social/posts`
   (idempotency key). A Studio or Library result can be scheduled directly.
   Weekly **brand drafts** wait for batch approval before anything is queued.
3. Cron claims due targets: Instagram / LinkedIn / X post directly; TikTok
   lands as a **draft in the creator's TikTok inbox** (`delivered`);
   YouTube uploads resumably, one chunk per tick; Facebook, Pinterest and
   Bluesky post one image and finish on the next tick; Threads and Business
   Profile stay in progress until the provider finishes (Business Profile:
   until LIVE). The API refuses a media type or caption length a network
   cannot take before queuing. Where a response may have been lost, the target
   fails with `provider_result_unknown_reconcile_before_retry` instead of
   posting twice.
4. `/app/publish/calendar`: month, week or list view; dragging proposes a new
   time and saves only after confirmation (a changed or busy target refuses
   with a conflict message). `/app/publish/analytics`: per-network metrics
   and posting-time insights (Instagram, YouTube, TikTok; Twitch statistics
   are collected but not yet shown).
5. Status and `last_error` show in the scheduled list. Disconnect →
   `DELETE /api/v1/social/accounts/:id`.

## 8. Manage — `/app/account`

TOTP enrol / verify / remove · add and remove passkeys · change password by
emailed code · sign out other devices or everywhere · **Refer a friend**
(link, copy, count) · data export or deletion by email request.

## 9. Cinema (built, off in production)

Creator: profile → apply → admin approves → draft series/episodes → upload
to Stream (tus) → submit → admin review → published in the catalogue.
Viewer: title page → entitlement (free / unlocked / pass / locked) → unlock
for 6 Credits or buy a Cinema Pass (Stripe subscription) → player with
heartbeat; Pass plays count toward a 3,000-minute monthly ceiling.
Every Cinema API returns 503 `*_not_open` while its flag is off.

## 9a. Video agent (built, off)

Brief (topic or reference URL, aspect) → `POST /api/v1/montage/plan` returns a
plan, the catalog price and a signed 30-minute ticket (no debit) → **Approve**
→ `POST /api/v1/generations` with the ticket (the server refuses a changed
brief, another user's ticket, an expired plan or a moved price before any
debit) → the runner reports progress to `/api/webhook/montage` → the MP4 lands
in the Library. Any failure, timeout, cancel or ceiling hit refunds once.

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
| captions requested while off | `captions_unavailable` | none moved |
| clip with no speech (captions) | step fails, whole edit fails | debit + refund |
| provider rejects submit | typed `provider_*` error | debit + refund (a free job returns the allowance) |
| provider fails after accepting | job failed | debit + refund |
| output fails to store | job failed (sweep) | debit + refund |
| account Frozen | `account_frozen`; top-ups 403 | balance held |
| checkout not configured / failed | `top_ups_not_configured` / `checkout_failed` | none moved |
| chat off | `chat_not_open` | none moved |
| chat Web search fails or times out | `search_timeout` / `search_unavailable` | none moved (search runs before the debit) |
| chat reply cut off by the provider | partial text kept, "No Credits used" | debit + refund |
| Cinema unlock without balance | `insufficient_credits` (402) | none moved |
| Cinema feature off | `*_not_open` (503) | none moved |
| Publish off | `publish_not_open` (503) | none moved |
| Publish target fails | `last_error` on the post target | — |
| breached password on sign-up | "appeared in a data breach" | — |
| CAPTCHA blocked by an extension | "security check couldn't load… or sign in with Google" | — |
| CAPTCHA does not pass in this browser | "security check didn't pass in this browser… Continue with Google doesn't need the check", shown when it fails | — |
| session expired mid-flow | 401 → modal → retry | none moved |
