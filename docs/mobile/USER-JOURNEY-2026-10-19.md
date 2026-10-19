# Mobile user journey: from first launch to a post going live

**Status:** Proposed 2026-10-19, written against `origin/main` after #1302. A brief for the mobile session; it changes no code.
**Reads with:** [PLAN-2026-10-18.md](PLAN-2026-10-18.md), [GAP-ANALYSIS-2026-10-17.md](GAP-ANALYSIS-2026-10-17.md) (route by route; this file is the person-by-person view it lacked), [DEVICE-PASS-2026-10-18.md](DEVICE-PASS-2026-10-18.md).
**Ownership:** the "Veyrnox.ai mobile app" session builds from this; the planning session only wrote it.
**Verified by reading, not by running:** `apps/mobile/src/app/index.tsx`, `sign-in.tsx`, `(app)/_layout.tsx`, `(app)/index.tsx`, `create/index.tsx`, `job/[id].tsx`, `library.tsx`. Other screens were not re-read. No device walkthrough has been done.

## 1. What the person sees today

1. **Launch:** a spinner, then the sign-in screen for anyone signed out. No welcome, no onboarding, no preview of the product. The only first-run step is the 18+ tick.
2. **Signed out:** nothing is browsable. A reviewer or a new user sees a login wall.
3. **Signed in:** Home is the Credits number and a column of buttons: Create, Library, Cinema, Edit, Projects, Chat, Buy credits, Publish plan, Account. There is **no tab bar**; every feature is one tap from Home and nothing links onward.
4. **After a creation finishes:** the job screen offers Save, Share, Report and Delete. It does not offer Edit, Publish, Post to Cinema or Make another.

The pieces mostly exist (Create, Templates, Auto Short, Quick edit, Publish composer, Cinema feed, Library). The gap is the connective tissue: finding them, being led into them, and moving between them.

## 2. Reference apps (what is and is not known)

Official sources were thin, so treat this as direction, not fact.

- **CapCut:** four bottom tabs and a central "+" to start a project. The exact labels (Edit, Templates, Inbox, Me versus a Home tab) are unconfirmed; only low-quality pages and one beginner guide were found. Templates are a front door, not a menu item.
- **ReelShort:** the only tab list found is from a clone-script vendor (Home, Discover/Watch, My List, Earn Reward, Profile), so it may not match the real app. Lazyweb holds about 90 captured screens including onboarding; open it before design lock.
- **Metricool mobile:** by its own help page the app is for publishing, basic stats, replying to messages and planning on the go; advanced work (calendars, SmartLinks, ads, video editing, plan changes) stays on the web. A good model for how little Publish needs on a phone.
- **Higgsfield:** nothing found on its phone navigation. Its help centre describes an Explore feed of published apps for the web. Unverified.

Take from this: lead with creation and templates, keep the phone's Publish small, give Cinema its own tab, and verify the rest by installing the apps.

## 3. Proposed shape

**Five bottom tabs, Credits balance in the header on every tab, Account behind the avatar.**

| Tab | Holds | Replaces on Home |
|-----|-------|------------------|
| Home | A prompt box ("What do you want to make?"), Templates strip, recent creations, Vey chat entry, a free-credits note when relevant | The button column |
| Cinema | The vertical feed (exists), then My List and Continue watching | Cinema button |
| Create (centre) | Create today, plus Auto Short and the video agent as clearly named paths | Create button |
| Library | Creations, Video files, Projects, with Edit, Publish and Delete on each item | Library, Edit, Projects buttons |
| Publish | Accounts, Compose, Posts, Calendar, Analytics (exists); the plan paywall only when not subscribed | Publish plan button |

Buy credits sits in the header balance chip. Chat lives on Home. Account holds Help, Referrals, Credit history, Blocked, Delete.

## 4. The journeys

Status key: **Built**, **Partial**, **Missing**. Steps marked built were read in code, not run.

### J1. First launch (new person)

| Step | Today | Wanted |
|------|-------|--------|
| See what the product is | Missing | Three short cards or a looping preview before any sign-in: Make, Edit and Publish, Watch |
| Browse before signing in | Missing | Home preview and the Cinema list readable signed out; playing, creating and buying prompt sign-in (playback minting needs a Bearer token today) |
| Sign in | Built (Apple, Google, email, age tick) | Same, reached from a button, not as the front door |
| Understand credits | Missing | One screen after sign-in: what credits are, that free credits are on the account, no purchase required to try |
| Permissions | Photos and push asked at feature time (partly) | Ask only in context: photos at the first pick, push after the first long job |
| Land with something to do | Missing | Home with a prompt box and three one-tap templates |

### J2. First creation

