# Issues to fix — audit refreshed 2026-10-08

**Scope:** found while rewriting the six product documents against `main` at
`2da81dc` (2026-10-02), then re-checked item by item against `main` at
`42150476` (2026-10-08, 207 commits later); the Publish items P12-P13 were added against
`bee1ea4f` after PR #637/#638. Every item names its evidence.
"Verify" means the repo shows the defect but production may differ
(hand-applied data, secrets and dashboard settings the repo cannot see).
**Nothing here has been filed as a GitHub issue.** The six open GitHub issues
(#4, #101, #204, #438, #476, #477) are launch, CSP, epic and dependency
tracking, not this list. File these under the `needs-triage` label (see
`docs/agents/triage-labels.md`) once the owner has read this list.

**Production evidence used for "applied":** `node scripts/check-migration-ledger.mjs`
on 2026-10-08 reported "all 193 applied migrations accounted for", and the
applied-name list held every file from 0033 to 0227 (0037 and 0067 under their
earlier names); 0228 was applied afterwards per the tester handover (not re-read). `reconcile_status()` read the same day: all five drift counts 0.

**Tally (2026-10-08): 62 tracked, 41 closed, 21 open** — 0 critical, 0 high,
7 medium, 14 low. 10 items are new since 2026-10-02 (S18–S20, P10–P13, D8–D10).

Severity: **critical** = money or data at risk now · **high** = wrong
behaviour a user can hit · **medium** = latent defect or guard missing ·
**low** = hygiene.

## 1. Schema and money spine

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| S1 | **fixed — 0167 (#408), applied to production** | The three new Credit Packs (270/$19, 1,200/$59, 3,000/$129) could not be bought on a schema built from migrations: `create_pending_top_up` still required `p.variant_id IS NOT NULL`. `/api/credit-packs` on production lists all four packs. A real purchase of each pack is still not evidenced (IMPLEMENTATION-PLAN A4). | `supabase/0167_stripe_packs_without_variant.sql` | Done. |
| S2 | **fixed — 0168 (#409), applied** | Disconnecting a social account did not stop publishing. | `supabase/0168_social_publish_claim_guards.sql` | Done: claim filters `status='active'`; disconnect clears tokens and fails pending targets. |
| S3 | **fixed — 0168 (#409), applied** | Social completion had no claim guard. | same | Done: only the current `claim_key` may report; terminal states are final. |
| S4 | medium — **open; not a bug, a missing tool** | Legacy (non-proxy) Cinema uploads a creator removes stay in `deleting`, holding capacity. This is the documented quarantine in ADR-0054's 28 Sep amendment. **No operator reconciliation tool exists** (nothing in `scripts/` or `app/api/v1/admin/` since 2026-10-02; 8 such rows on staging). Latent while Cinema is off. | ADR-0054 §Server-mediated transfer replacement; `0164:62,69`; `docs/operations/audit-remediation-2026-09-26.md:352` | Decide and build an operator reconciliation path (verify provider state, then delete or release). Do not loosen the claim filter. |
| S5 | fixed — 0172 (#413), applied | Default-privilege revoke did not remove built-in `EXECUTE` to `PUBLIC`. | `supabase/0172_default_execute_revoke_public.sql` | Done. |
| S6 | fixed — 0171 (#412), applied | Ledger idempotency rested on locked probes, not unique indexes. | `supabase/0171_ledger_unique_backstops.sql` | Done: partial UNIQUE for refunds and `grant:signup`; `cinema_unlocks.ledger_entry_id` unique. |
| S7 | fixed — 0170 (#411), applied | A title by a restricted/banned creator could still be unlocked. | `supabase/0170_cinema_unlock_requires_active_creator.sql` | Done. |
| S8 | fixed — 0173 (#414), applied | `project_assets` granted `INSERT, UPDATE` to `service_role`. | `supabase/0173_project_assets_rpc_only_writes.sql` | Done. |
| S9 | fixed — 0174 (#415), applied | `top_up_flagged_orders` had no append-only guard. | `supabase/0174_flagged_orders_append_only.sql` | Done. |
| S10 | low — documented (#416); **owner to confirm** `private` is not in the dashboard's API exposed schemas | Tenant tables are a browser-facing PostgREST surface, a deliberate departure from "browser never talks to Postgres". CLAUDE.md now records it. The dashboard setting is not visible from the repo. | CLAUDE.md §Database; `supabase/0135:5,112` | Confirm `private` is absent from PostgREST `db-schemas`. Unverified. |
| S11 | fixed — 0175 (#417), applied | `social_account_actions.actor_id` was `ON DELETE SET NULL` on an append-only table. | `supabase/0175_social_actions_actor_restrict.sql` | Done. |
| S12 | fixed — 0176 (#418, + CI guard), applied | Missing FK/lookup indexes. | `supabase/0176_fk_lookup_indexes.sql`, `scripts/test-fk-indexes.mjs` | Done. |
| S13 | fixed — 0177 (#419, + CI guard), applied | Append-only triggers did not block `TRUNCATE`. | `supabase/0177_append_only_no_truncate.sql`, `scripts/test-append-only.mjs` | Done. Newer tables follow it (`credit_subscription_events` has the trigger in 0186). |
| S14 | fixed — 0178 (#420) and 0180 (#424) | Dead/legacy: `users.plan`, duplicate `users_auth_id_idx`, LemonSqueezy-only writers. | `0178`, `0180` | Done. `credit_packs_net_floor` kept and re-described. |
| S15 | fixed (#421) | `list_public_cinema_titles_page` could repeat a row across pages. | `app/api/cinema/titles/route.js` | Done: the cursor is `before`+`before_id` or neither. |
| S16 | fixed — 0168 + 0181 (#422), applied | NULL `next_check_at` stranded a row; YouTube quota used server-timezone `current_date`. | `0168`, `0181` | Done: Pacific quota day. |
| S17 | fixed (#423), **stale again — see S18** | `supabase/README.md` gap table was stale. | `packages/db/schema/supabase/README.md` | Done 2026-10-03. |
| S18 | low — **new, open** | The same table is stale again. It lists 0039–0040, 0061, 0069, 0076, 0118–0119, 0151/0158, 0179 but omits **0195, 0204, 0209 and 0224**. `git log -S` shows each was committed and then renumbered or replaced before merge (0195→0201, 0209→0214/0223, 0224→0227; 0204, a draft for the video-to-audio activation, became 0221); no file exists under any of the four numbers. `check-migration-numbers.sh` detects duplicates only, so nothing flags a missing row. | `packages/db/schema/supabase/README.md:178-196`; `ls` shows no file for those four numbers | Add the four rows; consider a CI check that every gap is in the table. |
| S19 | medium — **new, open, latent** (Cinema is off) | The same-second `incomplete` event regression fixed for credit subscriptions in 0186 most likely exists in `apply_cinema_pass_event`. The HANDOVER-2026-10-03 §7 says so ("fix it before Cinema Pass goes live"); no migration since 0143 redefines the function. Reported, not independently reproduced. | `docs/product/HANDOVER-2026-10-03.md` §7; `grep apply_cinema_pass_event packages/db/schema/supabase/*.sql` → 0143 only | Port the 0186/0187 fix with a same-second acceptance test before D3/D6. |
| S20 | medium — **new, open** | The hourly watcher and the public `reconcile_status()` carry five counts (balance, free credit, top-up, failed refund, Subscription Credit). `reconcile_free_allowance()` (0207) and `reconcile_referrals()` (0218) run **only** inside the nightly `veyrnox-reconcile-balances` pg_cron job, which raises on drift. Referrals mint Credits and are on in production; drift would show only as a failed cron run, not as a `reconcile-watch` issue. | `supabase/0185:49-57` (five columns); `0207:6` ("not changed here"); `0218:145-148`; `.github/workflows/reconcile-watch.yml` | Add both counts to the snapshot, `reconcile_status()` and `scripts/check-reconcile.mjs`, or name the cron history as the alert path. |

## 2. Product and behaviour

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| P1 | **fixed — `PUBLISH_ENABLED` is `"false"` in production; Free cap in 0169 (#410)** | Veyrnox Publish was live with no flag and no plan. | `wrangler.jsonc`, `lib/social/publishFeature.js`, `supabase/0169_social_publish_free_account_cap.sql` | Done. The Publish Plan itself is still not built (B3). |
| P2 | **fixed (#399)** | YouTube resumable upload could not complete. | merged 2026-10-03 | Done. A real public YouTube video was published and its analytics read on staging 2026-10-07 (`docs/social-publisher/ACCEPTANCE-2026-10-07.md`). |
| P3 | **fixed (#486)** | `/app/credits` said "No subscription." | `app/veyrnox/app/credits/page.js:137` | Now "Credit Packs are one-off purchases. Nothing renews." Revisit when subscriptions get a UI (C5). |
| P4 | low — **registration fixed (#491); production sign-in unconfirmed; ADR-0032 still Proposed** | `/app/account` lists, adds and removes passkeys. Registration is confirmed on production (2026-10-03). Enrolment **and fresh sign-in** were confirmed on **staging** on 2026-10-06 (`docs/social-publisher/HANDOVER-analytics-2026-10-03.md`). Sign-in with a passkey on production has not been recorded. | ADR-0032 amendments; `PasskeyPanel.js` | Sign out on production and sign in with the passkey; then record acceptance in ADR-0032. |
| P5 | medium — open | Cinema Pass cannot be tested end to end: `CINEMA_SUBSCRIPTIONS_ENABLED` is still unset on staging. | `wrangler.jsonc` `env.staging` (the other Cinema flags are `"true"`) | Turn on in staging with Stripe test keys. |
| P6 | medium — **partly fixed** | Staging now runs generations (a free chat reply and image, captions on fal, browser uploads to R2) per the runbooks and `docs/editor/CAPTIONS.md`, so provider and R2 credentials exist there. Stripe test keys and the Resend/alert secrets do not: `SUBSCRIPTIONS_ENABLED` is `"false"` on staging and `credit-subscription-acceptance.md` lists them as prerequisites. | `docs/operations/credit-subscription-acceptance.md`; `docs/architecture/staging-rollout.md` | Provision Stripe test-mode secrets on staging. |
| P7 | **fixed (#486)** | `veyrnox_social_cinema` expected `'true'`. | `app/veyrnox/social-cinema/preview.js` | Accepts `'1'` and `'true'`. |
| P8 | **fixed (#486)** | YouTube connect route header said no publish path exists. | route comment | Done. |
| P9 | low | Projects asset APIs exist with no UI (nothing in `app/veyrnox/app/projects` touches assets). | `app/api/v1/projects/[id]/assets/*` | Expected (M02); note only. |
| P10 | low — **new, verify** | Production chat depends on Worker secrets the repo cannot show: `OPENROUTER_CHAT_API_KEY` (required in production, no fallback), and `EXA_API_KEY` for the capped Web search (a capped row offers Web search only while a search key is set). `CHAT_ENABLED` is `"true"` and ten text models are active, so a missing key means refunded failures, not lost money. | `wrangler.jsonc` comments; `lib/chat.js` `rowOptions`; `packages/adapters/exa.js` | Check the secret names with `wrangler secret list`; walk one reply and one Web search on production. Unverified. |
| P11 | low — **new, owner decision** | The 100-credit pack ($10) is still on sale (`/api/credit-packs` lists `web-100`) although ADR-0064's tiers start at 270. HANDOVER-2026-10-03 §8 item 6 asked the owner to retire or keep it; no decision is recorded. | `https://veyrnox.ai/api/credit-packs`, 2026-10-08; handover §8 | Owner: keep or retire (a catalog `active=false` migration). |
| P12 | low — **new, open** | Twitch video statistics are collected (`lib/socialAnalyticsSweep.js` fetches the latest 20 videos when the extended switch is on) but the analytics page's `ANALYTICS_NETWORKS` still lists only Instagram, YouTube and TikTok, so a Twitch account reads "not available yet". | `app/veyrnox/app/publish/analytics/page.js:17`, `packages/adapters/social/twitch.js` | Add `twitch` to the page's set and check the table renders video-only rows. |
| P13 | low — **new, open** | The six networks added by PR #637 are covered by stubbed contract tests only: no real-account run, no provider app approval, and 9 of the 10 OAuth apps have no credentials on staging. The tester handover also labels YouTube "OAuth with PKCE", which the adapter on `main` does not forward (*unverified*). Facebook Page tokens have no stored expiry or refresh. | `docs/social-publisher/INTEGRATIONS-TESTING-2026-10-08.md`; `packages/adapters/social/{facebook,youtube}.js` | Run the tester steps per network; correct the PKCE label; decide Page-token handling. |

## 3. Security, infrastructure and config

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| I1 | low — **code fixed (#424); residual unverified** | LemonSqueezy is gone from the code: route, adapter, vars, config, tests, and 0180 dropped the SQL writers. The two Worker secrets (`LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_WEBHOOK_SECRET`) were both still set on 2026-10-02; deletion is not recorded. Only two comments in `app/api/webhook/stripe/route.js` and `packages/adapters/stripe.js` still name it. | `ls app/api/webhook` has no `lemonsqueezy` | Delete the two secrets. Unverified. |
| I2 | medium — open (tracked: #369) | The Cloudflare Stream webhook is account-wide and points at staging; production would get no Cinema callbacks. Correct as is while every production Cinema flag is `false`. | `wrangler.jsonc` comment; `docs/architecture/staging-rollout.md`; PR #369 open | Repoint before Cinema activation. |
| I3 | fixed (#426) | Six `CINEMA_STREAM_*` secrets were missing from the `wrangler.jsonc` list. | `wrangler.jsonc` | Done. |
| I4 | fixed (#429) | `.env.example` listed dead services. | `.env.example` | Done. |
| I5 | medium — **partly fixed (#436)** | Playwright smoke exists (`e2e/`, daily `e2e.yml`) for sign-up, generate and buy against staging. Generate and buy skip until `E2E_EMAIL`/`E2E_PASSWORD` name a confirmed staging account; whether the secrets are set is not visible from the repo. | `e2e/README.md`, `.github/workflows/e2e.yml` | Provide the test account. Unverified. |
| I6 | fixed (#471) | Node/Docker leftovers. | `package.json` `engines` `>=22`, `.nvmrc` | Done: Node 22 pinned; Dockerfile removed; package renamed. |
| I7 | fixed (#472) | `PLANS` contradicted ADR-0064. | `packages/catalog/index.ts` | Done. |
| I8 | fixed (#475) | Public routes outside `/api/v1` undocumented. | `tests/routesOutsideGate.test.mjs` (14 routes, including `/api/popular-templates` and `/api/webhook/montage`) | Done: CLAUDE.md lists them; the test fails on an unlisted route. |
| I9 | low — open on purpose | GitHub #4 (CSP nonce) is still OPEN (last updated 2026-10-03). #322 is merged and live; its closing evidence (signed-in OAuth/Turnstile journey and Stripe return with no CSP errors, production latency) is not all recorded. | `gh issue view 4` | Record that evidence, then close. |
| I10 | fixed | PR #357 duplicated #379; closed as superseded 2026-10-03. | PR #357 | Done. |

## 4. UI

| # | sev | issue | evidence | fix |
|---|---|---|---|---|
| U1 | fixed (#478) | Nested `<main>` elements. | root layout keeps the one `<main id="main">` | Done. |
| U2 | fixed (#478) | `ToasterMount` ignored the theme tokens. | `components/ToasterMount.jsx` | Done. |
| U3 | fixed (#482) | Amber was used for more than Credits. | `globals.css`, `Chip.js`; `warn` token (blue) | Done. Left on purpose: the price inside the Generate button and small muted figures. UI-UX.md §2. |
| U4 | fixed (#478) | Studio toggles lacked `aria-pressed`. | `ControlRow.js` | Done. |
| U5 | fixed (#481) | Inter fallback worked by accident. | `app/layout.js` | Done: `var(--font-inter)` on `<html>`. |
| U6 | fixed (#478) | Reduced-motion rule scoped to `.vx-root`. | `app/globals.css:100` | Done: applies site-wide. |
| U7 | fixed (#478) | `.vx-paper` did not re-point `--vx-danger`. | `veyrnox.css:107` | Done. |
| U8 | fixed (#480, #484) | Stale skeleton, `/design-system` and `ThemeToggle` comment. | `design-system/page.js` | Done. |
| U9 | fixed (#480) | Dead tokens, keyframes and constants. | UI audit | Done. |

## 5. Documentation drift

| # | issue | fix |
|---|---|---|
| D1 | **Fixed 2026-10-03 (#490).** CLAUDE.md brought in line with the code (CSP, identity headers, webhooks, passkey sign-in, flags, sign-up gate, tenant PostgREST surface, routes outside the gate, Subscription Credits, referrals). | Done. Two stale lines remain — see D8. |
| D2 | **Fixed (#489).** `docs/PHASE-1.md` carries a "Superseded 2026-10-02" banner. | Done. |
| D3 | **Fixed 2026-10-03 (#488)** except 0012. ADR statuses corrected against production; the index lists every ADR. **Open on purpose:** ADR-0012 (TTS) — four speech models are live and no provider decision is recorded. | Owner: record the TTS decision in 0012. |
| D4 | **Fixed (#489).** `ROADMAP.md` corrected. | Done. |
| D5 | **Fixed (#489).** `ARCHITECTURE.md`, `environments.md`, `current-state.md`. | Done. |
| D6 | **Fixed (#489).** Feature-spec headers. | Done. |
| D7 | **Fixed (#489).** ADR-0064 note; `packages/adapters/README.md` lists adapters. | Done. |
| D8 | **New, open, low.** CLAUDE.md (money-spine wording left untouched on purpose) has two lines that no longer match the code: (a) §Database says the nightly `veyrnox-reconcile-balances` job "fails on any row from `reconcile_balances()`, `reconcile_free_credits()` or `reconcile_top_ups()`" — the job (0218) runs seven checks, adding failed refunds, Subscription Credits, free allowance and referrals; (b) the Subscription Credits bullet says "nothing calls it until the Stripe subscription webhook is built" — the webhook, routes and `stripeCreditSubscriptions.js` exist since #514, behind `SUBSCRIPTIONS_ENABLED="false"`. | Owner edits CLAUDE.md. |
| D9 | **New, open, low.** `docs/adr/README.md` omits **ADR-0068** and **ADR-0074**; still says "nothing built; ships off" for 0069, 0070, 0071 and 0072, all of which are built and 0069, 0071, 0072 (Personas) are on in production; lists ADR-0073 as Proposed although it was merged (#605) and is live in chat; ADR-0069's own status line says "Nothing is built". | Update the index and the status lines. |
| D10 | **New, open, low.** The `wrangler.jsonc` comment on `CHAT_ENABLED` says the screen is "still behind the per-browser preview switch (localStorage.veyrnox_chat)"; the page has no such switch (`app/veyrnox/app/chat/page.js`, #552) and the nav links to it for everyone. `CHAT_RESEARCH_ENABLED` is read by `lib/chat.js` but is not declared in `wrangler.jsonc`, so the flag cannot be audited there. | Fix the comment; declare the flag as `"false"`. |
