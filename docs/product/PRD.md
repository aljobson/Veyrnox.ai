# PRD — Veyrnox.ai

**Status:** Current · 2026-10-16 (audited against `main` at `3f46a609`; first
written 2026-10-02 at `2da81dc`; re-audited 2026-10-08 at `42150476`). The
2026-10-16 pass re-checked §1, §3.2, §3.3, §3.7, §4 and §5 against
`wrangler.jsonc`, `app/`, `lib/`, the migrations through 0326 and the ADRs
through 0100; §3.1, §3.4, §3.5, §3.6, §6 and §7 keep their 2026-10-08
wording except where a line below says otherwise
**Scope:** the whole product. Feature-level specs live beside it
([face-filters](../face-filters/README.md), [editor](../editor/PRD.md),
[editor captions](../editor/CAPTIONS.md), [auto-short](../auto-short/SPEC.md),
[cinema](../cinema/README.md), [social-publisher](../social-publisher/),
[video agent](../montage/SPEC.md)).
**Language:** every term is defined in [CONTEXT.md](../../CONTEXT.md).
**Precedence:** [CLAUDE.md](../../CLAUDE.md) and [docs/adr/](../adr/README.md)
win wherever they disagree.

> **What "shipped" means here.** The repo shows intent; it cannot prove what
> is applied in production. Two things were read on 2026-10-08 and **not
> re-read on 2026-10-16** (the sections below say "per `wrangler.jsonc`" for
> anything that rests on the repo alone): the live
> migration ledger (`check-migration-ledger.mjs`: 193 applied, every file
> through 0227 accounted for; 0228 was applied afterwards through the approved workflow
> per the tester handover, ledger count not re-read) and the public `/api/catalog` and
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

Around that core sit these products, which share the account:

- **LLM Chat** — priced text replies from ten models, with Personas and Studio
  skills. **Live.**
- **Veyrnox Publish** — schedule generated media to YouTube, LinkedIn, X and
  TikTok (the four networks `PUBLISH_RELEASED_NETWORKS` releases in
  production), with Instagram, Facebook, Threads, Pinterest, Bluesky and
  Google Business Profile (one image) and Twitch (statistics only) built for
  testers behind `PUBLISH_EXTENDED_NETWORKS_ENABLED` (off in production, on in
  staging). Since 0299 it also carries an inbox, SmartLinks, queues,
  approvals, team roles, reports, a customer API and webhooks, ads and
  commerce records and RSS autolists (§3.7). `PUBLISH_ENABLED` is `"true"` in
  production `wrangler.jsonc`.
- **Social Cinema** — creators publish short series; viewers watch free titles
  under a monthly ceiling, and unlock episodes with Credits or watch with a
  Cinema Pass once those switches open. Creator onboarding, publishing, viewing
  and the free ceiling are on in production `wrangler.jsonc`; unlocks, the Pass,
  voting, comments, story polls, rankings and creator monetisation are off.
- **Browser editor** (`/app/editor`, ADR-0080, ADR-0097) — a timeline editor
  that runs in the browser; "the editor is included", with no membership.
  Its timeline, multitrack, shared-tools and runtime switches are on in
  production `wrangler.jsonc`.
