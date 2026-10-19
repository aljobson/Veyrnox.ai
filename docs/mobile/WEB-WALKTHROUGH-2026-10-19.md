# Web walkthrough, mapped to the phone

**Status:** Recorded 2026-10-19 by reading the live web app in the built-in browser pane, signed in as the owner (a free-tier account: 44 credits, 13 assets, one connected TikTok account, two-factor on). Read-only: no Generate, purchase, post, disconnect or any other submit was pressed. Pages that load after first paint were read after a short wait.
**Reads with:** [PARITY-2026-10-19.md](PARITY-2026-10-19.md) (feature inventory from the code), [USER-JOURNEY-2026-10-19.md](USER-JOURNEY-2026-10-19.md), [spec/APP-FLOW.md](spec/APP-FLOW.md). This file records what a person actually sees; the others came from code.
**Not covered:** a title page, the watch page, video playback, the Create "Settings" and "Cinema camera" panels, individual model pages, Enhance, SmartLink and Publish plan pages, and any state that needs a paid plan. Nothing here was run on a phone.
**Agent Reach:** the skill routes search and social platforms and has no adapter for driving a first-party signed-in app, so it was not used for the walk.

## 1. What the signed-in web app is

A top bar of studio areas: **Explore, Create, Library, Oddlings, Video agent, LLM Chat, Film Studio, Video editor, Projects**, with a balance chip (`44 cr`) that opens Credits and an asset count (`13 assets`) that opens Library. A "Browse" menu and the avatar menu sit to the right. **Vey**, the mascot, is a draggable character on every page. A "Privacy choices" control sits bottom left. Publish and Social Cinema are separate areas reached from menus and the public site, not from the studio bar.

## 2. Area by area

