# Issues to fix — 2026-10-02 audit

**Scope:** found while rewriting the six product documents against `main` at
`2da81dc`. Every item names its evidence. "Verify" means the repo shows the
defect but production may differ (hand-applied data, unapplied migrations).
**Nothing here has been filed as a GitHub issue yet.** File them under the
`needs-triage` label (see `docs/agents/triage-labels.md`) once the owner has
read this list.

Severity: **critical** = money or data at risk now · **high** = wrong
behaviour a user can hit · **medium** = latent defect or guard missing ·
**low** = hygiene.

## 1. Schema and money spine

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| S1 | **critical** — fixed by 0167, pending production apply | The three new Credit Packs (270/$19, 1,200/$59, 3,000/$129) cannot be bought on a schema built from migrations: 0121 inserts them with no `variant_id`, and `create_pending_top_up` still requires `p.variant_id IS NOT NULL`; `top_ups.variant_id` is `NOT NULL`. `POST /api/v1/top-ups` gets `PACK_NOT_FOUND` → 404. | `supabase/0121_monthly_credit_parity.sql:29`, `supabase/0059_chargeback_freeze.sql:268`, `0041:63`, `app/api/v1/top-ups/route.js:107` | New migration: drop the variant requirement (Stripe uses inline `price_data`), make `top_ups.variant_id` nullable. Add an acceptance test buying `web-270`. Check production: `select id, variant_id from credit_packs where active`. |
| S2 | **high** — fixed by 0168, pending production apply | Disconnecting a social account does not stop publishing. `disconnect_social_account` sets `status='revoked'` but keeps both encrypted tokens and leaves pending targets; `claim_due_social_post_targets` joins accounts without `status='active'` and returns the tokens. | `supabase/0154_social_publish_foundation.sql:258`, `supabase/0161_social_publish_async_engine.sql:57-86` | Filter `a.status='active'` in the claim; fail/cancel pending targets and null the tokens on disconnect (relax the `NOT NULL`). |
| S3 | **high** — fixed by 0168, pending production apply | Social completion has no claim guard. `complete_social_post_target` / `report_social_post_progress` update any matching target regardless of state, so a worker that lost its claim after the 15-minute takeover can overwrite a published result or flip it back to pending → duplicate post. | `supabase/0161…:101, 138` | Add a `claim_key`; require `publish_status='publishing' AND claim_key = p_key`; make terminal states final. |
| S4 | medium (verify intent) | Legacy (non-proxy) Cinema uploads moved to `deleting` are never claimed after 0164 restricted removal to `server_mediated` rows — the Stream asset is never deleted and creator capacity never released. | `supabase/0164_cinema_proxy_transfers.sql:62,69`, `0139:103` | Allow removal of `server_mediated = false` rows. |
| S5 | medium | 0070's default-privilege revoke does not remove Postgres's built-in `EXECUTE` to `PUBLIC`, and without `FOR ROLE` only covers the migrating role. Safety rests entirely on each migration's explicit `REVOKE … FROM PUBLIC`. | `supabase/0070…:64-65` | `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public, private REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;` and correct the comment. |
| S6 | medium | Ledger idempotency for refunds, signup grants and Cinema unlocks rests on locked probes, not unique indexes. | `supabase/0037:274`, `0127:19`, `0142` (`cinema_unlocks.ledger_entry_id` not unique) | Partial UNIQUE on `ledger_entries(job_id)` for refunds, `(user_id) WHERE reason='grant:signup'`; UNIQUE `cinema_unlocks.ledger_entry_id`. |
| S7 | medium (verify) | A published title by a restricted/banned creator can still be unlocked (and charged) by id: `cinema_unlock_price` checks PUBLISHED + PUBLIC but not creator status, while the list/read functions do. | `supabase/0142:146,279` | Add the creator-status check to `cinema_unlock_price`. |
| S8 | medium | `project_assets` grants `INSERT, UPDATE` directly to `service_role`, breaking the RPC-only-writer rule. | `supabase/0141:54` | Revoke; route through definers. |
| S9 | medium | `top_up_flagged_orders` is described as append-only but has no guard trigger. | `supabase/0054`, `0131` | Add `BEFORE UPDATE OR DELETE` trigger. |
| S10 | medium | Tenant tables are a browser-facing PostgREST surface (SELECT + invoker RPCs granted to `authenticated`) — a deliberate departure from "browser never talks to Postgres" that CLAUDE.md does not mention. | `supabase/0135:5,112` | Record it in CLAUDE.md; confirm `private` is not in PostgREST `db-schemas`. |
| S11 | low | `social_account_actions.actor_id` is `ON DELETE SET NULL` on an append-only table — deleting the user fails. | `supabase/0154:59` | Use RESTRICT. |
| S12 | low | Missing indexes on FK/lookup columns: `social_post_targets.account_id`, `social_posts.created_by_user_id`, `social_post_media.source_job_id`, `cinema_pass_events.pass_id`, `cinema_pass_plays.user_id`, `cinema_unlocks.ledger_entry_id`, `cinema_moderation_actions.content_id`, `cinema_passes.plan_id`, `lower(users.email)`. | schema audit | One index migration. |
| S13 | low | Append-only triggers are row-level; `TRUNCATE` is not blocked on the ledger or any log. | all append-only tables | `BEFORE TRUNCATE` statement triggers. |
| S14 | low | Dead/legacy: `users.plan` unused; `users_auth_id_idx` duplicates the UNIQUE index; LemonSqueezy-only `credit_packs_net_floor`, `top_up_order_collisions.order_id` numeric CHECK, `record_top_up_return`, order-sweep functions. | `0001:24,28`, `0068:58,209` | Retire in one cleanup migration. |
| S15 | low | `list_public_cinema_titles_page` uses `<=` when only `p_before` is given, so a row can repeat across pages. | `supabase/0163` | Use `<` or require the id tiebreak. |
| S16 | low | ~~`report_social_post_progress` accepts a NULL `next_check_at`, stranding a `submitted` row~~ (fixed by 0168); `consume_youtube_upload_quota` uses server-timezone `current_date`. | `supabase/0161` | Guard NULL; use `(now() AT TIME ZONE 'America/Los_Angeles')::date` (YouTube's quota day). |
| S17 | low | `supabase/README.md` gap table is stale (lists 0033–0034, omits 0076, 0118, 0119, 0151, 0158). | `packages/db/schema/supabase/README.md` | Update. |

## 2. Product and behaviour

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| P1 | **high** — fixed: `PUBLISH_ENABLED` off in prod + Free cap (0169) | **Veyrnox Publish is live in production with no flag and no plan.** It is in the account menu, unlimited and free, though ADR-0062/0063 set Free = 1 account and app reviews are not done. | `app/veyrnox/app/publish/page.js`, `NavAuthButtons.js`, no `publish_plan` code | Gate behind a server flag until the plan ships, or enforce the Free 1-account cap now. |
| P2 | **high** | YouTube resumable upload cannot complete (no `Authorization` on continuation PUTs). Fix is in open PR #399, failing CI. | PR #399 | Rebase on #401, merge. |
| P3 | medium | `/app/credits` says "No subscription." while ADR-0064 is accepted and Cinema Pass is a subscription. | `app/veyrnox/app/credits/page.js:136` | Update copy when subscriptions ship; today say "Credit Packs are one-off". |
| P4 | medium | Passkey sign-in button can appear but there is no enrolment UI, so no user can have a passkey. | `app/lib/passkeys.js` (`registerPasskey` unused), ADR-0032 | Ship enrolment on `/app/account` or hide the button. |
| P5 | medium | Cinema Pass cannot be tested end to end: `CINEMA_SUBSCRIPTIONS_ENABLED` is unset even on staging. | `wrangler.jsonc` `env.staging` | Turn on in staging with Stripe test keys. |
| P6 | medium | Staging has no provider, payment or R2 credentials, so generation, refunds and project-media cleanup cannot be exercised there. | `docs/architecture/staging-rollout.md` | Provision test-mode secrets on staging. |
| P7 | low | `veyrnox_social_cinema` flag expects the string `'true'`; every other preview flag uses `'1'`. | `SocialCinema.js:65` | Accept `'1'`. |
| P8 | low | YouTube connect route header still says no publish path exists. | `app/api/v1/social/accounts/youtube/connect/route.js` | Fix comment. |
| P9 | low | Projects asset APIs exist with no UI. | `app/api/v1/projects/[id]/assets/*` | Expected (M02); note only. |

## 3. Security, infrastructure and config

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| I1 | **high** (verify secret) | LemonSqueezy is retired (ADR-0031) but its webhook route is still deployed: if `LEMONSQUEEZY_WEBHOOK_SECRET` is still set, a signed request reaches `credit_top_up` (it returns 503 `not_configured` only when the secret is unset). Its vars stay in `wrangler.jsonc`. | `app/api/webhook/lemonsqueezy/route.js`, `packages/adapters/lemonsqueezy.js`, `wrangler.jsonc` | Remove route, adapter, vars, `config/credit-packs.json`, tests; delete the secrets. |
| I2 | medium | The Cloudflare Stream webhook is account-wide and points at staging; production would get no Cinema callbacks. | `docs/architecture/staging-rollout.md` | Repoint before Cinema activation (#369). |
| I3 | medium | Six `CINEMA_STREAM_*` secrets are read by code but missing from the `wrangler.jsonc` secrets list. | `lib/cinema/stream.js`, `wrangler.jsonc` | Document them. |
| I4 | medium | `.env.example` lists Inngest, Replicate, DeepSeek, Sentry, PostHog, LemonSqueezy and none of Stripe, kie, OpenRouter, GrsAI, BytePlus, Stream or social keys. | `.env.example` | Regenerate from `wrangler.jsonc`. |
| I5 | medium | No E2E suite: sign-up → generate → buy is untested in a browser. | `tests/`, TRD §11 | Playwright smoke on the three journeys against a preview build. |
| I6 | low | No `engines` / `.nvmrc`; CI is Node 22, `Dockerfile` is Node 20; `Dockerfile` and `docker-compose.yml` are upstream leftovers; `package.json` name/homepage still point at the upstream fork. | `package.json`, `Dockerfile` | Pin Node 22; delete or label the leftovers; rename. |
| I7 | low | `packages/catalog/index.ts` plan prices ($15/200, $39/1000, $99/3000) contradict ADR-0064 ($19/270, $59/1,200, $129/3,000). | `packages/catalog/index.ts` | Align or delete the plan block. |
| I8 | low | `/api/catalog`, `/api/credit-packs`, `/api/cinema/titles` sit outside the `/api/v1` JWT gate — public by design but undocumented. | `app/api/*` | Note in TRD (done) and CLAUDE.md. |
| I9 | low | Issue #4 (CSP nonce) is effectively done (#322, ADR-0060) but open with stale boxes and a wrong ADR reference. | GitHub #4 | Update or close. |
| I10 | low | Open PR #357 duplicates work that landed in #379 (0163/0164). | PR #357 | Close. |

## 4. UI

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| U1 | medium | Cinema pages render a second `<main id="main">` inside the root `<main>` (duplicate id, nested landmark); Account and Publish also nest `<main>`. | `SocialCinema.js`, `TitlePage.js`, `Player.js`, account, publish pages | Use `<div>` / `<section>`. |
| U2 | medium | `ToasterMount` hard-codes `#1a1a1a` / `#f5f5f5` — ignores tokens and the light theme. | `components/ToasterMount.jsx` | Use `rgb(var(--vx-panel))` etc. |
| U3 | medium | Amber rule drift. Prices shown non-amber: hero/preset tile `N cr` (white), statement debits (fg), Generate cost (accent-ink). Amber that isn't Credits: Chip `warn` tone, sign-in notice on Credits, `/m` banner, `loading.js` bar, Cinema Pass USD panel. | UI audit | Apply UI-UX.md §2 rule; add a `warn` token if a warning hue is needed. |
| U4 | medium | Studio duration and aspect toggles lack `aria-pressed`. | `app/veyrnox/app/create/page.js` `ControlRow` | Add it. |
| U5 | low | Inter is loaded but effectively unused: `font-sans` names the literal family `'Inter'`, which next/font/local registers under a generated name, so chrome outside `.vx-root` (AuthGate, toasts, SiteChrome) likely renders in the system fallback. | `app/layout.js`, `tailwind.config.js`, `app/globals.css` | Point `font-sans` at `var(--font-archivo)` or drop Inter. Confirm in a browser. |
| U6 | low | Reduced-motion kill switch is scoped to `.vx-root`; root-mounted chrome is not covered. | `app/veyrnox/veyrnox.css:53` | Move the rule to `:root`. |
| U7 | low | `.vx-paper` doesn't re-point `--vx-danger`, so dark-theme red shows on paper. | `veyrnox.css:100-150` | Add the light value. |
| U8 | low | Stale UI: `loading.js` skeleton still draws the removed promo strip; `/design-system` lacks the receipt world and calls refunds red; `ThemeToggle` comment says 14 variables (15). | `app/veyrnox/loading.js`, `design-system/page.js`, `ThemeToggle.js` | Refresh. |
| U9 | low | Dead code: `tokens.js` `PROMO_STRIP`, `PILLARS`, `METRIC_STRIP`, `PRODUCT_TILES`, `HERO_CHIP`; keyframes `vxPulse`, `vxSlideUp`, `vxFade`, `vxDrift`, `fade-in-up`; legacy `--color-primary`, `.glass-*`, Tailwind `primary`, `glow*` shadows. | UI audit | Delete. |

## 5. Documentation drift

| # | issue | fix |
|---|---|---|
| D1 | CLAUDE.md: CSP said to live in `next.config.mjs` with `connect-src` = self + Supabase (it is `lib/contentSecurityPolicy.mjs`, nonce-based, plus R2 and Stream hosts); identity headers omit `-aal`, `-mfa-at`; webhook section names LemonSqueezy, not Stripe/kie/OpenRouter/Stream; providers omit passkeys; flags said to be `localStorage` (they are server vars); "Studio proxies through the same host" refers to the removed studio. | Owner edit of CLAUDE.md (this audit does not change it). |
| D2 | `docs/PHASE-1.md` still names Clerk, Neon, Inngest, LemonSqueezy, `jose`, a 50-credit webhook grant and old plan prices; status "In progress". | Mark superseded by [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). |
| D3 | ADR statuses lag: 0023, 0033, 0039, 0049–0056, 0060 say Proposed but are live; 0003 still Accepted though superseded by 0031; 0012 open while TTS is live; 0020 header says kie "no-go". ADR-0065 does not exist; `docs/adr/README.md` index omits ~25 ADRs. | Status sweep PR. |
| D4 | `ROADMAP.md` calls ADR-0063 a draft (Accepted) and lists the npm-audit blocker fixed by #401. | Update. |
| D5 | `ARCHITECTURE.md` and `docs/architecture/current-state.md` (migrations "through 0133", lint "unusable", BytePlus as signed-webhook, no Publish section); `environments.md` says staging cron is disabled (it runs `*/5`). Staging Supabase is us-east-2 while docs present the system as EU-only. | Refresh. |
| D6 | Feature-spec headers stale: model-capability-registry "Draft" (implemented); editor PRD "Slice 1a" (Slices 2–3 shipped); Auto Short "Slice 5 waits for billing"; Cinema `paywall-plan.md` "Nothing here is built"; `docs/social-cinema/` (React Native) lacks a superseded banner. | Header fixes. |
| D7 | `docs/adr/0064-core-subscriptions.md` cites the old 100/300/1000 packs as live; `packages/adapters/README.md` lists only fal and r2. | Update. |