| Step | Today | Wanted |
|------|-------|--------|
| Choose what to make | Partial: model list; Templates and Auto Short on top | Prompt-first or template-first; model chosen for the person, changeable |
| See the cost before paying | Built | Keep |
| Consent to AI processing | Built (ADR-0128) | Keep |
| Wait | Partial: poll plus push | A friendly wait screen; "you can leave" as the default message |
| Result | Partial: Save, Share, Report, Delete | Add **Edit**, **Publish**, **Make another**, **Use as template input** |

### J3. Create, then edit, then publish (the product's pitch)

| Step | Today | Wanted |
|------|-------|--------|
| Open a creation in quick edit | Partial: Edit is a Home button, not tied to an item | "Edit" on the job screen and Library item carries the clip across |
| Return the edited clip to Library | Built (server render, ADR-0134) | Keep |
| Start a post from it | Partial: composer picks from Library | "Publish" on the job screen opens the composer with that file |
| Connect an account the first time | Missing in app (S4 done on the server, ADR-0136) | Connect from the composer when no account exists |
| Schedule or post now | Built | Keep |
| See it went live | Partial: Posts list | Push when the post publishes or fails |

### J4. Watching Cinema

| Step | Today | Wanted |
|------|-------|--------|
| Discover | Built (vertical feed) | Keep; add Continue watching and My List |
| Play | Built, not proved on a device | Device pass check 12 |
| React, comment, report, block | Partial: report built; block built on server (ADR-0135), not in app | Block member and Blocked list in the app, then comments |
| Pay for a locked title | Missing (needs its own ADR and in-app purchase) | Deferred; show the reason on locked titles |

### J5. Buying credits

| Step | Today | Wanted |
|------|-------|--------|
| Notice low balance | Missing | Gentle prompt when a job costs more than the balance |
| Buy, restore | Built (store purchase only, no web link) | Keep |
| Return to what you were doing | Partial | Return to the Create screen with the prompt kept |

### J6. Returning and re-engaged

Push opens the finished job (built, off by flag). Add: a Home "Pick up where you left off" row, and a Cinema "Next episode" row.

### J7. Account and safety

Built: sign out, delete account, report, appeals, help, referrals, credit history. Add: reachable from one place (the avatar), not scattered.

### J8. Off the phone on purpose

Multi-track timeline, creator upload to Cinema, Publish developer keys, ads and SmartLinks. Show an honest "Continue on web" row rather than a dead end.

## 5. Proposed slices (mobile session, one PR each, no flag enabled)

| Slice | Work | Exit check |
|-------|------|------------|
| N1 | Tab shell: five tabs, header balance chip, avatar to Account; existing screens moved in without behaviour change | Every current screen reachable; no screen lost; tests and typecheck |
| N2 | Signed-out browse: preview Home and the Cinema list, sign-in on play, create or buy | Cold launch without an account shows content; Apple 5.1.1 satisfied |
| N3 | First-run: three intro cards, the credits explanation, permissions in context | Shown once; skippable; reset in Account for testing |
| N4 | Home as launchpad: prompt box, Templates strip, recent creations, pick up where you left off | A new person can make something in two taps from Home |
| N5 | Result screen next steps: Edit, Publish, Make another | Each opens the target with the file carried over |
| N6 | Empty states and low-balance prompt on Library, Posts, Cinema, Create | No blank screen without a next action |
| N7 | Walkthrough pass: a new person on a real phone from install to a scheduled post, recorded with screenshots | Dated note listing every stall |

Order: N1, N5, N4, N3, N2, N6, N7. N1 comes first because every other slice lands in the tab shell, and it touches shared layout files, so run it alone (no parallel mobile PRs while it is open).

## 6. Rules that still hold

- Credits are bought only through the store (ADR-0108). No web link, no steering.
- No wallet or crypto wording in any screen (hard wall).
- Browse-before-sign-in shows only anonymous public data (`/api/cinema/*`, `/api/catalog`, `/api/presets`); nothing per-user.
- New copy goes through the i18n keys list (`I18N-NEW-KEYS.md`); no machine translation of new strings.
- Accessibility: 44 pt targets, labels and roles on the tab bar (ADR-0133).

## 7. Open questions for the owner

1. Is Chat a tab, or a Home entry as proposed? Chat is a core Vey feature on web.
2. Should signed-out people see Cinema at all, or only a product preview? Cinema may be a draw, but playback needs sign-in either way.
3. Does the first-run explain credits with the real free-credit amount? It needs the live number from the server, not a hard-coded figure.
4. Install CapCut, ReelShort, Higgsfield and Metricool and record their first-run and tab layouts, to replace the unverified rows in section 2.
