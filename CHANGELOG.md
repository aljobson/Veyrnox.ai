# Changelog

Notable changes to Veyrnox.ai, newest first, grouped by date merged to `main`. Numbers are pull requests. This is a curated summary: `git log --first-parent main` is the complete record, and [`docs/adr/`](docs/adr/) explains why decisions were made. To undo a change, find its PR here and revert that merge commit.

Changes that touch the money spine, the ledger or the catalog are marked **[money]**.

## Unreleased (2026-10-05)

### Added
- Landing film: fifteen seconds of the product's own screens under the hero (the Generate button and its price, two jobs, the statement that records them, the price list). Drawn in code and captured frame by frame (`scripts/landing-film`), not model output. Muted, about 610 KB, fetched only when half of it is on screen, with a Play/Pause button; it does not start by itself under reduced motion, data-saver or a slow connection on touch. Its prices are baked into the frames, so `tests/landingFilm.test.mjs` fails when one stops matching the landing list, or when the film's source changes without a new render. No server change, no migration.
- **[money]** Qwen 3 TTS Voice Design staged inactive (0235): speech in a voice the user describes in words, on fal at $0.09 per 1,000 characters, 6 Credits. The Studio shows a required Voice box for a model whose capability record takes `voice_description`; no reference audio is accepted. Nobody can pick or buy it until a separate activation migration, after one live generation confirms the audio length and fal's bill.
- Ask about this, on each Library image: opens LLM Chat with that image attached (`/app/chat?asset=<job id>`), checked as the person's own and size-checked like From library. Images only, because chat reads images. No server change, no migration.
- A video can be attached to a chat as a few frames (ADR-0068 amendment 3): the paperclip also takes an MP4, WebM or MOV, and the browser takes up to four still frames from it. The video itself is never uploaded; each frame is an ordinary image with the same price, limits and one-day deletion. No server change, no migration.
- Studio skills (ADR-0073): eight built-in assistants on the LLM Chat start page (Prompt writer, Model picker, Fix this photo, Edit with words, Bring it to life, Add sound, Storyboard, Fix my prompt), also linked from the Studio's prompt box. A skill is instructions plus the live Studio model list, started like a Persona on GPT-6 Luna (1 Credit). Its result is an Open in Studio card, checked against the live catalog and priced from it; nothing is charged until the person presses Generate in the Studio. No migration.
- Chat can use your own Library images (ADR-0068 amendment 2): a From library button in the composer attaches a finished image you already made, sent by job id and checked as yours before any Credits move. A Library image is recorded under `source_assets`, never `source_keys`, so the upload sweeper cannot delete it. Priced as one Images extra, up to four images, 2,048 px cap said up front. No migration.
- Capped web search (ADR-0067 amendment 8): our own search call (Exa) with each result cut to 2,000 characters and at most 3 results, run before any Credits move, used when a row's `chat_web_engine` is `capped` and `EXA_API_KEY` is set. A failed or empty search is a typed refusal with nothing charged. No row is flipped yet, so nothing a user sees changes. `scripts/measure-capped-search.mjs` measures the real fee
- `model_catalog.chat_web_engine` (0213, ADR-0067 amendment 8): how a row's Web search runs, `plugin` (today) or `capped` (our own search with a fixed text length). Additive; every row reads `plugin`. Nothing a user sees changes
- Chat settings panel and a two-level model picker (ADR-0067 amendment 6): family then model, a Low/Medium/High cost filter, collapsible Capabilities, Tools, System prompt and About sections, Reset all and Open all; instructions can be written before the first message. `/api/v1/chat/models` now returns each model's family
- Five more chat models turned on (0211): DeepSeek V4.1 Flash, Gemini 3.8 Flash, Grok 4.7, GPT-6.1 Sol, Claude Opus 5.5. New chats open on the cheapest model
- Chat folders (0210, ADR-0067 amendment 5): group chats, move them in and out, rename or delete a folder (its chats stay). Up to 50 per person; `/api/v1/chat/folders`; a thread patch with `folder_id` moves a chat
- Chat, behind `CHAT_ENABLED` (off) and the browser preview switch `veyrnox_chat`: threads and messages (0193), `/api/v1/chat/*`, a streaming reply that is one job priced per reply from `model_catalog`, finished by `chat_complete_turn` or refunded, and a `/app/chat` screen. No text model is active until an operator verifies one (ADR-0067, Accepted) **[money]**
- Library: every finished card has a Download link. The card already said "Save a copy before then" and offered no way to do it. It asks `GET /api/v1/jobs/:id/asset?download=1`, which signs a 15-minute link the browser saves instead of showing, after the same ownership check and the same request quota as a normal file link.

