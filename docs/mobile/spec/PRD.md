# PRD: Veyrnox.ai mobile app

**Status:** Source refresh 2026-10-20 against checkout HEAD `df14bedb`; live deployment and device behaviour not verified.

**Evidence boundary:** Source baseline and PR-query evidence are recorded in [README.md](README.md). Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to this checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).
**Owner:** product owner (Al Jobson). The "Veyrnox.ai mobile app" session builds; the planning session writes specs.
**Predecessors:** [ADR-0106](../../adr/0106-mobile-app.md) (the app), [ADR-0108](../../adr/0108-mobile-store-billing.md) (store billing), [ADR-0109](../../adr/0109-mobile-publish-plan-and-store-catalog.md) (Publish Plan in stores), [ADR-0110](../../adr/0110-mobile-account-and-safety.md) (account and safety), [ADR-0135](../../adr/0135-cinema-block-users.md) (blocking).
**Language:** terms are those of [CONTEXT.md](../../../CONTEXT.md). This document adds none.
**Set:** [README.md](README.md) lists all seven files in this set.

**Scope update 2026-10-19:** the owner decided that every web feature must exist in the phone app, and that the first public store release is full parity (not a phased subset), including creator tools. The rows below that said "deliberately not built" now say "required". The full web-to-phone map, with sizes and spikes, is [../PARITY-2026-10-19.md](../PARITY-2026-10-19.md). A first release may still be a subset; parity is the destination, not the first build.

**Current scope clarification (2026-10-20):** The dated scope update above is retained as history. Its last sentence conflicts with the recorded owner decision: the first **public store release requires full parity**; intermediate TestFlight/Play internal builds may be subsets (PARITY section 9).

## 1. Overview

Veyrnox.ai is a credit-metered AI generation platform on the web: image, video and voice generation, a video editor, a publishing tool (Veyrnox Publish) and Social Cinema, an episodic video catalogue. The mobile app is the same product as a native iOS and Android client of the same `/api/v1` gateway. It is not a second product and has no backend of its own.

The reference points the owner named are Higgsfield (AI video and audio), CapCut (editing), Metricool (publishing) and ReelShort (Cinema). The web product is the design reference, not those apps.

## 2. Why

- People make short video on a phone and post from a phone. A web-only product loses the moment they want to make something and send it on.
- Generations take minutes. A phone can tell the person when it is done; a browser tab cannot.
- Store presence is a distribution channel the web product does not have.

## 3. Who it is for, and the jobs

| Person | Job in their words |
|--------|--------------------|
| Short-video maker | "When I have an idea, turn it into a clip I can post tonight." |
| Social manager | "When a clip is ready, schedule it to my accounts without opening a laptop." |
| Viewer | "When I have ten minutes, watch something good and be able to come back to it." |
| Returning member | "When my video finishes, tell me, and let me trim or caption it and post it." |

## 4. Features and state

Key: **Built** or **Shipped** means source merged at the pinned revision, not device or production acceptance. **Partial** names the implemented slice and its remaining work. In-review work is listed separately in IMPLEMENTATION-PLAN and is not counted as built. Evidence: `src/app/**`, the corresponding `src/lib/*.ts`, `docs/adr/` and local merge history; the dated PARITY list supplies scope, not current completion or flags.

### 4.1 Account and trust