| Web area (route) | What a person sees | Notes that matter on a phone |
|------------------|--------------------|------------------------------|
| **Explore** `/app` | "Explore presets": an Oddlings banner, an LLM Chat card, category chips (All, New, Your photo, Kids birthday, Cinematic, Anime, Cartoons, Movies, Fantasy, Realistic, Fashion, Products, VFX, UGC, Ads), then 110 template cards. Each card names the model, length and price (for example 68 cr) | Cards open Create filled in. Prices are on the card, before any commitment |
| **Create** `/app/create` | "What do you want to make?" with three goals (image, video, audio) plus All models; a live price list sorted LOW / MEDIUM / HIGH with a free option marked "FREE · 3 left"; image count 1 to 4; tabs START, SETTINGS and CINEMA CAMERA; total cost and balance; a "Generate" button showing the cost; "Refund on failure, always"; a restored draft note; a Studio skills nudge; an Oddling Studio card | One screen does model choice, prompt, source media and price. The draft is saved per tab and restored |
| **Library** `/app/library` | "Everything you've made": filters (All, Succeeded, Running, Queued, Failed; All types, Images, Video, Audio, Favourites), Grid and List, an "On this device" strip of originals kept in the browser only, and per item: status, prompt, model, age, cost, favourite star, **Schedule this**, Download, Report, and "File expires 9 Jan 2027, save a copy". A failed job shows "FAILED, REFUNDED" with the refund | Files expire after about 90 days. Originals on the device are not synced. Schedule this hands the file to Publish |
| **Oddlings** `/app/oddlings` | A character builder: kind, exaggeration, gender, adult age, heritage, hair, outfit, body, many size controls, voice, recurring show, a prompt preview, Save passport, then a gallery of 72 original characters and free dancing previews | Client-side; the gallery and sheet are image-heavy |
| **Video agent** `/app/video-agent` | Three steps: write a brief with a shape (9:16, 16:9, 1:1), check the plan and exact price (planning is free), approve. Optional exact narration | Credits are taken once, on approve. It runs for minutes and keeps going if you leave |
| **LLM Chat** `/app/chat` | A thread list with search, folders, pin, rename, delete; a model picker with a price per reply (from 1 to 7 credits); options Standard or Thinking (+1) and Web (+1); a Library attach; Studio skills (Prompt writer, Bring it to life, Fix my prompt, Fix this photo, Edit with words, Add sound, Model picker, Storyboard) and seven Film skills; stop and keep what arrived | Every reply shows its price before sending; failed replies refund |
| **Film Studio** `/app/film-studio` | A seven-stage planner (tools, studio, breakdown, references, asset passports, tests and lock, shot prompts), kept in the browser with export and import of studio JSON | Not stored on the server. Hands the final prompt to Create |
| **Video editor** `/app/editor` | A full-screen editor: Snap and Ripple delete; track selection; a left rail of Media, Audio, Generate, Templates, Elements, Text, Captions, Transcript, Scenes, Clips, Assistant, Effects, Transitions, Filters, Animation, Plugins, Brand kit, Review; a canvas with 16:9, 9:16, 1:1; a timeline with zoom and "Fit all"; Save to a project, Project files, Workspace, Export, Credits | An empty state says "Start by adding a video". The Credits button here goes to web checkout |
| **Projects** `/app/projects` | A workspace picker, "New project", search, two projects with Rename and Delete | One project is named "[Mobile test]" |
| **Credits** `/app/credits` | Balance; four packs (100 for $10, 270 for $19, 1,200 for $59, 3,000 for $129) with a right-to-cancel checkbox and Stripe checkout; how billing works; Credit Subscriptions marked closed; usage for 24 hours, 7 days and 30 days; a credit statement with generations, refunds, adjustments and top-ups; top-up history with pending and credited states | The phone cannot link here to buy. The statement and usage are readable on the phone |
| **Publish** `/app/publish` | A brand label, ten networks (Instagram and Facebook, Threads, Bluesky, Twitch, Google Business "Coming soon"; LinkedIn, X, YouTube "Connect"; TikTok connected), Connected accounts, Social inbox, Contacts, SmartLink, Plans and billing, a Create a post form (caption, media image or video or from Library, Post now), and Scheduled and published with delivery status | Free includes one account and Post now. Weekly drafts and batch approval are paused during the limited rollout |
| **Publish calendar, analytics, inbox** | Each shows an "Unlock ..." card for the $15 monthly Publish Plan: calendar and scheduling, analytics with CSV and best time, the unified inbox | On a free account these three are locked screens, not empty ones. The phone must show the same locked state and the store price |
| **Account** `/app/account` | Billing and subscriptions (opens web billing), two-factor (enabled, remove), passkeys (add, remove), Connected assistants (none), Refer a friend (link, 10% of a first pack, paid as credits after 14 days), Set a new password by emailed code, Signed-in devices (sign out others or everywhere), Content decisions and appeals, Report content, Your data (an email draft to request an export), Delete account | The billing row must not appear on the phone. The data export is an email draft |
| **Social Cinema** `/social-cinema` | Tabs Series, Vote, Saved, Following, Winners; 12 category chips; nine published series, each with episode count, author, genres, a blurb and Watch (for example 40 episodes for one series) | Series first, then episodes. The Vote, Saved, Following and Winners tabs are visible on production |
| **Cinema creator** `/social-cinema/creator` | "The creator workspace is in preview and is not open yet." for this account | Creator tools are not open to this account even on the web |

## 3. The first-run and money journey a person has on the web today

1. Land on Explore. Prices are on every card. The balance chip says what you have.
2. Pick a template or go to Create. The cost shows before **Generate**, with "Refund on failure, always".
3. A free option exists with a count left ("FREE · 3 left"). Free credits are spent first.
4. The result lands in Library with its cost. Failures show a refund line. Files expire.
5. From Library, **Schedule this** moves a file to Publish. Post now is free; scheduling, analytics and the inbox need the paid plan.
6. Credits are bought on the Credits page by Stripe checkout, with a right-to-cancel acknowledgement. The phone replaces this with store purchases.