- **Video agent** (ADR-0074, `/app/video-agent`) — brief, plan and price,
  Approve, one priced job (165 Credits) on an isolated runner. Open to signed-in
  users with its own studio tab (#825); `AGENT_VIDEO_ENABLED` is `"true"` and
  the `video-agent` row is active (0234).

The business is the margin between what a Credit sells for and what the
provider charges, held at or above the ADR-0014 floor on every catalog row.

## 2. Who it is for

| user | wants | we give |
|---|---|---|
| Creator (primary) | several frontier models without an account at each vendor | one balance, exact price before submit, failed runs cost nothing |
| Chat user | a cheap, multi-model assistant that also prepares Studio jobs | LLM Chat: pick a model, see the reply price, Personas, Studio skills |
| Social poster | generated clips on their channels on a schedule | Publish: connect accounts, compose, schedule |
| Referrer | a reward for bringing a paying friend | 10% of the friend's first Credit Pack, in Credits |
| Cinema creator *(publishing on; monetisation off)* | an audience for short series | upload, review, catalogue; paywall and revenue not open |
| Viewer *(free viewing on; paid off)* | binge short episodes | free titles under a monthly ceiling; 6-credit unlocks and Cinema Pass when opened |

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
  has not been read (unverified). **Slow motion** (`docs/editor/SPEED.md`,
  0237) is built behind `CLIP_EDIT_SLOW_ENABLED`, `"false"` in production and
  `"true"` in staging; its price is a placeholder and fal's invoice is unread.
- **Browser editor** (`/app/editor`, ADR-0080/0088/0090/0097): a timeline
  editor with multitrack tracks, folders and local fonts, markers, brand kits
  and frame comments (`/app/editor/review`), local speech recognition and
  person tools, and exports saved privately to the Library (0285). It needs no
  membership (ADR-0097); purchases use the existing Credit Packs. Production
  `wrangler.jsonc`: `EDITOR_TIMELINE_ENABLED`, `EDITOR_MULTITRACK_ENABLED`,
  `EDITOR_SHARED_TOOLS_ENABLED` and all four `EDITOR_RUNTIME_FLAGS`
  (`libraryExports`, `organization`, `localInference`, `audioStems`) are
  `"true"`. Cloud saving rides `TENANT_PROJECTS_ENABLED` (`"true"` in
  production); project media uploads (`PROJECT_MEDIA_UPLOADS_ENABLED`) are
  `"false"` there.
- **Video agent** (ADR-0074, accepted 2026-10-07; `/app/video-agent`, `/api/v1/montage/plan`, `/api/webhook/montage`): brief, plan and price, Approve, one priced job of **165 credits** with a $2.50 per-run ceiling, run on an isolated OpenMontage runner (Fly app `veyrnox-montage-runner`). The row went active with 0234; fal's bill was read on 2026-10-09 ($0.14 a second, 153 credits at the floor, so 165 covers it); the owner's own production run on 2026-10-10 stored in 362 s; steps 1-9 of `docs/montage/RUNBOOK-production.md` are done, including its own "Video agent" studio tab (#825). `AGENT_VIDEO_ENABLED` and `MONTAGE_LIVENESS_ENABLED` are `"true"` (lost runs fail and refund; set the liveness switch `"false"` before adding a second runner machine). Whether any user has run one is not recorded (unverified).
- **Audio stems** (ADR-0095, 0291): `demucs-stems`, up to 120 s split into
  vocals, drums, bass, guitar, piano and other, 6 Credits, listed once
  `audioStems` is on.
- **Film Studio** (`/app/film-studio`, `docs/product/film-studio.md`): a
  seven-stage browser workspace saved per account in the browser, plus verified
  Film Library masters (ADR-0085, 0279; `FILM_LIBRARY_MASTERS_ENABLED` and
  `FILM_LIBRARY_SAVE_ENABLED` `"true"`). **Enhance** (`/app/enhance`) and
  **Oddlings** (`/app/oddlings`) are further studio pages; **Vey** is the
  in-product guide (`docs/product/ai-mascot.md`).
- **MCP connector** (ADR-0100, `/api/v1/mcp`, `/mcp`, `/oauth/consent`): built
  2026-10-15; the ADR says production activation needs the OAuth checks in
  `docs/operations/mcp.md`, which are not recorded as done (unverified).
- **Safety and support**: appeals and strike ladder with a generation hold
  (ADR-0083, 0272-0274; `/app/account/appeals`), user content reports
  (`/app/account/report`), CSAM escalation with evidence holds (0275),
  generated-image scanning (`CONTENT_SCAN_ENABLED` `"false"` in production,
  `"true"` in staging; 0289), an admin account ledger and reasoned Pack grant
  (`ADMIN_CREDIT_GRANTS_ENABLED` `"false"`, 0271/0278) and Pack clawback
  (0288), and a webhook delivery log (`WEBHOOK_DELIVERY_LOG_ENABLED`
  `"false"`, 0276). Admin pages: users, appeals, reports, webhooks, Cinema
  (submissions, voting, comments, story polls, rankings).
- **Observability**: consent-first PostHog (ADR-0099, active 2026-10-15).

### 3.3 Catalog — 33 media rows read on 2026-10-08; 35 expected from the migrations, plus 10 chat rows

| kind | models |
|---|---|
| text-to-image | Nano Banana, Nano Banana Pro, Flux.2 [pro], Flux.2 Pro 1K, Seedream v4, Sana v1.5 |
| image edit | Nano Banana Pro Edit (×2 lanes), Bria Background Removal, Bria Expand, Topaz Upscale 2× |
| text-to-video | Veo 3.1 Fast, Veo 3.1 Lite, Wan 2.5, Kling 2.6 Pro, MiniMax Hailuo 02, Seedance 2.0 Fast; Veo 3.1 listed but **gated** (402) |
| image-to-video | Kling 3.0 (×2 lanes), Kling AI Avatar v2 |
| video-to-video | LatentSync lip sync, MMAudio v2 video-to-audio (0221) |
| audio | ACE-Step, ACE-Step 1.5, MMAudio v2, ElevenLabs Sound Effects v2 |
| speech | Inworld TTS, ElevenLabs TTS Turbo 2.5, MiniMax Speech 2.6 HD, ElevenLabs Dialogue v3 |
| composite (flag-gated preview in the Studio) | Auto Short 32 s (110 cr), Clip Editor (1 cr/s; captions add 7 units), Video agent (165 cr, kept off the Create picker by its `plan_id` input, #697) |
| audio-to-audio | Demucs stems up to 120 s (6 cr; 0291) |
| chat (not on `/api/catalog`) | Llama 4 Maverick, Ministral 14B, Mistral Small, GPT-6 Luna, DeepSeek V4.1 Flash, Gemini 3.8 Flash, Claude Sonnet 5.5, GPT-6.1 Sol, Grok 4.7, Claude Opus 5.5 (activated by 0199, 0200, 0201, 0211) |

Counts: `/api/catalog` returned 33 rows on 2026-10-08 (32 on 2026-10-02: the
addition is MMAudio v2 video-to-audio). Since then the migrations activate two
more rows, `video-agent` (0234) and `demucs-stems` (0291; shown gated until
`EDITOR_AUDIO_STEMS_ENABLED`, on in production), so 35 are expected; the live
endpoint was not re-read on 2026-10-16 (unverified). The 10 chat rows are excluded from the
public catalog by `lib/publicCatalog.js`. Staged and inactive: five BytePlus
Seedance rows (ADR-0058), video upscale (0202), Kling 3.0 Standard text-to-video
(0232, a cost record the video agent buys from: not for sale on its own) and
Qwen 3 TTS Voice Design (0235, 6 cr, waits for a live check).

Prices live in `model_catalog.credits_5s`; the app never computes a price.
Providers: fal.ai, kie.ai, OpenRouter (Seedance video; chat through a separate
key), GrsAI (active), BytePlus (staged), Exa (capped Web search for chat),
plus the internal composites `veyrnox` and `montage` (the video agent runner). **The
provider is never shown to the user**; a chat reply names its model and price
only (ADR-0067).

### 3.4 Paying
- **Credit Packs** via **Stripe Checkout**, Stripe Managed Payments as
  Merchant of Record with Stripe-managed tax (ADR-0031): **100 for $10, 270 for $19,
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
  one the provider cuts off, or that never started, is refunded. A reply that
  was delivered but could not be stored is still charged (0233). A send the
  browser lost contact over is settled by its own key (0242,
  `CHAT_SEND_CLOSE_ENABLED` on in production). Replies never appear in the
  Library.
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
Metrics (`/app/admin`), user lookup and the account ledger, content
violations (3rd takedown Freezes), appeals, user reports, the webhook log,
and Cinema creator, submission, voting, comment, story-poll and ranking
review.

### 3.7 Veyrnox Publish (`/app/publish`) — on in production `wrangler.jsonc`
Pages under `/app/publish`: the composer and calendar, `analytics`,
`inbox` (with `contacts` and `workflows`), `smartlink`, `queues`, `autolists`
(RSS), `team` and approval requests, `reports`, `developer` (API keys and
webhooks), `ads`, `commerce`, `activity` and `plan`. Routes: `/api/v1/social/*`
for the signed-in user, `/api/publish/v1/*` for a scoped customer API key (120
requests a minute), and token-addressed review links under `/api/social/*`
(approvals, team invitations). Core behaviour: Post now or schedule one Library
asset or device upload to chosen accounts; weekly brand drafts need batch
approval; a post that was submitted to a provider is never sent twice (0260,
0287); a scheduled post can be cancelled and restored before the sweep claims
it (0311). Paid surfaces (inbox, team roles, API, reports, 366-day analytics)
follow a live Publish Plan ($15/month, 0293, `PUBLISH_RUNTIME_FLAGS.plans`).
`PUBLISH_UPLOADS_ENABLED` is `"false"` in production, so device uploads are
staging only. Only YouTube is recorded as live-tested end to end (staging,
2026-10-07); the rest is unverified against real accounts.

## 4. Built, not live

| feature | where it stands | gate |
|---|---|---|
| **Veyrnox Publish** (`/app/publish`; see §3.7 for the full surface): connect and publish to YouTube, LinkedIn, X and TikTok (released in production); built but unreleased in production: Instagram; tester-stage Facebook (Page), Threads, Pinterest (board), Bluesky, Twitch (statistics only) and Google Business Profile; compose one Library asset or a **device upload** + text + accounts + time, **Post now** or schedule; **calendar**, **analytics** and posting-time insights; weekly brand drafts | staging: a real YouTube video published and its analytics read (2026-10-07); production acceptance of the newer surfaces is not recorded (unverified) | production `wrangler.jsonc`: `PUBLISH_ENABLED`, `PUBLISH_ANALYTICS_ENABLED`, `PUBLISH_POSTING_INSIGHTS_ENABLED`, `PUBLISH_CALENDAR_ENABLED`, `PUBLISH_YOUTUBE_VISIBILITY_ENABLED` and every `PUBLISH_RUNTIME_FLAGS` key except `videoDestinations` are `"true"`; `PUBLISH_UPLOADS_ENABLED` and `PUBLISH_EXTENDED_NETWORKS_ENABLED` are `"false"` (both `"true"` on staging); `PUBLISH_SCOPE_FLAGS` (Instagram insights and engagement, Facebook engagement, TikTok analytics) all `"false"`. **Account limit in code:** one connected account on the free tier, five with a live Publish Plan (`lib/social/accountAllowance.js`, 0298); ADR-0063's 13 October amendment still says five free. Instagram insights and TikTok analytics scopes need provider app review; the extended networks have no real-account test or provider app approval |
| **Core subscriptions** (ADR-0064, UI ADR-0082) Starter $19/270, Plus $59/1,200, Ultra $129/3,000 monthly: Subscription Credit ledger bucket (0183/0184), subscription state (0186/0187/0189), Stripe checkout/read/return/cancel routes and webhook, the public offer on `/pricing` and the plan picker and management on `/app/credits` | database applied to production; routes, webhook and UI merged | `SUBSCRIPTIONS_ENABLED="false"` in production **and** staging; staging acceptance unchecked; Stripe's written acceptance and Finance/Legal wording outstanding |
| Chat **Deep research** (ADR-0070): one plan call, four searches, one write; +Credits on Claude Sonnet 5.5 | built (0208, 0214), runbook written | `CHAT_RESEARCH_ENABLED` is unset (off) and is not declared in `wrangler.jsonc` |
| Social Cinema: profiles, creator applications, drafts, Stream uploads (including a finished Library video, 0248), review with safety and malware gates (0294-0297), catalogue, player, free viewing | staging-verified 2026-09-28/29 | production `wrangler.jsonc`: `CINEMA_ENABLED`, `CREATOR_APPLICATIONS_ENABLED`, `CREATOR_CONTENT_ENABLED`, `SOCIAL_CINEMA_PROFILES_ENABLED`, `CREATOR_UPLOADS_ENABLED`, `CINEMA_PUBLISHING_ENABLED`, `CINEMA_VIEWING_ENABLED`, `CINEMA_FREE_CEILING_ENABLED` and the upload recovery and removal switches are `"true"`; `CINEMA_PROXY_UPLOADS_ENABLED`, `CREATOR_MONETISATION_ENABLED`, `CINEMA_UNLOCKS_ENABLED`, `CINEMA_SUBSCRIPTIONS_ENABLED` are `"false"` |
| Cinema paywall: 5 free episodes, 6-credit unlocks, Cinema Pass **monthly $9.99 as the only plan** (weekly $14.99 and yearly $199.99 withdrawn), 1,500-minute Pass ceiling and a 300-minute monthly ceiling on free viewing (0244, 0245; the CHANGELOG records both applied to production and staging, not re-read), 14-day cooling-off | built (0142–0144, 0244, 0245); staging unlock/publish/view flags on | `CINEMA_SUBSCRIPTIONS_ENABLED` and `CINEMA_UNLOCKS_ENABLED` `"false"` in production |
| Cinema community and discovery: qualified weekly votes (0266), moderator-approved comments (0267), story polls (0270), public discovery and winners (0277), private audience signals (0281), weighted weekly rankings (0282), saves and follows (0283), creator analytics (0284), curated free series embeds (ADR-0098) | built; acceptance pending (ADR-0081, 0084, 0085, 0087, 0089, 0090) | `VOTING_ENABLED`, `COMMENTS_ENABLED`, `STORY_POLLS_ENABLED`, `CINEMA_AUDIENCE_ENABLED`, `CINEMA_RANKINGS_ENABLED`, `CINEMA_RETENTION_ENABLED`, `CINEMA_CREATOR_ANALYTICS_ENABLED` all `"false"` |
| Projects: workspaces, versioned project document (v1, v2 timeline, v3 multitrack), autosave, history, media quarantine | live for documents in production (`TENANT_PROJECTS_ENABLED="true"`); media uploads staging only | `PROJECT_MEDIA_UPLOADS_ENABLED="false"` in production; the `localStorage.veyrnox_projects` switch is gone from `app/` |
| Auto Short | catalog row active | `localStorage.veyrnox_auto_short` |
| Clip Editor (captions are live, see §3.2; slow motion off in production) | catalog row active | `localStorage.veyrnox_editor` (Library edit cart), `CLIP_EDIT_SLOW_ENABLED="false"` |
| BytePlus Seedance (5 rows) | staged inactive, US blocked before debit | ADR-0058 Proposed |
| Jev provider-error classifier | built | `JEV_SUBMIT_ERRORS_MODE=off` (ADR-0066 Proposed) |

## 5. Decided, not built

| feature | decision | blocker |
|---|---|---|
| **Publish Plan** ($15/month for 366-day analytics history, best-time recommendations, the inbox, team roles and the other advanced Publish surfaces) | ADR-0062/0063 amendments, 2026-10-13 | **built, not decided-only**: 0293 with Checkout, Portal and webhook lifecycle, gated in the routes by the live plan; `PUBLISH_RUNTIME_FLAGS.plans` is `"true"` in production `wrangler.jsonc`; whether 0293-0326 are applied to production and the payment path accepted is not recorded (unverified). The free-tier account count in code (1) differs from ADR-0063's 13 October amendment (5) |
| **Subscription plan changes** (upgrade now, downgrade at period end, monthly-to-annual undecided); the pricing UI itself is built (§4) | ADR-0064 owner decisions 2026-10-03 | webhook acceptance on staging; the reviewed plan-change design (#508) needs a new migration |
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
from staging to production, the same-second pass-event fix (ISSUES S19), and
before `CINEMA_UNLOCKS_ENABLED` opens playback of paid titles the free
ceiling's staging acceptance and 24 hours of clean reconciliation (ADR-0057).

Publish: platform app reviews (Meta, TikTok, YouTube, and for the extended
networks administrator-owned developer apps, tester evidence and review),
TikTok DNS verification, Instagram release (not in `PUBLISH_RELEASED_NETWORKS`),
the Publish Plan's payment acceptance, token-key rotation runbook. (The YouTube
upload fix, #399, is done.)

Subscriptions: staging acceptance, Stripe's written acceptance of credit
subscriptions, tax and consent wording from Finance/Legal.

Video agent: nothing blocks it in the repo; what is not recorded is any run by a user other than the owner, and fal and Anthropic usage against the meter over time. Provider-resale terms and AGPL
use are recorded as the owner's statement in the ADR, not as counsel's.

## 8. How we know it works

- `reconcile_balances()`, `reconcile_free_credits()`, `reconcile_top_ups()`,
  `reconcile_failed_refunds()`, `reconcile_subscription_credits()`,
  `reconcile_free_allowance()` and `reconcile_referrals()` return zero rows —
  every 15 min snapshot (seven counts since 0264; each reading is kept in
  `private.reconciliation_observations`, 0290), hourly watch, the nightly cron,
  and after every money-spine change. ISSUES S20 records 0264 applied and all
  seven production counts zero (2026-10-10); the five-count reading of
  2026-10-08 is the last one this file saw directly.
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