| Feature | State |
|---------|-------|
| Sign in with Apple, Google, email (hidden bot check), 18+ tick | Shipped (ADR-0106, 0110) |
| Account: sign out, restore purchases, report, appeals, help, referrals, credit history, legal links | Built; Sign out sits under the email (#1445). Existing Help is built; new Help guides (#1455) are in review |
| Delete account in the app | Built; both app default and server source gates are off (`apps/mobile/eas.json`, `src/lib/accountDeletion.ts`, `wrangler.jsonc`; TRD section 3). External EAS/deployed values **not verified** (ADR-0111) |
| Consent before content goes to an AI provider | Shipped (ADR-0128) |
| Account security | Password by emailed code, revoke other/all sessions, connected-assistant grants, TOTP enrol/verify/remove and passkeys list/remove built (`src/app/(app)/security.tsx`, `src/lib/auth/accountCalls.ts`, `src/lib/passkeys.ts`). Native passkey enrolment/sign-in blocked on S2 |
| Block a Cinema member, Blocked list, report on comments | Built (ADR-0135, 0141, 0142). Historical migration application report: 2026-10-18; current applied state **not verified** |
| Push notification when a creation finishes | Built; app flag defaults off, EAS remote value **not verified**. Server source: staging on, production absent/off (`wrangler.jsonc`; TRD section 3) |

### 4.2 Create

| Feature | State |
|---------|-------|
| Create with a prompt: image, video, audio models from the catalog, price shown first, idempotent submit | Shipped |
| Create from your own photo, video or audio (upload, save, share) | Shipped (ADR-0114) |
| Templates from `GET /api/presets` | Shipped (ADR-0120) |
| Create options | Aspect, seed, negative prompt, 1–4 images, goals/tiers, saved draft, Library input, Character/camera prompt controls, resolution/audio selectors when declared by the model built (`src/lib/createOptions.ts`, `src/app/(app)/create/[modelId].tsx`). Draw-on-image still needs a dependency decision |
| Auto Short and the video agent | Shipped (ADR-0117, 0118) |
| Free allowance card | Shipped (ADR-0124) |
| Quick edit: trim, join, captions, render on the server | Shipped (ADR-0134) |
| Film Studio (seven planning stages, 16:9 master) | Partial: `/film` imports a web JSON export, reads stages/shots and hands an eligible prompt to Create (ADR-0210). No cross-device project discovery: web state is account-scoped browser-local (`docs/product/film-studio.md`). Server persistence is required for listing/opening web projects; editing and master preparation remain separate work |
| Full editor: multi-track timeline, effects, colour, masks, audio, captions, transcript, export | Required, not built; owner-selected native shell/WebView approach is conditional on real-device S1 (see PARITY) |
| Enhance (on-device face smoothing) | Required, not built; the web version is not live, so it waits on that decision |
| Oddlings studio, Face Filters | Oddlings gallery, sheets, builder, saved characters, moving previews and portrait-to-Create animation handoff built (`src/app/(app)/oddlings/`, ADR-0158/0230). Saved passports and the builder draft are install-scoped; account isolation/cleanup is **UNRESOLVED WORK** (SCHEMA section 2). Face Filters activation merged on main in #1439: `packages/db/schema/supabase/0357_activate_face_filters.sql` activates A1, A2, A4, A5; A3 relight stays inactive and A6–A8 are absent. Production application is **not verified from the repo**. The existing tools directory is built; dedicated phone Face filters (#1453) and related docs (#1446) are in review |

### 4.3 Library and projects

| Feature | State |
|---------|-------|
| Library of creations with cache and offline view; Save to Photos, Share, Delete | Built; filters, favourites, grid/list, expiry/refunded states, provenance and Schedule this are also built (`src/lib/libraryView.ts`, ADR-0156) |
| Library video files (film masters, editor renders), read-only | Shipped (ADR-0130) |
| Workspaces and projects, read-only | Shipped (ADR-0131) |

### 4.4 Chat

| Feature | State |
|---------|-------|
| Chat with Vey: threads, personas, folders | Built; Thinking/Web options, attachments, Stop/ask again, rename/pin, search/delete, model/instructions, Studio/Film skills, media handoff and suspended-reply recovery (`src/lib/chat*.ts`, `src/app/(app)/chat/`). Vey opens a sheet on supported tabs; real-device recovery **not verified** |

### 4.5 Publish

| Feature | State |
|---------|-------|
| Publish Plan paywall through the store | Shipped (ADR-0109) |
| Accounts, posts, analytics, brand switcher, approvals, calendar and best time (read) | Shipped (ADR-0121, 0137, 0138) |
| Compose, schedule, cancel, restore | Built; per-network text, YouTube visibility, queue slot, account disconnect, draft approve/discard, month calendar and analytics range/compare. Schedule is the default in `src/app/(app)/publish/compose.tsx` (#1438); successful submit opens Posts with scheduled/queued/posting-now confirmation (#1441). Per-account text has a hint before account selection (#1445) |
| Connect a social account from the phone | Shipped (ADR-0136, 0140); cannot work against a provider until the owner registers redirect addresses |
| Queues, autolists, inbox, workflows, contacts, SmartLinks, ads, commerce, reports, team, activity, developer keys | Queues/autolists, contacts editing, SmartLink editor, report download/share, team management, activity and developer keys/webhooks/logs built. Inbox is read-only; replies remain, and Publish workflows and Plan status (#1454) are in review. Ad draft create/edit/delete and product create/edit/archive built (#1428/#1430); no ad-spend launch. See `src/app/(app)/publish/` |

### 4.6 Cinema

| Feature | State |
|---------|-------|
| Free viewing feed, one active player, signed playback | Shipped (PR #1251, spike note `CINEMA-PLAYBACK-SPIKE-2026-10-18.md`), not proved on a device |
| Comments with report and block | Shipped |
| Pass, pay-per-title unlocks, credit subscriptions in the app | Partial: entitlement/locked states and read-only existing Pass card built (`src/lib/cinemaPass.ts`, ADR-0207). Store Pass purchase, unlock purchase and credit subscriptions remain blocked on billing decisions/products (ADR-0143); no phone purchase link |
| Creator profile, apply, content, upload, analytics; voting, polls, saved and follows, winners | Browse/discovery, voting/polls, Saved/Following, rankings, sharing, profile/application and analytics source built (`src/lib/cinemaBrowse.ts`, `cinemaSocial.ts`, `cinemaCreator.ts`). Creator upload is only Continue on web (ADR-0208); native drafts/upload/submit remain. Social features are staging-only in configuration; see TRD section 3 |
| Continue watching | Server `/api/v1/cinema/progress` merged (#1434, ADR-0232); phone integration (#1452) is in review, absent from this baseline. Migration 0355 activation pending/unapplied per work order, live state **not verified**; `watchProgress` absent/off in both source environments (`wrangler.jsonc`, interpreted by `lib/cinema/features.js`) |

### 4.7 Money

| Feature | State |
|---------|-------|
| Credit packs through the store only (RevenueCat) | Shipped, historical Test Store claim **not verified** in this refresh; real sandbox purchase, restore and refund still need device evidence |
| Web link-out to buy credits | Deliberately not built (roadmap decision 4) |

### 4.8 Navigation and first run

| Feature | State |
|---------|-------|
| Five-tab shell, balance chip, avatar to Account | Built: Explore, Create, Cinema, Library, Publish (`src/app/(app)/(tabs)/_layout.tsx`) |
| First-run intro and credits explanation with the real free amount | Built after sign-in at `/welcome`; `GET /api/v1/balance` (`free_credits`), versioned local seen flag (`src/lib/firstRun.ts`) |
| Signed-out preview of Explore and the Cinema list | Built at `/preview`, entered through the Browse first text link on sign-in (#1445); templates/Cinema list only. Selecting content asks to sign in; automatic return to the selected item is not implemented there |
| Vey mascot as the chat entry on every screen | Partial: animated sheet entry on Explore/Create/Library/Publish tabs; excluded from Cinema and stack screens by the tab layout |
| Result screen next steps: Edit, Publish, Make another | Built (`src/lib/nextSteps.ts`, ADR-0147), availability depends on output |
| Explore as the home screen | Built: prompt collage, type/category/search, templates before the Oddlings banner (#1447), recents; empty states and low-balance prompt also built |

## 5. Out of scope

- Features that do not exist on the web (creator cash payouts, ad spend launching, a working Enhance in production). The phone follows the web, not ahead of it.
- Any wallet, crypto or on-chain wording or feature. The Veyrnox wallet is a separate business (hard wall in `CLAUDE.md`).
- Selling credits, Pass or subscriptions through anything but the stores, and any link that steers to web checkout (App Store 3.1.1).
- Per-user model training and real-time camera filters (same reasons as the web).

## 6. Success criteria

Proposed; the owner has not set numbers.

1. A new person who installs the app can make a first creation and see it, within five minutes, without help (N7 walkthrough).
2. Every check in [DEVICE-PASS-2026-10-18.md](../DEVICE-PASS-2026-10-18.md) passes on an iPhone, then on a Pixel-class phone.
3. TestFlight external review and Play internal testing return no rejection on content, billing or account deletion.
4. Every debit has a refund path, and `reconcile_balances()`, `reconcile_free_credits()` and `reconcile_top_ups()` return zero rows for the 24 hours after store billing is switched on in production.
5. Crash-free sessions and first-creation rate are measured from the first TestFlight build (targets to be set by the owner).

## 7. Launch blockers

Owner steps (accounts, keys, agreements) and flag flips are in [PLAN-2026-10-18.md](../PLAN-2026-10-18.md) section 2A and the M7 checklist. Completion of these external prerequisites is **not verified**. The historically listed three that stop a first TestFlight build: the App Store Connect API key and in-app purchase products, the RevenueCat iOS key, and a review account on production.

## 8. Open questions

1. Targets for success criterion 5.
2. Resolved in source: Oddlings has native routes; remaining parity and device acceptance are still open.
3. Whether the app needs a light theme (it is dark only today).
4. ~~Whether paid Cinema ships in the first store release or later.~~ Decided 2026-10-19: the first public release is full parity, including paid Cinema and creator tools.
5. Where Vey sits by default on a phone and when it hides.
