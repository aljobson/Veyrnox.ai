# Changelog

Notable changes to Veyrnox.ai, newest first, grouped by date merged to `main`. Numbers are pull requests. This is a curated summary: `git log --first-parent main` is the complete record, and [`docs/adr/`](docs/adr/) explains why decisions were made. To undo a change, find its PR here and revert that merge commit.

Changes that touch the money spine, the ledger or the catalog are marked **[money]**.

## Unreleased (2026-10-05)

### Added
- `model_catalog.chat_web_engine` (0212, ADR-0067 amendment 8): how a row's Web search runs, `plugin` (today) or `capped` (our own search with a fixed text length). Additive; every row reads `plugin`. Nothing a user sees changes
- Chat settings panel and a two-level model picker (ADR-0067 amendment 6): family then model, a Low/Medium/High cost filter, collapsible Capabilities, Tools, System prompt and About sections, Reset all and Open all; instructions can be written before the first message. `/api/v1/chat/models` now returns each model's family
- Five more chat models turned on (0210): DeepSeek V4.1 Flash, Gemini 3.8 Flash, Grok 4.7, GPT-6.1 Sol, Claude Opus 5.5. New chats open on the cheapest model
- Chat folders (0209, ADR-0067 amendment 5): group chats, move them in and out, rename or delete a folder (its chats stay). Up to 50 per person; `/api/v1/chat/folders`; a thread patch with `folder_id` moves a chat
- Chat, behind `CHAT_ENABLED` (off) and the browser preview switch `veyrnox_chat`: threads and messages (0193), `/api/v1/chat/*`, a streaming reply that is one job priced per reply from `model_catalog`, finished by `chat_complete_turn` or refunded, and a `/app/chat` screen. No text model is active until an operator verifies one (ADR-0067, Accepted) **[money]**

### Changed
- **[money]** Web search is re-priced on all ten chat models (0211, ADR-0067 amendment 7) from measured worst cases: the plugin's search text is uncapped (12k to 50k input tokens) and its fee is $0.01 to $0.05. A Luna reply with Web search goes from 3 to 5 Credits, a Sonnet one from 7 to 15. Held as a draft for the owner's decision
- `list_user_jobs` leaves chat jobs out of the Library (0193); the public catalog read excludes text models

## Unreleased (2026-09-29 to 2026-10-01)

