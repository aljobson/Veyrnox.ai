# PRD — Veyrnox.ai

**Status:** Current · 2026-10-08 (audited against `main` at `42150476`; first
written 2026-10-02 at `2da81dc`)
**Scope:** the whole product. Feature-level specs live beside it
([face-filters](../face-filters/README.md), [editor](../editor/PRD.md),
[editor captions](../editor/CAPTIONS.md), [auto-short](../auto-short/SPEC.md),
[cinema](../cinema/README.md), [social-publisher](../social-publisher/),
[video agent](../montage/SPEC.md)).
**Language:** every term is defined in [CONTEXT.md](../../CONTEXT.md).
**Precedence:** [CLAUDE.md](../../CLAUDE.md) and [docs/adr/](../adr/README.md)
win wherever they disagree.

> **What "shipped" means here.** The repo shows intent; it cannot prove what
> is applied in production. Two things were read on 2026-10-08: the live
> migration ledger (`check-migration-ledger.mjs`: 193 applied, every file
> through 0227 accounted for) and the public `/api/catalog` and
> `/api/credit-packs`. Switch values are the top-level `vars` in
> `wrangler.jsonc` at the audited commit; a dashboard change would not show.
> Catalog activations go through the owner-approved `apply-migrations`
> workflow. Before quoting a number externally, check `/api/catalog` and
> `/api/credit-packs` on production.

## 1. What it is

A credit-metered AI generation platform. A user holds one balance of
**Credits** and spends it on image, edit, video, lip-sync, music, sound and
speech models, and on LLM Chat replies, from several providers, behind one
interface. Every generation is priced up front from the catalog, debited
before it runs, and refunded exactly if it fails.

Around that core sit three products that share the account:

- **LLM Chat** — priced text replies from ten models, with Personas and Studio
  skills. **Live.**
- **Veyrnox Publish** — schedule generated media to Instagram, LinkedIn, X,
  TikTok and YouTube. Built, **dark in production** (`PUBLISH_ENABLED`).
- **Social Cinema** — creators publish short series; viewers unlock episodes
  with Credits or watch with a Cinema Pass. Built, **off in production**.

A fourth, the **video agent** (ADR-0074), is built behind a flag with no price
and no runner in production.

The business is the margin between what a Credit sells for and what the
provider charges, held at or above the ADR-0014 floor on every catalog row.

## 2. Who it is for

| user | wants | we give |
|---|---|---|
| Creator (primary) | several frontier models without an account at each vendor | one balance, exact price before submit, failed runs cost nothing |
| Chat user | a cheap, multi-model assistant that also prepares Studio jobs | LLM Chat: pick a model, see the reply price, Personas, Studio skills |
| Social poster | generated clips on their channels on a schedule | Publish: connect accounts, compose, schedule *(dark)* |
| Referrer | a reward for bringing a paying friend | 10% of the friend's first Credit Pack, in Credits |
| Cinema creator *(not launched)* | an audience and revenue for short series | upload, review, catalogue, paywall |
| Viewer *(not launched)* | binge short episodes | free episodes, 6-credit unlocks, Cinema Pass |

All are cost-sensitive. The price is the product's promise: "The price is on
the button."

## 3. Shipped (production)

### 3.1 Accounts
- Sign-in: email + password, magic link, **Google**, **Apple** (ADR-0030),
  and **passkey** sign-in. Apple and passkey buttons now show in every
  sign-in dialog; live settings gate starting the action, not the button
  (ADR-0032 amendment 2026-10-04).