### Changed
- **[money]** Web search switches to the capped search and is re-priced from a live measurement (0220, ADR-0067 amendment 8): Exa charged a flat $0.007 a search, so most models are +1 Credit, the Sonnet class +2 and Opus +3. Engine and price change in one statement. Held as a draft until the capped search code is deployed and `EXA_API_KEY` is set
- **[money]** Web search is re-priced on all ten chat models (0212, ADR-0067 amendment 7) from measured worst cases: the plugin's search text is uncapped (12k to 50k input tokens) and its fee is $0.01 to $0.05. A Luna reply with Web search goes from 3 to 5 Credits, a Sonnet one from 7 to 15. Held as a draft for the owner's decision
- `list_user_jobs` leaves chat jobs out of the Library (0193); the public catalog read excludes text models

### Fixed
- Studio: Auto Short's Topic box no longer starts with the video starter prompt either. With the preview switch on, the box is empty until the person types, keeps its "A topic for a 32-second short…" line, and Generate waits for a topic. Before, pressing Generate there asked for a 110-Credit short about "A neon-lit Tokyo alley at 3am…". Typed text, or a prompt handed over from a landing page, is never cleared or replaced. Image and video models are unchanged. No new wording, no server change, no migration.
- Chat: when a reply ran to its end, was charged and could not be saved to the chat, "We could not save that reply to the chat. You received it, so its Credits were used." now stays on screen if the chat list fails to load straight after. The list was read after the notice was set, and a list read that fails says so over whatever notice is there: the person was left with the list error in its place until the chat was opened again. The list is now read first, as it already was after Stop, after a dropped connection and after a reply that failed. The notice was always kept with its chat, and nothing was charged wrongly. Browser only: no server change, no migration.
- Studio: a music or sound-effect model no longer starts with the video starter prompt in its box either (the speech entry below had left them as they were). On ACE Step, ACE-Step 1.5, ElevenLabs Sound Effects and MMAudio v2 the box is empty until the person types, says "Describe the sound or music…", and Generate waits for a description. Before, pressing Generate there bought audio about "A neon-lit Tokyo alley at 3am…" for 1 to 3 Credits. Text the person typed, or a prompt handed over from a landing page, is never cleared or replaced. Image, video and speech models are unchanged. No server change, no migration.
- **[money]** ACE-Step's recorded provider cost is corrected from $0.0100 to $0.0120 (0236, ADR-0014 update of 2026-10-09): fal lists $0.0002 per second and we pin a 60-second track. The price stays 1 Credit; the margin at the reference rate reads 63.6%, not 69.7%. From fal's published rate, not a fal invoice. Nothing a user sees changes.
- Studio: a speech model no longer starts with the video starter prompt in its box. On Inworld TTS, ElevenLabs TTS Turbo, MiniMax Speech and ElevenLabs Dialogue the box is empty until the person types, says "Type the words to say…" (Dialogue keeps its own example), and Generate waits for words. Before, pressing Generate there bought audio of "A neon-lit Tokyo alley at 3am…" for 2 to 7 Credits. Text the person typed, or a prompt handed over from a landing page, is never cleared or replaced. Image, video, music and sound-effect models are unchanged. No server change, no migration.
- **[money]** Chat: pressing Stop or closing the tab now ends the reply at once and settles it, text so far kept and charged or nothing produced and refunded (ADR-0067 amendment 10). The Worker is told about a disconnect (`enable_request_signal`) and the turn's finishing work is handed to `waitUntil`. No migration.
- **[money]** An uploaded audio or video source is measured by what a decoder plays, not by what its header says (ADR-0028, amendment of 2026-10-09). A file whose header understated its length passed the length cap and was priced as short; a fragmented MP4 read as 0 seconds. WAV, MP3 and MP4 are now measured from their samples, and a file that cannot be measured is refused with `source_length_unknown` before any debit.
- Chat: signed out, `/app/chat` now says "Sign in to use LLM Chat" with a Sign in button, where it said "LLM Chat is not open yet. There are no chat models available right now." A first load that fails for another reason says "LLM Chat did not load" with a Try again button, where it said the same thing.
- Chat: a reply that ends while you are reading another chat, or have pressed New chat, no longer pulls you back to the chat it was sent in, and its message and notice no longer land in the chat on screen. The reply is in its own chat when you open it. A message that is given back waits in that chat's box with its notice, or under New chat when that chat was removed. Nothing in the other chat says the reply ended; a notice that is waiting is lost if the page is reloaded (the message is not); images attached to a message that is given back this way are dropped. Sending moved out of `ChatWorkspace.js` into `useChatSend.js`.
- Chat: a notice about a message is now kept with its chat, so it is still there after the page is reloaded. Until now a message that was given back to the box survived a reload and its notice did not: after Stop before any text, the box could hold the message with nothing saying that the first send might still be saved and use Credits (this ends "a notice that is waiting is lost if the page is reloaded" in the entry above). The notice is stored in this browser beside the unsent text, as a code, and put into words each time the chat is opened. It stays until a message is sent from that chat, the chat is deleted, or the session ends. A refusal before a reply started is kept the same way. No server change, no migration.
- Chat: a warning that a message may still be saved and use Credits is no longer lost when the next message from that chat is refused before it starts (not enough Credits, sending too quickly, an image that did not upload, a chat that could not be made). The refusal used to take the warning's place: after Stop before any text and a refused second Send, a page reload showed the message back in the box with nothing saying its first send might still be saved and use Credits. Such a warning is now forgotten when the next message is known to have gone out (its reply starts, after the debit), not when Send is pressed; any other notice still goes at the press. A message that is refused leaves such a warning kept, and the screen says both, the refusal first ("Before that: ..."); the warning is what the chat shows when it is opened again. Browser only: no server change, no migration.
- Chat: the same warning is no longer lost when the next message from that chat starts and then ends with nothing charged (Stop with the reply failed and refunded, a dropped connection with nothing kept, a reply that failed). The warning was forgotten as that reply started, so the message came back to the box with "No Credits were used", or with nothing after Stop, and nothing said its first send might still be saved and use Credits. Such a warning is now forgotten only when a later message is saved to the chat (which shows it and its price) or ends with a warning of its own, not when its reply starts (this changes "its reply starts, after the debit" in the entry above). An ending with nothing charged leaves the warning kept and the screen says both, the ending first; Stop with nothing kept, which says nothing on its own, says "Stopped. Nothing was saved and no Credits were used. Your message is back in the box." before it. A page reloaded while a reply is arriving still shows the warning. Browser only: no server change, no migration.
- Chat: a warning that a message may still be saved and use Credits now goes when the server says that message has settled. It used to stay until a later message from that chat was saved: after Stop before any text, a reply that was refunded a few seconds later left "If a reply is still saved, it will show in this chat and use Credits" beside the given-back message for good, through any number of later sends that were refunded. The reply's job id is now kept with the warning in this browser, and when the chat is opened, a page reload included, that job is read before the chat is. Failed and refunded: the warning goes and the message stays in the box. Saved after all: the chat shows the reply and its price, the warning goes, and after Stop before any text the message is taken out of the box if it is unchanged, with "A reply was saved after you pressed Stop" said in its place. Charged but not stored: the warning becomes the one that says so. Still running, failed with the refund not yet in, or a read that failed: nothing changes. Stop before the reply started has no job to ask, so that warning stays as before, and so does a warning that took the place of another warning (two messages in a row that were not settled): one job cannot answer for both. Browser only: no server change, no migration.

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