## 4. Mapped to the phone

Status is from the code audits in the parity map, not from a device.

| Web flow | Phone today | Gap to close | Phase |
|----------|-------------|--------------|-------|
| Explore with chips and 110 priced templates | A poster list under Create; the new tab shell | An Explore home with chips, prices on cards, an Oddlings banner | P1 (N4) |
| Create: goal picker, live price tiers, free option with count, image count, Start/Settings/Cinema camera, draft restore | Model list, prompt, duration, file slots, price | Goal picker, price tiers, "free, N left" on the option, image count, settings, camera panel, draft restore | P2 |
| Library: status and type filters, grid and list, favourites, Schedule this, Download, expiry note, refunded failures | A list, Save, Share, Delete, Report | Filters, favourites, grid and list, Schedule this, the expiry date, a "refunded" row | P2 |
| On this device originals | Not applicable; the phone has the camera roll | Decide whether "originals" become Photos picks | P2 |
| Video agent three-step flow | Built | Verify narration and shape inputs against the web | P2 |
| Chat: folders, pin, rename, model prices, Thinking and Web options, Library attach, stop, Studio skills | Threads, personas, folders, streamed replies | Options, attach, stop, skills, pin and rename | P3 |
| Film Studio seven stages | Missing | Native planner, local store, export and import | P8 |
| Oddlings builder and gallery | Missing | Native builder or a web hand-off decision | P8 |
| Editor: every rail and the timeline | Quick edit only | The editor approach after Spike S1 | P4 |
| Projects: create, rename, delete, search | Read-only list | Write actions with the editor | P4 |
| Credits: statement, usage, top-ups, packs, subscriptions closed | History built; packs through the store | Usage meters, top-up history, pending state; no web checkout | P7 |
| Publish: networks, connect, post now, delivery status | Connect for four networks, composer, posts | The remaining networks as released; per-network text; disconnect | P5 |
| Publish locked states for calendar, analytics, inbox | Calendar and analytics exist when the plan is on | A designed locked state with the store price for a free account | P5 |
| Account: 2FA, passkeys, devices, assistants, referrals, password, data, delete | Referrals, appeals, report, history, deletion | 2FA, passkeys, devices, assistants, password, profile; billing row omitted | P7 |
| Cinema: five tabs, 12 categories, series pages, Watch | A feed of titles, comments, report, block | Tabs, categories, series, Saved, Following, Winners (flags decide what shows) | P6 |
| Vey mascot on every page | Not present | N8 | P1 |
| Privacy choices control | Not present | Part of the analytics decision | P7 |

## 5. What this walk changes in the earlier documents

1. **Free versus paid states are part of the journey.** Calendar, analytics and the inbox are locked screens with a price on a free account. The phone specs treated them as ordinary screens.
2. **The web's Create is one screen** with goal, price tier, free option, count and settings together. The phone's two-step model list is a different shape; P2 should aim for the web's one-screen logic on a phone layout.
3. **Prices appear before commitment everywhere** (cards, price list, chat replies, plans). That is a rule for every phone screen, not only Create.
4. **Free credits and a free-option count are visible** ("FREE · 3 left"). The first-run credits screen (N3) should read the same source.
5. **Files expire** (about 90 days) and the web says so on each item. The phone's Library needs the same note.
6. **Publish: a free account has one account and Post now only.** The composer on the phone must enforce and explain that.
7. **The Cinema creator area is closed even to the owner on the web.** The phone's creator tools cannot be tested until that opens; this affects the creator-tools decision.
8. **A project named "[Mobile test]" already exists**, so the web has been used to check phone-related behaviour.

## 6. Next walks needed

- A paid-plan state (needs a Publish Plan account or a staging account with the plan on) for calendar, analytics, inbox, queues and reports.
- A title page, a watch page and playback.
- Create Settings and Cinema camera, and one model page.
- The same walk on the phone app in the simulator, screen by screen, against this table.