- **Passkey set-up and removal** on `/app/account` (#491); registration is
  confirmed on production. Sign-in with a passkey is confirmed on staging
  (2026-10-06) but **not yet recorded on production**; ADR-0032 is still
  Proposed.
- **Confirm email is on.** The account is usable only after confirmation;
  **10 Free Credits** land at that moment (0071, 0127), expire after 90 days
  (ADR-0013), and are spent first.
- **Turnstile** on password, sign-up, magic link and passkey attempts
  (ADR-0026). OAuth is not challenged.
- Leaked passwords refused (HaveIBeenPwned); the form warns before the first
  attempt. The project setting itself is not visible from the repo (unverified).
- `/app/account`: TOTP 2FA for every user, passkeys, password change by
  emailed code, sign out other devices / everywhere, **Refer a friend** panel,
  data export and deletion by email request.
- **Referrals (ADR-0071, live since 2026-10-07).** `?ref=<code>` is kept in
  the browser for three days and attached once the friend is signed in. The
  referrer earns **10% of the Credits in the friend's first Credit Pack**,
  rounded down, released by an hourly sweep 14 days after the Pack with no
  refund or dispute and no Freeze; at most 20 rewards and 2,000 Credits per
  referrer per month. A later refund or dispute claws back as `reverse:referral`.
  Credits only — no cash, no friend bonus.
- Admin: Cloudflare Access + `aal2`; Cinema admin additionally needs MFA
  within 5 minutes.
- Violation warnings and takedown notices are emailed to the user through
  Resend from `support@veyrnox.ai` (reply-to `support@veyrnox.com`); the
  violations page shows whether the user was emailed (#483, #485). The first
  real send has not been observed (unverified).

### 3.2 Generating
- **Studio** (`/app/create`): pick a model (price-tier filter), prompt,
  optional uploads, see the cost in Credits, submit, poll to completion,
  result plays inline. 10 s video costs twice the 5 s unit. Image models can
  generate **1–4 images in one click**; models that take them accept a seed
  and a negative prompt; a **Library image** can be the start image
  (`source_assets`). Default model `wan-2.5-kie`.
- **Free allowance (ADR-0069, live since 2026-10-07).** Two models waive the
  price of 3 jobs a day per account: `nano-banana-kie` (40 a day across all
  accounts) and `chat-mistral-small` (100 a day). The job is created at 0
  Credits with no ledger row; the Studio shows "free (N left today)"; the
  Library shows FREE. Only a plain chat reply can be free. At most $1.00 a day
  of provider spend.
- **Templates** (`/presets`, `/presets/[id]`; "Gallery" before) and **Explore**
  (`/app`): curated starting points that open the Studio pre-filled, now with
  Cartoons, Movies, Fantasy and Realistic categories and a **Popular** sort
  (ranked by distinct accounts that completed a job from a template; ADR-0072).
- **Tools** (`/tools`): models that start from your own file (upscale, cut-out,
  expand, edit, animate, video-to-audio) with the price on each.
- **Guides** (`/guides`): five step-by-step guides. **Model pages**
  (`/models`, `/models/[id]`) from the live catalog.
- **Landing slip**: the hero `PriceSlip` prices a prompt live and hands it to
  the Studio.
- **Uploads**: presigned R2 PUT, 20 MB (100 MB video), require an Acceptable
  Use attestation (0146, `/legal/aup`).
- **Library** (`/app/library`): every past generation, 90-day asset retention
  notice; star favourites, filter by type, grid or list, **Ask about this**
  (opens a chat with that image attached), schedule to Publish *(when Publish
  is open)*.
- **Provenance**: `/api/v1/jobs/:id/provenance` returns how an asset was made
  and a SHA-256 of the stored bytes (ADR-0025 option E). No C2PA claim.
- **Clip Editor captions** (live since 2026-10-08, `docs/editor/CAPTIONS.md`):
  an optional last step on a Clip Editor edit, burned in with `veed/subtitles`
  on fal; 7 billed units; no-speech clips fail and refund. The edit sheet still
  hides it behind `localStorage.veyrnox_editor_captions`; the Clip Editor
  itself behind `veyrnox_editor`. fal's invoice for the probe and staging runs
  has not been read (unverified).

### 3.3 Catalog — 33 media rows on `/api/catalog`, plus 10 chat rows

| kind | models |
|---|---|
| text-to-image | Nano Banana, Nano Banana Pro, Flux.2 [pro], Flux.2 Pro 1K, Seedream v4, Sana v1.5 |
| image edit | Nano Banana Pro Edit (×2 lanes), Bria Background Removal, Bria Expand, Topaz Upscale 2× |
| text-to-video | Veo 3.1 Fast, Veo 3.1 Lite, Wan 2.5, Kling 2.6 Pro, MiniMax Hailuo 02, Seedance 2.0 Fast; Veo 3.1 listed but **gated** (402) |
| image-to-video | Kling 3.0 (×2 lanes), Kling AI Avatar v2 |
| video-to-video | LatentSync lip sync, MMAudio v2 video-to-audio (0221) |
| audio | ACE-Step, ACE-Step 1.5, MMAudio v2, ElevenLabs Sound Effects v2 |
| speech | Inworld TTS, ElevenLabs TTS Turbo 2.5, MiniMax Speech 2.6 HD, ElevenLabs Dialogue v3 |
| composite (flag-gated preview in the Studio) | Auto Short 32 s (110 cr), Clip Editor (1 cr/s; captions add 7 units) |
| chat (not on `/api/catalog`) | Llama 4 Maverick, Ministral 14B, Mistral Small, GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5, GPT-6.1 Sol, Grok 4.7, Claude Opus 5.5 (activated by 0199, 0200, 0201, 0211) |

Counts: `/api/catalog` returned 33 rows on 2026-10-08 (32 on 2026-10-02: the
addition is MMAudio v2 video-to-audio). The 10 chat rows are excluded from the
public catalog by `lib/publicCatalog.js`. Staged and inactive: five BytePlus
Seedance rows (ADR-0058), video upscale (0202), and the `video-agent` row
(0227).

Prices live in `model_catalog.credits_5s`; the app never computes a price.
Providers: fal.ai, kie.ai, OpenRouter (Seedance video; chat through a separate
key), GrsAI (active), BytePlus (staged), Exa (capped Web search for chat),
plus the internal composites `veyrnox` and, inactive, `montage`. **The
provider is never shown to the user**; a chat reply names its model and price
only (ADR-0067).

### 3.4 Paying
- **Credit Packs** via **Stripe Checkout**, Stripe Managed Payments as
  Merchant of Record, automatic tax (ADR-0031): **100 for $10, 270 for $19,
  1,200 for $59, 3,000 for $129**, plus tax (0121, ADR-0037). Purchased
  Credits never expire. Supply-consent checkbox before purchase. Whether the
  100-credit pack stays on sale is an open owner decision (ISSUES P11).
- Lost-webhook recovery: return URL + 5-minute backfill (ADR-0033, accepted
  2026-10-03).
- **Refunds**: any failed generation refunds its exact debit to the source it
  came from. A refunded or disputed purchase claws back and may **Freeze**
  the account (ADR-0018/0019); only an operator unfreezes.
- **Credit statement** on `/app/credits` (ADR-0045), now labelling referral
  rewards and reversals; **usage meters** for the last 24 hours, 7 and 30 days
  (#542).
- Credit Packs are one-off. **Nothing renews** in production (see §4,
  subscriptions).

### 3.5 LLM Chat (`/app/chat`) — live
- **Open to every signed-in user.** `CHAT_ENABLED` is `"true"`; the nav links
  to it for everyone ("LLM Chat"). A reply is a job (ADR-0067): one user
  message is one `jobs` row through `ledger_debit`, priced per reply from the
  catalog (1 Credit on the cheapest models), refunded in full if it fails or is
  cut off. Chat uses its own OpenRouter key (`OPENROUTER_CHAT_API_KEY`) and
  routes only to non-training providers. Whether that secret is set is not
  visible from the repo (ISSUES P10).
- **Priced options per reply:** Thinking; Web search (our own capped search
  through Exa since 0220, so the price is real, not the uncapped plugin's);
  image attachments (up to 4, long edge 2,048 px, ADR-0068), including your
  own Library images and a video as a few frames. **Deep research** (ADR-0070)
  is built but off.
- A reply the person stops after text appeared keeps the text and is charged;
  one the provider cuts off, or that never started, is refunded. Replies never
  appear in the Library.
- Pin, rename, delete (a deleted chat is deleted), search, folders, per-chat
  instructions, starred replies, unsent drafts per chat, two-level model
  picker, settings panel.
- **Personas** (`PERSONAS_ENABLED` on since 2026-10-07; ADR-0072): saved
  instructions with a default model and options, 20 per account. Starting a
  chat from one only fills the draft.
- **Studio skills** (ADR-0073, merged #605, Proposed on paper): built-in
  assistants (Prompt writer, Model picker, Fix this photo, Edit with words,
  Bring it to life, Add sound, Storyboard, Fix my prompt) that end in an **Open
  in Studio** card. They never start a generation and spend only the 1-Credit
  reply; the person presses Generate.

### 3.6 Admin
Metrics (`/app/admin`), user lookup and content violations (3rd takedown
Freezes), Cinema creator and submission review.

## 4. Built, not live

| feature | where it stands | gate |
|---|---|---|
| **Veyrnox Publish** (`/app/publish`): connect Instagram, LinkedIn, X, TikTok, YouTube; compose one Library asset or a **device upload** + text + accounts + time, **Post now** or schedule; weekly **brand drafts** with batch approval; **calendar** with safe rescheduling; **analytics** (YouTube, Instagram, TikTok) and posting-time insights; schedule from the Studio and Library | staging: a real YouTube video published and its analytics read (2026-10-07); calendar acceptance done | `PUBLISH_ENABLED="false"` hides the page, the menu link and `/api/v1/social/*`. `PUBLISH_ANALYTICS_ENABLED`, `PUBLISH_POSTING_INSIGHTS_ENABLED`, `PUBLISH_UPLOADS_ENABLED` also `"false"`; `PUBLISH_CALENDAR_ENABLED="true"` but moot while Publish is shut. The cron publish sweep is not gated. **Free tier enforced:** one connected account per user (ADR-0063, 0169). Instagram insights and TikTok analytics scopes need provider app review |
| **Core subscriptions** (ADR-0064) Starter $19/270, Plus $59/1,200, Ultra $129/3,000 monthly: Subscription Credit ledger bucket (0183/0184), subscription state (0186/0187/0189), Stripe checkout/read/return/cancel routes and webhook | database applied to production; routes and webhook merged (#514); no pricing UI | `SUBSCRIPTIONS_ENABLED="false"` in production **and** staging; staging acceptance unchecked; Stripe's written acceptance and Finance/Legal wording outstanding |
| Chat **Deep research** (ADR-0070): one plan call, four searches, one write; +Credits on Claude Sonnet 5.5 | built (0208, 0214), runbook written | `CHAT_RESEARCH_ENABLED` is unset (off) and is not declared in `wrangler.jsonc` |
| **Video agent** (ADR-0074, accepted 2026-10-07): brief, plan and price, Approve, one priced job on an isolated OpenMontage runner | slices 1–3 and 5 built (0227, `/app/video-agent`, `/api/v1/montage/plan`, `/api/webhook/montage`); runner repo has the egress meter and headless harness; five test runs done on 2026-10-08 (two paid, three Kling v3 clips each). Working price **165 credits** with a **$2.50** per-run ceiling (owner: "use 165"), set on the inactive row; fal's real billing is unread, so the price is provisional | `AGENT_VIDEO_ENABLED="false"`, `localStorage.veyrnox_video_agent`; catalog row inactive |
| Social Cinema: profiles, creator applications, drafts, Stream uploads, review, catalogue, player | staging-verified 2026-09-28/29 | `CINEMA_*` flags off in prod; PR #369 is the activation |
| Cinema paywall: 5 free episodes, 6-credit unlocks, Cinema Pass weekly $14.99 (intro $11.99) / monthly $49.99 / yearly $199.99, 3,000-minute ceiling, 14-day cooling-off | built (0142–0144); staging unlock/publish/view flags on | `CINEMA_SUBSCRIPTIONS_ENABLED` unset even on staging |
| Projects: workspaces, versioned project document, autosave, history, media quarantine | staging | `TENANT_PROJECTS_ENABLED` + `localStorage.veyrnox_projects` |
| Auto Short | catalog row active | `localStorage.veyrnox_auto_short` |
| Clip Editor (captions are live, see §3.2) | catalog row active | `localStorage.veyrnox_editor` |
| BytePlus Seedance (5 rows) | staged inactive, US blocked before debit | ADR-0058 Proposed |
| Jev provider-error classifier | built | `JEV_SUBMIT_ERRORS_MODE=off` (ADR-0066 Proposed) |

## 5. Decided, not built

| feature | decision | blocker |
|---|---|---|
| **Publish Plan** Free 1 account; $19/mo for 5 + $4/extra | ADR-0062/0063 Accepted | plan table, caps, Stripe product; no `publish_plan` code exists |
| **Subscription pricing UI and plan changes** (upgrade now, downgrade at period end, monthly-to-annual undecided) | ADR-0064 owner decisions 2026-10-03 | webhook acceptance on staging; the reviewed plan-change design (#508) needs a new migration |
| Face Filters Transform (Slices 5–9) | upload spine shipped | fal cost data + CSAM hash matching |
| Chat media tool calls (a model starting a priced job, with a confirm step) | ADR-0072 deferred v2 | own ADR; skills only prepare a draft today |
| User-published trends, Agents beyond Personas | ADR-0072 | not planned in v1 |

## 6. Deliberately not built

| not built | why |
|---|---|
| Auto-refill | not on the roadmap |
| C2PA signing claims | withdrawn until real (ADR-0017) |
| Media authenticity verdicts | no named customer (ADR-0025) |
| Voice cloning | off by policy |
| Real-time / live filters | every model is queued and completed asynchronously |
| Cash referrals, partner tiers | referrals pay Credits only (ADR-0071) |
| A chat that starts a generation unconfirmed | spend only through a priced job the person approves (ADR-0072/0073/0074) |
| Any wallet, crypto or on-chain feature | separate company; enforced hard wall |
| LemonSqueezy | refused us (2026-09-22); replaced by Stripe, removed from the code (0180) |

## 7. Launch blockers

Public text-to-media launch (#204, #101, both still open on GitHub 2026-10-08):
1. Stripe live evidence: real purchase + refund, dispute/freeze drills,
   lost-webhook drill, 24 h clean reconciliation.
2. Cloudflare email quota raised (2,000/day requested 2026-09-21) or a
   bounded launch plan.
3. HaveIBeenPwned protection verified on production.
4. Production admin AAL2 journey and recovery-health alert delivery verified.
5. DMCA designated agent filed (ADR-0005).

None of the five is recorded as closed in the repo; treat them as unverified.

Any public **upload** surface (Face Filters, Cinema creators, project media,
Publish device uploads): CSAM hash matching chosen and live (ADR-0025 §8.1).

Cinema: rights/age/territory policy, creator agreement, cooling-off wording,
Stripe acceptance for recurring video subscriptions, Stream webhook repointed
from staging to production, the same-second pass-event fix (ISSUES S19).

Publish: platform app reviews (Meta, TikTok, YouTube), TikTok DNS
verification, the Publish Plan, token-key rotation runbook. (The YouTube
upload fix, #399, is done.)

Subscriptions: staging acceptance, Stripe's written acceptance of credit
subscriptions, tax and consent wording from Finance/Legal.

Video agent: read fal's real billing against the 165-credit working price,
choose and prove the runner host (the firewall check must pass on it), set the
staging secrets, and walk one run plus one forced failure on staging
(`docs/montage/SPEC.md` §7, none of it done). Provider-resale terms and AGPL
use are recorded as the owner's statement in the ADR, not as counsel's.

## 8. How we know it works

- `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()`,
  `reconcile_failed_refunds()` and `reconcile_subscription_credits()` return
  zero rows — every 15 min snapshot, hourly watch (read 2026-10-08: all five
  counts 0), and after every money-spine change. The nightly cron also runs
  `reconcile_free_allowance()` and `reconcile_referrals()`; the hourly watcher
  does not see those two (ISSUES S20).
- Every active catalog row returned real output from its live endpoint
  before activation (ADR-0011); catalog UPDATE migrations assert row counts.
- Every debit path has a tested refund path; every state-changing RPC has an
  idempotency test; a free-allowance failure returns the allowance once.
- `npm run check:signup-gate` reports the gate closed (hourly workflow);
  `auth-providers.yml` compares live providers with the app's list hourly;
  `site-health.yml` checks the live site every 15 minutes.

## 9. Open questions

1. Keep or retire the 100-credit pack?
2. Subscription plan changes: monthly-to-annual on the same tier is undecided
   (ADR-0064); any-refund-ends-the-subscription and no-coupons defaults await
   the owner's confirmation.
3. Which CSAM hash-matching service?
4. Does Track B (media authenticity) have a named customer (ADR-0025 §9.1)?
5. Video agent: allow GET-only stock-footage hosts on the runner, or stay
   generate-only; fix the output resolution (720p or 1080p).
6. Record the text-to-speech provider decision in ADR-0012 (four speech models
   are live with none written down).
