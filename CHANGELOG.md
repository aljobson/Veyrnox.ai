# Changelog

Notable changes to Veyrnox.ai, newest first, grouped by date merged to `main`. Numbers are pull requests. This is a curated summary: `git log --first-parent main` is the complete record, and [`docs/adr/`](docs/adr/) explains why decisions were made. To undo a change, find its PR here and revert that merge commit.

Changes that touch the money spine, the ledger or the catalog are marked **[money]**.

## Unreleased (2026-10-05)

### Added
- Low-balance warning for the prepaid providers: `provider-balances` reads the fal.ai, kie.ai and OpenRouter balances hourly through each provider's own read-only endpoint (`scripts/check-provider-balances.mjs`) and opens one `provider-balance` issue when one is at or under its floor, or could not be read (never a pass). Off until the owner adds three read-only keys as Actions secrets and sets `PROVIDER_BALANCE_WATCH_ENABLED`; floors are repository variables. The report never prints a balance (the repo is public). GrsAI documents no balance endpoint and is not covered. A kie submit refused for funds (documented code `402`) is now recorded as `provider_payment_required`, like OpenRouter and BytePlus; the refund is unchanged. Runbook: `docs/operations/provider-balances.md`. No server change, no migration.
- Social Cinema: a monthly ceiling on free viewing, behind `CINEMA_FREE_CEILING_ENABLED` (off in production and on staging until 0245 is applied there; 0245, ADR-0057, paywall plan P6). An account gets `cinema_prices.free_ceiling_minutes` (300 proposed, the owner confirms) of free titles per calendar month. A play start counts one minute and the player's heartbeat counts the rest, in the append-only `cinema_free_plays`. At the ceiling a free title is locked with reason `free_ceiling`, no playback token is signed and the watch page says so; a Cinema Pass holder plays it under the Pass instead. With the switch off the routes call the same functions as before. No credits move. The migration is not applied.
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
- Staging carries the production controls that are vars: the six `*_RATE_LIMIT_ENABLED` switches and `ADMIN_REQUIRE_AAL2` are now named in `env.staging.vars` (audit 2026-10-09, S-02). Wrangler does not inherit `vars` into an environment, so on staging the Top-up, account-read and upload limits were off and the admin routes took a session without a second factor. `tests/stagingControlVars.test.mjs` keeps the two blocks aligned. Takes effect on the next staging deploy; production is unchanged. No migration.
- Form fields have a visible outline (WCAG 1.4.11): inputs, textareas and selects take a new `--vx-field` colour, 3.1:1 or more against the field and against the card behind it in the dark, light and paper palettes. They had the hairline (1.2 to 1.6:1) on a fill within 1.1:1 of the card, so the outline was the only sign a field was there. Sign-in, the hero price slip's prompt box, the studio prompt and its panels, the Clip Editor. Cards, chips and buttons keep the hairline, and so does the slip's "more models" select, which is drawn as a chip.
- Library clips no longer loop from the moment the page loads (WCAG 2.2.2): they follow the landing tiles' policy through one shared hook (`_lib/useClipPlayback`). Hover or keyboard focus on a card plays its clip, touch plays the one on screen for at most 5 s, and reduced motion or data-saver leave a still frame.
- Phone layouts, three public surfaces (follow-up to the design pass; previews stay whole and keep their own shape, as #802, #806, #809, #814 and #817 decided). Home: the five feature tiles under the hero are one swipe row below `sm` (each tile 72% of the width, top-aligned, snapping to the gutter) instead of a stack, 3,076px down to 516px at 375px wide; unchanged from `sm` up. Template gallery (`/presets` and the signed-out `/app`): the filter chips are one scrolling row below `sm` instead of four wrapped rows, 180px down to 39px; they wrap again from `sm`. Template page: in one column (below `lg`) the category, name, model and "You add" note come before the preview, so the title is at 232px instead of 572px to 988px; the preview carries the same "Viral inspiration" / "Generated on Veyrnox" badge as the tiles, now one shared `ClipBadge`. The two-column desktop layout measures the same as before at 1440px. No copy, price or server change.
- **[money]** Cinema Pass, proposed and not applied (ADR-0057, 2026-10-10; migration 0244): the monthly Pass becomes $9.99 (was $49.99) and the only plan on sale, the weekly ($14.99) and yearly ($199.99) plans are withdrawn, and the Pass viewing ceiling becomes 1,500 minutes a month (was 3,000). A 30% creator share is recorded as the intended share, with no code and no payout. No Pass is on sale (`CINEMA_SUBSCRIPTIONS_ENABLED` is off in production and unset on staging), so nobody is repriced. Applying 0244 is now a precondition of that switch (paywall plan P7).
- The public pages read as one site: one nav, two page-title sizes, one left edge. **Nav:** every public page, the home page included, takes `MarketingNav` (the home page's own `WideNav` is gone). The links run from the logo in one order: Explore, Models, Templates, Tools, LLM Chat, Pricing, FAQ, Social Cinema. The home page used to lead with Social Cinema, a page that says it is not open yet, and every other page had a different, centred list with a Home link (the logo is the Home link). Explore, Models and FAQ are sections of the home page and open it at that section from any other page. **Titles:** 52/76/92px for a page that lists or sells (pricing, models, templates, tools, guides, the 404) and 40/56px for a page about one thing (a model, a template, a guide, a legal page, Social Cinema and its pages), as `.vx-title-index` and `.vx-title-detail`; there were ten sizes. On the home page the hero line keeps 52/76/92 and the closing line comes down from 112px to match it, so nothing there is set larger than the hero. The home page's own title, the sentence in the video panel, keeps its 36/48/64: at the detail size its longest word does not fit a 320px phone. **Left edge:** a model page, a guide, the guides list, a template and the Social Cinema pages keep their reading width but no longer centre it, so their headings start under the logo (they began 100 to 200px to its right); the loading skeleton sits on the same edge, where it was centred. The word "premium" beside a gated model is one style (`PremiumTag`; it was three), and every large panel is `rounded-2xl`, a tile's focus ring included. The design-system page's type rows show the two title sizes. `tests/publicPageConsistency.test.mjs` pins each rule. No wording changed, no server code, no migration.
- Design pass over the public pages, the sign-in dialog and the shared controls, from an audit against the installed design skills (interaction polish, motion, accessibility, visual hierarchy). Dialogs and the mobile menu now fade in as the design-system page has always specified, and the phone edit sheet slides up; an opened FAQ answer grows instead of snapping; nav anchors (`/#faq`) scroll smoothly; pressing a tile, the hero's Generate and any shared `Button` gives feedback. Chrome icons are drawn (SVG) in place of Unicode glyphs that turn into colour emoji on phones. The footer's models run as a band under the short columns, not a fifth column 1,000px tall. The model and template pages carry the price on their button, and the model page's button sits above its facts. The brand focus ring applies everywhere, including the sign-in dialog and the legal pages. No copy in a legal or compliance block was changed, and no server code.
- Social Cinema: a monthly ceiling on free viewing minutes per account is now a written precondition of switching `CINEMA_UNLOCKS_ENABLED` on in production (ADR-0057, 2026-10-09; paywall plan P6). That switch also opens playback of free titles, and only Cinema Pass viewing is counted. Nothing is built and no behaviour changes: the switch stays `false` in production. Docs and a comment beside the flag only. No migration.
- **[money]** `CHAT_SEND_CLOSE_ENABLED` is on in production (ADR-0067 amendment 11): migration 0242 is applied, so the chat screen can now settle a warning about a message that was stopped before its reply started. Its send is asked about by its own key; one that made no job is closed, and a closed key can never be charged. Staging has it on too: 0242 was applied there the same evening.
- **[money]** Web search switches to the capped search and is re-priced from a live measurement (0220, ADR-0067 amendment 8): Exa charged a flat $0.007 a search, so most models are +1 Credit, the Sonnet class +2 and Opus +3. Engine and price change in one statement. Held as a draft until the capped search code is deployed and `EXA_API_KEY` is set
- **[money]** Web search is re-priced on all ten chat models (0212, ADR-0067 amendment 7) from measured worst cases: the plugin's search text is uncapped (12k to 50k input tokens) and its fee is $0.01 to $0.05. A Luna reply with Web search goes from 3 to 5 Credits, a Sonnet one from 7 to 15. Held as a draft for the owner's decision
- `list_user_jobs` leaves chat jobs out of the Library (0193); the public catalog read excludes text models

### Fixed
- "Skip to content" skipped nothing (WCAG 2.4.1, 1.3.1): `<main>` wrapped the nav and the footer, so the link landed above the nav, no page had a banner landmark and the home footer was not a contentinfo one. `<main>` is now each page's own content (`_components/Main.js`, exactly one per page, held by a test), the nav bars are `<header>` and the footer follows `<main>`. On studio pages the first Tab also went past the skip link and the tabs before the current one, because the nav called `scrollIntoView()`, which moves where Tab starts; it scrolls its tab strip by hand.
- Account menu: cancelling "Sign out?", or pressing Escape with the list open, dropped keyboard focus to the top of the page, and the list claimed `role="menu"` with no arrow keys. Focus returns to the account button, and the list is plain links and a button behind `aria-expanded`.
- Smaller accessibility fixes from the 2026-10-09 audit. The password field was read out as "Password Show password At least 8 characters.": one label wrapped the button and the hint. Toggles changed their name and their state together ("Hide password, pressed"): the Library's Favourite and Add to edit and the phone's Menu keep one name, and Show password keeps its changing name with no pressed state. The studio's Cinema camera and Character switches were named only ON or OFF. A pressed chip looked like an unpressed one in forced-colours mode. A control reached with Shift+Tab could land under the sticky nav (5 of 32 stops on Pricing); `scroll-padding-top` on the page replaces the `scroll-margin` on every anchor.
- The Turnstile check in the sign-in dialog takes the site's theme (ADR-0026 amendment 6). It followed the operating system, so anyone whose system is set to light saw a white box in the dark dialog. Appearance only: how and when the check runs is unchanged.
- A link to a section of the home page (`/#faq`, `/#models`, `/#explore`) often left the visitor at the top of the page: the home page is rendered per request and arrives behind its loading state, so the section is not there yet when the browser looks for it. On the live site two whole-page loads of `/#faq` in five stayed at the top. The page now goes to the section itself once it is there (`SectionJump`), from the top of the page only, so a reader who has scrolled is not moved. This is the path the nav's Explore, Models and FAQ take from every other page, and the one search's FAQ results take.
- On a window between 1024 and about 1200px wide the home page's eight nav links ran under the search box. The links now show from 1280px on every page; below that they are in the menu, with the theme switch.
- The search box's dark backdrop covered a 108px strip under the nav and left the page lit behind the panel; the mobile menu's backdrop was 0px tall, so tapping outside it did nothing. The nav's backdrop blur makes it the containing block for `fixed` children. Search is now a native modal (top layer, focus contained, focus handed back on close) and the menu backdrop has its own height.
- Two models printed under one name: "Nano Banana Pro Edit" at 10 cr and at 2 cr on the landing price list and `/models`, and "MMAudio v2" twice in the footer, with both model pages sharing a title. A list that holds both now keeps the full name on the ones that collide (`distinctShelfNames`).
- On a phone the storage notice had grown taller than the fixed offset of the floating buttons, so the Contact button sat half under it. The buttons and the notice are one bottom stack; on a phone Back to top waits until the notice is dismissed.
- The sign-in dialog could not be scrolled on a short screen (its top and bottom ran off a 667px phone), its close button was about 12 by 20 pixels, and the Turnstile box overhung the fields by a few pixels at 375px wide.
- iOS Safari zoomed the page on focusing any field under 16px (the hero prompt, sign-in, search). Fields are 16px on touch devices.
- A mouse press on a tile never showed (the hover rule outranked it), and the hero's press scale snapped (a Tailwind `transition-colors` dropped `transform` from `.vx-press`). The studio's Generate button stayed shrunk for a second after every click.
- Tile captions sat on a scrim that shrank with the tile: on a phone's small thumbnails the amber price was at 1.5 to 2.8:1 over a bright poster. The scrim is a fixed band now.
- Destructive buttons were white on coral at 3.06:1 in the dark theme; they take a dark ink (`--vx-danger-ink`), as the teal and amber buttons do. The announcement bar's focus ring was teal on near-white; a hidden back-to-top button still took a Tab stop; the template page's prompt panel used a colour that does not exist (`vx-raised`); the fourth credit pack sat alone on a second row; the statement example cut the word "refund" off on a phone; a studio submit error was not announced to screen readers.
- **[money]** Chat: two endings of a send no longer end as "sent" with nothing said (ADR-0067 amendment 14). A replay: the server answers that it already holds a job for the send, which happens when the browser sent the request again by itself after its connection died and the first copy had reached the server, where it was debited and usually refunded, sometimes saved and charged. The screen read the chat again, said nothing, forgot a warning kept for the message before, and a refunded message was left in neither the chat nor the box. And a reply stream that ended cleanly after it started with no `done`, which was taken for a finished reply. Both are now looked for by their job at once (the replay answer names it; `start` brought the other) and end as a stream that broke does: saved shows the chat and says so, refunded gives the message back with "no Credits were used", and a replay that is not settled in time gives the message back with "The connection dropped before the reply finished. It may have used Credits. Check this chat before you send again." kept beside it, on screen and after a reload. A warning kept for the message before now goes only when this message was found saved or keeps a warning of its own. Browser only: no server change, no migration, no new wording
- **[money]** Chat: a message whose request got no answer before the reply started is no longer given back to the box as "not sent" with nothing said about Credits (ADR-0067 amendment 13). The request can be at the server all the same, which treats the missing reader as Stop, debits, and can still save a reply and charge it. The screen now asks the server about that send by its key at once, with the question it asks at Stop (`POST /api/v1/chat/sends/close`). No job, and the key closed: it never started, as before. A job that settles within the look: it ends as a stream that broke does. Nothing final (still offline, the route refusing, an answer slower than 2 seconds, a job not settled in time): the message goes back with "The connection dropped before the reply finished. It may have used Credits. Check this chat before you send again." kept beside it, on screen and after a reload, also when the chat page was left, and a chat made for the message stays; opening the chat later settles it. Refusals, failed uploads and Stop are unchanged. Browser only: no server change, no migration, no new wording
- **[money]** Chat: a message stopped before its reply started is asked about at the moment of Stop (ADR-0067 amendment 12). Its send is asked about by its own key as soon as Stop is pressed. A send that never reached the charge is closed at once: the text is back in the box with no warning, where the chat used to say "If a reply is still saved, it will show in this chat and use Credits" until it was opened again. A send that did make a job is looked for by that job, as after the reply has started. With no answer (a refusal, a failed request, more than 2 seconds) the warning is kept as before. Browser code only: no route, migration or switch.
- **[money]** Chat: a warning that a message may still be saved and use Credits can now be settled when the browser has no job id for it (ADR-0067 amendment 11, migration 0242). Stop before the reply started: the send's own key is kept with the warning, and `POST /api/v1/chat/sends/close` answers with the job that send made or, when it made none, closes the key so no reply can ever be charged for it. A warning that took the place of another now keeps every message it stands for (four at most, then none), each by its job id or its key, and is asked about only as a whole: nothing changes until every one of them is settled, and when they settled differently the chat says so. Their list is stored beside the notice, so a page still on older code reads the same warning. A closed key is refused by a trigger on `jobs`, for chat replies only, so the debit that would have made the job is undone whole. Asking by key is behind `CHAT_SEND_CLOSE_ENABLED` (off): until 0242 is applied and the switch is on, a warning for a message stopped before its reply started stays as it did. A warning for several messages that all have job ids is settled by job reads as soon as this deploys. `GET /api/v1/jobs/:id` and the new route share one job-state mapping (`lib/jobState.js`).
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