### Added
- Subscription state and its ledger joins: plans, the subscription row, grant on a paid invoice, refund and dispute reversal, cooling-off; nothing calls them yet (ADR-0064, 0186, 0187) **[money]**
- Subscription Credit bucket in the ledger: spend order, cycle expiry, keyed grant; nothing grants yet (ADR-0064, 0183, 0184) **[money]**
- TikTok and YouTube async publish engine, ADR-0061 Phase 5 (#390)
- Veyrnox Publish composer and scheduling UI, Phase 4 (#389)
- GrsAI Nano Banana Pro editing, staged then activated after verification (#394, #396) **[money]**
- KIE Flux 1K option activated (#391) **[money]**
- Cinema upload security and staging acceptance (#379)

### Changed
- Docs: Inworld wholesale comparison units corrected (#397); GrsAI edit cost and staging verification recorded (#393, #395); next Nano Banana Pro edit supplier savings assessed (#392)

### In review
- Jev classifier for provider submit refusals, ships off, ADR-0066 (PR pending)
- YouTube resumable-upload auth, session restart and quota backoff (#399)
- Supplier volume quote pack (#398)

## 2026-09-28

### Added
- Veyrnox Publish: foundation (brands, accounts, connect API), Instagram, LinkedIn, X, TikTok and YouTube connect flows, scheduling engine and connect UI (#373, #375, #378, #380, #384, #385, #386, #387)
- Guarded Kling 3.0 production activation and kie Kling 3.0 image-to-video candidate (#372, #362) **[money]**
- KIE dialogue and Flux wholesale options staged (#382) **[money]**
- Owner-designated Cinema administrator provisioned (#371)

### Changed
- Instagram adapter ported to Instagram API with Instagram Login (#388)
- BytePlus verification costs corrected and wholesale blockers recorded (#381)

### Fixed
- Framework request bodies preserved across runtime boundaries (#368)

### Docs
- ADR-0061 Veyrnox Publish spec pack, ADR-0062 accepted, ADR-0063 and ADR-0064 drafted; OAuth app review runbook; provider readiness notes (#363, #365, #366, #367, #370, #360, #374, #376, #377)

## 2026-09-26 to 2026-09-27

### Added
- Cinema: publication slice with review queue, public catalogue and player (#349); viewer paywall (#344); title categories (#351); audited Operator reversal and refund routes (#353)
- BytePlus ModelArk adapter for Seedance, staged inactive, ADR-0058 (#347)
- Platform Customer compliance controls and content-violations admin UI (#348, #350)
- Project asset upload, inspection and download routes, with quarantine (#337, #339)
- Workspace and project management preview; project document autosave, history and restore (#335, #336)
- Landing preset wall rebuilt from real presets; video-ready landing tiles (#354, #358)
- Staging: Cinema Stream flags and cron enabled (#352)

### Changed
- Per-request nonce CSP applied across all HTML pages (#322)
- Library expiry notices prepared for all accounts, behind a rollout gate (#317)

### Fixed
- BytePlus rejects US generation requests before debit (#356) **[money]**
- Empty successful Stream deletion responses accepted (#359)

### Docs
- Competitor and wholesale pricing research, including the syntx.ai analysis, BytePlus cost levers and ADR-0057 (#340, #341, #342, #345)

## 2026-09-25

### Added
- Social Cinema foundation: profiles and roles, gated enrollment, creator applications and review, private drafts and series, gated resumable Stream uploads, upload recovery and provider-first removal (#323, #325, #326, #328, #329, #331, #332, #333)
- Tenant project foundation and isolated AI staging (#330)

### Fixed
- Workers tenant transport; staging project APIs activated (#334)

### Docs
- Cinema security baseline and release gaps (#327); Stripe billing completion evidence (#321)

## 2026-09-24

### Added
- Stripe recovery: return-URL backfill, reachable recovery path and alarm for lost webhooks, ADR-0033 (#279, #280, #281, #282) **[money]**
- Credit Packs shown to everyone; the `veyrnox_topups` flag removed (#169) **[money]**
- Account security controls and accessible modals (#314); authoritative, paginated credit and top-up history (#313)
- Per-account rate limits on generation attempts, uploads, account and balance reads, signed asset links, job reads, Top-up reads and returns, Stripe checkout, and admin edge traffic (ADRs 0034 to 0041; #285 to #306)
- Recovery freshness monitoring (#316); reserved upload capacity with immutable bounded PUTs (#312); fresh bounded reconciliation snapshots (#311)
- Admin dashboard requires a second factor and the Cloudflare Access assertion (#272, #273)
- Models activated or swapped for cost: kie Wan 2.5, Kling 2.6 Pro, Nano Banana Pro, Hailuo, GrsAI Nano Banana Pro, Sana, Veo twins (#270, #274, #278, #287, #289, #304, #308) **[money]**
- Retention deadlines shown in the Library (#284)

### Changed
- New sign-up grant reduced to 10 credits (#309) **[money]**
- Credit value matched at a 50 percent margin, with a separate Sana option (#297); Seedream 4 lowered from 3 to 2 credits on fal (#292) **[money]**
- Retired MuAPI routes removed at owner-requested early sunset (#228)

### Fixed
- Account isolation, bounded HTTP bodies and audit defects (#310)
- Signup faucet alert and provider content-type trust (#275); catalog no longer advertises models the picker will not sell (#276); kie content filter on for Wan 2.5 (#277)
- JWKS no longer trusted forever, refreshed hourly (#271)
- Library reads jobs from the server, not one browser (#266)
- Foreign-key lookup paths indexed (#315)

## 2026-09-23

### Added
- Stripe Checkout replaces LemonSqueezy, ADR-0031: adapter, order-id migration 0097, automatic tax on (#248, #249, #250, #252) **[money]**
- Passkey sign-in, ADR-0032 (#254)
- Sign in with Apple live, ADR-0030 (#246, #251)

### Fixed
- Failed jobs whose refund never landed are now paid and reconciled (0099, 0100) (#259) **[money]**
- Job steps are claimed before a provider is paid (0101) (#263) **[money]**
- Clip edits billed for their steps when they outrun their length (#262) **[money]**
- Expired assets are actually deleted from R2 (#260)
- Client-supplied media URLs are never accepted as model sources (#258)
- Disputes arriving before the credit they dispute are retried (#256)
- Production deploy gated on CI; fal drift alarm can fire (#261)
- Signup gate now actually checks CAPTCHA (#247)

## 2026-09-22

### Added
- Model capability registry; gateway builds provider requests from it, ADR-0027 (#213, #214)
- Browser start-image uploads straight to R2, ADR-0028 (#217)
- Auto Short: step records, orchestrator, script and captions, webhook wiring, sweep, topic box, catalog row (#225 to #237) **[money]**
- Clip Editor: orchestrator, library selection and edit sheet (#235, #240, #243)
- Background generation with completion notices (#234)
- New models: Nano Banana Pro, ElevenLabs TTS and dialogue, MiniMax Speech, MMAudio, Bria, Topaz upscale, lip sync (#216, #220, #222, #224, #239) **[money]**
- Character builder for image models; Cinema camera controls; ParticleButton (#229, #219, #242)
- Consent statement on uploads and Acceptable Use Policy (#245)

### Fixed
- Pricing leaks: Wan 2.5 and Kling payloads that billed above the priced tier (#209 to #212) **[money]**
- Fonts self-hosted so deploys never fetch Google Fonts (#232)

## 2026-09-20 to 2026-09-21

### Added
- Turnstile CAPTCHA on sign-up and sign-in, ADR-0026 (#194)
- Veo 3.1 on kie, Nano Banana on kie (#191, #199, #201, #206) **[money]**
- Asset bytes hashed at ingest (0077) (#193)
- Face-filter upload spine and spec set (#187, #188); account menu in the nav (#196)

### Fixed
- Breached-password message and widget token handling (#197, #198)
- Audit low tier cleared (#189)

## 2026-09-13 to 2026-09-16

### Added
- Credit Pack Top-ups end to end: LemonSqueezy checkout, history, credit on payment, refund clawback, chargeback and dispute freezes, backfill and reconciliation, ADR-0018, ADR-0019 (#92 to #98, #111, #120, #126, #127, #131, #137, #150) **[money]**
- Free Credit expiry and spend-free-first, ADR-0013 (#109) **[money]**
- kie.ai and OpenRouter providers; Seedance and fal audio models; Veo clips pinned to 4 seconds (#110, #114, #153) **[money]**
- Generated media moved to the EU-jurisdiction R2 bucket, ADR-0021 (#116)
- Production deploys serialised through GitHub Actions; production migrations applied by one approved workflow, ADR-0023 (#158, #166)
- SEO (robots, OG card, JSON-LD), mobile pass, theme toggle and search (#185, #186)

### Fixed
- Security audit findings: signup faucet, table grants, MFA, timeouts, admin throttle, XSS-sink gate (#182, #184)
- Audio results play instead of rendering a broken image (#160)

## Before 2026-09-13

Foundations: Phase 0 decisions (ADR-0000 to ADR-0006), the money spine (ledger, jobs, catalog, webhooks) and Supabase Auth on EU Postgres. See [`docs/PHASE-1.md`](docs/PHASE-1.md) and `git log`.

## Keeping this file current

Add an entry in the same PR as the change, under **Unreleased**. Use Added, Changed, Fixed or Docs, link the PR, and mark money-path changes. At the end of a day or release, move the entries under a dated heading.
