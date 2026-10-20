# Device test kit: iPhone and Android, one pass

**Status:** Proposed 2026-10-20, written against `origin/main` at `ad5b5c81`. Docs only; nothing here was run on a device.
**Supersedes:** [DEVICE-PASS-2026-10-18.md](DEVICE-PASS-2026-10-18.md) as the list to run. Its 16 checks are all inside this kit (see the map in section 8).
**Reads with:** [PARITY-2026-10-19.md](PARITY-2026-10-19.md) (spikes S1 to S8, section 7), [FLAG-PLAN-2026-10-19.md](FLAG-PLAN-2026-10-19.md), [USER-JOURNEY-2026-10-19.md](USER-JOURNEY-2026-10-19.md), [M7-STORE-SUBMISSION-CHECKLIST.md](M7-STORE-SUBMISSION-CHECKLIST.md), [spec/](spec/README.md), ADR-0106, 0108, 0109, 0113, 0128, 0136, 0143, 0146, 0150, 0158, 0167, 0178, 0181, 0201, 0203.
**Why:** many sessions merged mobile features proved only on unit tests and a mock server (`apps/mobile/dev/mock-server.mjs`). No session can drive a physical phone. This kit is what you run by hand.

**How to read a row:** one action, what you should see, then blanks. Write `P` (pass), `F` (fail) or `B` (blocked: a flag, account or approval is missing, so you could not run it). Blocked is not a fail. Name the screenshot `dp-<row>-<word>.png`, for example `dp-23-cinema-play.png`.

## 1. Do these first (risk order)

These are the ones most likely to be broken, and the ones store review or users hit first. Run them before anything else; if one fails, stop and report it before spending time on the rest.

| Order | Row | Why it is likely broken |
|-------|-----|-------------------------|
| 1 | 58 to 65 Buy credits, Restore, refund | Never run on a real store. Refund is untested even in the sandbox (M7 section 2). Money. |
| 2 | 19 to 21 Push when a job finishes | Needs a signed build, the push flag, and an env var the `preview` profile does not set (section 2). |
| 3 | 38 Cinema play, 39 token renewal | HLS from a signed Stream token was never proved on any player (CINEMA-PLAYBACK-SPIKE part 2). |
| 4 | 35 to 36 Long chat turn through suspension (S6) | Only unit tests exist (ADR-0181 "Not proved"). One charge is the claim. |
| 5 | 4 to 6 Sign in with Apple, Google, email | Gates everything else. Apple needs the bundle id in Supabase (M7 O7). |
| 6 | 22 Connect a social account | Every provider needs its redirect address registered first (ADR-0136). |
| 7 | 76 Delete account | The flag is off in every environment unless you turn it on (section 2). |

## 2. Setup

### 2.1 Devices

- An iPhone on a recent iOS, signed in to an Apple ID you do not mind using for sandbox purchases.
- A mid-range Android phone (not a flagship; the low memory is the point of S1 and S3), with a Google account that is a Play licence tester for `ai.veyrnox.app`.
- Wi-Fi plus mobile data on both. Some rows switch between them.

### 2.2 Which build

Use the **`preview`** EAS profile in `apps/mobile/eas.json`: internal distribution, `EXPO_PUBLIC_APP_ENV=staging`, `EXPO_PUBLIC_STORE_BILLING_ENABLED=true`. It talks to the staging API. Never use `production`, a real card or a real social account.

```bash
cd apps/mobile
npx eas-cli build --profile preview --platform ios
npx eas-cli build --profile preview --platform android
```

**Two gaps in the profile today** (read from `eas.json`; not changed by this doc):

- `EXPO_PUBLIC_PUSH_ENABLED=true` is not set in `preview`, and push is off in the app unless it is (`src/lib/push.ts`). Rows 19 to 21 will read as blocked on a stock build.
- `EXPO_PUBLIC_ACCOUNT_DELETION_ENABLED=true` is not set in `preview` either (M7 item M-1). Row 76 will read as blocked.

Ask the mobile session for a `preview` build with both set, or set them as EAS environment variables for that build. Also needed as EAS secrets: `EXPO_PUBLIC_REVENUECAT_IOS_KEY`, `EXPO_PUBLIC_REVENUECAT_ANDROID_KEY` (M7 O5, O11). Without a RevenueCat key, rows 58 to 62 are blocked.

### 2.3 Mock server or staging

| Use | When | How |
|-----|------|-----|
| **Staging** (default) | Every row marked **S** below: purchase, push, Cinema play, sign-in, connect, delete | The `preview` build already points there. No setup. |
| **Mock server** (dry run only) | To see a screen before staging has the flag, or to practise a row | Needs a **development client** build (`development` profile; the dev API override only works when `__DEV__` is true). On the Mac: `node apps/mobile/dev/mock-server.mjs` (port 8799). Start Metro, and set `EXPO_PUBLIC_DEV_API_BASE=http://<Mac LAN address>:8799` before `npx expo start`. Phone and Mac on the same Wi-Fi. |

A mock pass proves a screen draws. It proves nothing about real response shapes, and the mobile ADRs 0121 to 0142 were proved only that way. Rows marked **S** must be run on staging. When you finish, stop the mock server and Metro (do not leave them running).

### 2.4 Accounts

| Account | Used for | Notes |
|---------|----------|-------|
| A staging email test account with some Credits | Most rows | Grant credits through the normal staging path. Keep the credentials out of this file. |
| The staging **review account** | Row 4 fallback, App Review notes | Apple cannot pass Turnstile on a fresh sign-up (M7 O10). |
| A **throwaway** staging account | Rows 8 to 12, 76 | Row 76 deletes it. |
| A second throwaway account | Rows 70, 71 (report, block) | Gives you someone to block. |
| Apple **sandbox tester** | Rows 58 to 62 on iPhone | App Store Connect, Users and Access, Sandbox. Sign in under Settings, Developer, Sandbox Apple Account on the phone. Owner step. |
| Google **licence tester** | Rows 58 to 62 on Android | Play Console, License testing. Owner step (M7 O11). |
| An authenticator app (any TOTP) | Rows 8 to 12 | |
| A throwaway social account per network | Row 22 | Never a real brand account. |

### 2.5 Flags that must be on in staging

Flags change only on the owner's explicit words. This list is what the checks need, from `wrangler.jsonc` as read in FLAG-PLAN section 2. Production and staging were not read live. Confirm each on staging before you start; a row whose flag is off is **B**, not F.

| Flag (staging) | State per file | Needed for rows |
|----------------|----------------|-----------------|
| `STORE_BILLING_ENABLED` | `true` | 58 to 62 |
| `PUSH_NOTIFICATIONS_ENABLED` | `true` | 19 to 21 |
| `ACCOUNT_DELETION_ENABLED` | not in the file (dashboard); confirm | 76 |
| `CINEMA_ENABLED`, viewing on | confirm | 38 to 42 |
| `COMMENTS_ENABLED` | **absent (off)** | 43 |
| `VOTING_ENABLED` | **absent (off)** | 44 |
| `CINEMA_RETENTION_ENABLED` (saved, follows) | **absent (off)** | 44 |
| profiles and creators (Cinema profile) | confirm | 45 |
| `CINEMA_UNLOCKS_ENABLED`, `SUBSCRIPTIONS_ENABLED` | `true` on staging | locked-title states in row 42 |
| `PUBLISH_*` runtime flags, Publish Plan | confirm | 22, 23 to 27 |
| `CHAT_RESEARCH_ENABLED` | absent (stays off) | not tested |

FLAG-PLAN section 4 step 1 is the staging flip for comments, voting, polls and the rest. Until it is approved and done, rows 43 and 44 are **B**.

### 2.6 Owner steps that unblock rows

| Step | Unblocks |
|------|----------|
| Register `https://<staging host>/social/connect/mobile/<network>` at each provider app (Instagram, LinkedIn, X, YouTube, TikTok; extended networks only when released) | Row 22 |
| Apple sandbox tester and Play licence tester | Rows 58 to 62 |
| Products attached to the RevenueCat offerings, iOS and Android keys in EAS | Rows 58 to 62 |
| Apple Team ID and Android fingerprints in `lib/mobileAppLinks.js` | Row 73 (app links) |
| Staging push flag on; push entitlement and FCM credentials in EAS (M7 M-4) | Rows 19 to 21 |
| A staging review account | Row 4 |

### 2.7 Recording

Fill the table cells in a copy of this file, or in a dated note `docs/mobile/DEVICE-PASS-RESULTS-<date>.md` using the same row numbers. Put screenshots in a folder you name in that note. A failing row is a bug for the mobile session: copy the row number, device, build number and screenshot name to them.

## 3. Checklist

Columns: **iOS** and **Android** take `P`, `F` or `B`. **S** = needs staging, not the mock server.

### A. First launch

| # | Do (one action) | Expect | S | iOS | Android | Shot |
|---|-----------------|--------|---|-----|---------|------|
| 1 | Install the build and open it, signed out | The app opens to the sign-in screen or an intro with sign-in reachable; no crash, no blank screen | | | | |
| 2 | Leave the 18+ tick unticked and try to sign in | Sign-in is refused until the tick is set (ADR-0110) | | | | |
| 3 | Turn the phone to dark mode and back | Text stays readable | | | | |

### B. Sign in, with two-factor

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 4 | Sign in with email and password (the review account) | The bot check completes without a visible challenge; you land signed in on the Explore tab | S | | | |
| 5 | Sign out, then tap **Apple** (iPhone only) | The Apple sheet opens, you return signed in, Credits shown match row 4's account if the same Apple ID is linked | S | | n/a | |
| 6 | Sign out, then tap **Google** | A browser sheet opens and closes back into the app, signed in | S | | | |
| 7 | Kill the app from the app switcher and reopen it | You are still signed in | | | | |
| 8 | On the throwaway account: Account, Security, Two-factor, **Set up** | A setup key and an "Open my authenticator app" button show (ADR-0150) | S | | | |
| 9 | Add the key to the authenticator app, enter the 6-digit code, tap **Turn on** | Two-factor shows as on | S | | | |
| 10 | Sign out, sign in again with email | After the password you are asked for a code; a correct code lets you in | S | | | |
| 11 | Enter a wrong code | A clear error, no sign-in, you can retry | S | | | |
| 12 | Security, remove the factor with a valid code | Two-factor shows as off; next sign-in asks for no code | S | | | |

### C. Create and wait, with a push

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 13 | Create tab, pick an image model, type a prompt | The price in Credits shows before you pay | S | | | |
| 14 | Tap the create button for the first time | The AI-sharing consent sheet appears before anything is sent (ADR-0128) | S | | | |
| 15 | Accept and start | A wait screen shows; the balance drops by exactly the price shown | S | | | |
| 16 | Wait on the screen | The job finishes and the result shows; the balance is unchanged after finishing | S | | | |
| 17 | Create with a photo: pick one from the phone | The photo permission prompt appears once, in context; the job runs with the photo | S | | | |
| 18 | Start a **video** job, then press Home and lock the phone | Nothing in the app is needed to keep it going | S | | | |
| 19 | Wait for the video to finish | A notification arrives; its text carries no prompt, model or price (ADR-0113) | S | | | |
| 20 | Tap the notification | The app opens on that job's screen | S | | | |
| 21 | Start a video, then **turn push off** for the app in system settings, wait | No notification; the job still finishes when you reopen the app | S | | | |

### D. Result, edit, publish

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 22 | Publish tab, Accounts, **Connect** a throwaway account on one released network | The provider sign-in opens in a browser sheet; after approving, you return to the app and the account is listed (ADR-0136). Repeat for each released network | S | | | |
| 23 | Open the finished video, tap **Edit** | Quick edit opens with that clip already loaded | S | | | |
| 24 | Trim the clip and save | An edited file appears in Library | S | | | |
| 25 | Open the result, tap **Publish** | The composer opens with that file attached | S | | | |
| 26 | Pick the connected account, schedule 10 minutes ahead, confirm | The post is listed as scheduled with the right time | S | | | |
| 27 | Cancel the scheduled post | It shows as cancelled; nothing publishes at the time | S | | | |
| 28 | Open the result, tap **Save to Photos** | The permission prompt appears once; the file is in Photos | S | | | |
| 29 | Open the result, tap **Share** | The system share sheet opens with the file | S | | | |

### E. Chat

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 30 | Tap the **Vey** mascot on any tab | The chat opens; it does not cover the tab bar or the keyboard | S | | | |
| 31 | Start a new chat, send one short message | A streamed reply; the price shows; balance drops by that price | S | | | |
| 32 | Attach a **photo from the phone** (use a large HEIC from the camera) | The attach strip shows the extra price before sending; the reply refers to the photo (ADR-0167, spike S5) | S | | | |
| 33 | Attach an image from **Library** | Nothing is uploaded; same extra price | S | | | |
| 34 | Send a message, tap **Stop** while it streams | The stream stops; a notice says what was charged (ADR-0155) | S | | | |
| 35 | **Long turn through suspension:** send a long request (ask for 1500 words), press Home during the stream, wait 60 s, reopen | The saved reply appears with a notice that it finished in the background and was charged once (ADR-0181). Check the balance dropped exactly once. Repeat with the phone locked | S | | | |
| 36 | Same, but switch to airplane mode for 20 s mid-turn, then back | The turn recovers or shows a clear error; retrying the same text does not charge twice | S | | | |
| 37 | Rename and delete a thread, search the list | Each works; delete asks for confirmation | S | | | |

### F. Cinema

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 38 | Cinema tab, open a **free** title, tap play | Video starts within a few seconds with sound; controls work | S | | | |
| 39 | Keep playing for **20 minutes** with the screen on | No stall at the 15-minute token renewal; seeking works afterwards | S | | | |
| 40 | While playing, press Home, wait 30 s, return | Playback paused and resumes; no crash | S | | | |
| 41 | Sign out and open the Cinema list | The list is readable signed out; play asks for sign-in | S | | | |
| 42 | Open a **locked** title | The reason it is locked shows; no purchase starts in the app unless the flag and the in-app product exist (ADR-0143) | S | | | |
| 43 | Open a title, write a comment, send | It shows as awaiting review or posted; you can withdraw your own. **Needs `COMMENTS_ENABLED`** | S | | | |
| 44 | Vote for a title, save a title, follow a creator. **Needs voting and retention flags** | Each state sticks after leaving and returning | S | | | |
| 45 | Cinema Profile: create a profile, then apply as a creator. **Needs profiles and creators** | Both save; status shows as pending (ADR-0168) | S | | | |
| 46 | Open a title's Share | The share sheet opens with the canonical link | S | | | |

### G. Oddlings

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 47 | Explore tab, tap the Oddlings banner | The gallery opens; portraits load as you scroll (they come from the web host) | S | | | |
| 48 | Switch collection tabs and the Human / Other beings filter | The list changes to match | | | | |
| 49 | Open a character sheet | Name, hook and premise show | | | | |
| 50 | Open the builder, pick a few options, tap randomise | A prompt preview updates | | | | |
| 51 | Save a draft, leave, reopen **Saved** | The draft is there and re-opens with the same picks | | | | |
| 52 | Use the hand-off card to start a short or a video | Create opens with the prompt filled; the price shows before paying | S | | | |

### H. Library

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 53 | Library tab | Your creations list; pull to refresh works | S | | | |
| 54 | Open **Video files** | The files list opens; Save and Share work | S | | | |
| 55 | Use Search and History from the header or Account | Both open and return results | S | | | |
| 56 | Turn on airplane mode, open Library and Create | A cached Library shows with an offline banner; paid actions refuse to start | | | | |
| 57 | Delete a creation | A confirm names what is deleted; it leaves the list; the balance does not change (ADR-0119) | S | | | |

### I. Credits: buy and restore

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 58 | Tap the credits chip, buy the **smallest pack** with the sandbox/licence tester | The store sheet shows the sandbox mark; after paying, the balance rises within about a minute | S | | | |
| 59 | Note the balance, force-quit, reopen | The balance is the same, and the credits are not added twice | S | | | |
| 60 | Credits, **Top-up history** (Account) | The purchase is listed with date, credits, price and status | S | | | |
| 61 | Delete the app, reinstall, sign in, Account, **Restore purchases** | Entitlements and balance are unchanged; nothing credited twice | S | | | |
| 62 | Cancel out of the store sheet partway | No credits added, no error loop | S | | | |
| 63 | Open the **Publish Plan** paywall | Price, period, auto-renew and cancel terms, Restore, Terms and Privacy links all show | S | | | |
| 64 | Look through every screen for a link or button that opens a web checkout | None exists (store-only rule, ADR-0108) | | | | |
| 65 | Ask for a sandbox refund of row 58 (iPhone: Report a Problem; Android: Play Console) | Credits are taken back; the owner then checks `reconcile_top_ups()` returns no rows. If the sandbox gives no refund, record **B** and say so | S | | | |

### J. Account, safety and delete

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 66 | Account page: open Help, Referrals, About, Languages | Each opens; no blank screen | S | | | |
| 67 | Change language to Arabic | The layout flips right to left; text is not clipped; change back | | | | |
| 68 | Set system text size to the largest | Tabs, header and buttons stay usable; nothing is clipped (ADR-0133, 0146) | | | | |
| 69 | Turn on VoiceOver (iPhone) or TalkBack (Android); go through sign-in, Create, Account | Every control is read with a sensible name | | | | |
| 70 | Report a creation from its screen | Confirmation shows; the owner finds it in the admin report list | S | | | |
| 71 | Cinema, block the second throwaway account's profile | They vanish from comments; the Blocked list shows them; unblock works | S | | | |
| 72 | Account, Appeals: open the screen | It loads; no crash | S | | | |
| 73 | Send yourself a `https://<host>/app/...` link (Notes or Messages) and tap it | The app opens on that screen. **Needs the Team ID and fingerprints (section 2.6)** | S | | | |
| 74 | Tap a team invite link or a post review link (ADR-0203) | The matching screen opens | S | | | |
| 75 | Tap an `oauth/consent` link (ADR-0201) | The consent screen opens and names who is asking | S | | | |
| 76 | Throwaway account: Account, Delete account, confirm | You are signed out. Signing in again fails. The owner confirms the tombstone | S | | | |
| 77 | Delete an account that has an open report or a Frozen state | The app says why it is refused and nothing is deleted | S | | | |

### K. Across the app

| # | Do | Expect | S | iOS | Android | Shot |
|---|----|--------|---|-----|---------|------|
| 78 | Walk all five tabs: Explore, Create, Cinema, Library, Publish | Each loads; the credits chip and avatar are in every header | S | | | |
| 79 | Rotate the phone on each tab | No crash; layout recovers | | | | |
| 80 | Open the app with the staging service down (airplane mode on the first launch) | A banner or message shows; no spinner forever | | | | |

## 4. Spikes S1 to S8

Each is a short procedure on **both** a real iPhone and the mid-range Android phone, ending in pass or fail. They decide what the parity plan builds next. The pass thresholds are from PARITY section 7. Section 9 of the same file says S9 (Enhance) waits on a web decision, so it is not here.

### S1. Editor export in a web view

Procedure and results: [spikes/S1-editor-export.md](spikes/S1-editor-export.md). Another session is preparing that file; this kit does not repeat it.

- **Pass:** export under 3x real time; no web-view kill, including after backgrounding; correct frame count and audio within 0.1 s; thumb trim works.
- **Unlocks:** the owner's decision of 2026-10-19 (option C, native shell plus web engine). A pass starts the editor build.
- **Fail means:** the owner chooses the native timeline with server rendering (B), or the Fly runner.

### S2. Passkeys on a native build

1. Install a build with the associated domain for the relying-party id.
2. In Account, enrol a passkey on staging.
3. Sign out and sign in with it.

- **Pass:** both enrol and sign-in succeed against staging, on iPhone and Android.
- **Unlocks:** passkey sign-in and enrolment on the phone (parity P7).
- **Fail means:** a server change to allow the app origin, or defer passkeys to the web.

### S3. Resumable 1 GB upload to Cinema

1. Put a 1 GB video on the phone.
2. Start a Cinema upload on staging (needs the Cinema proxy-upload flag and the quarantine path; otherwise **B**).
3. At about 40%, force-quit the app, then reopen.
4. At another point, switch Wi-Fi to mobile data.

- **Pass:** the upload resumes after the force-quit and after the network switch, and the final file matches its checksum.
- **Unlocks:** creator device upload (App Store 1.2 plan still required).
- **Fail means:** design a background-session module before building creator upload.

### S4. Shared web logic bundles in the app

Mostly a Mac check, then one device check.

1. `cd apps/mobile && npx jest` and note the Oddlings cast drift test result.
2. Open Oddlings (rows 47 to 51) on both phones.

- **Pass:** it bundles on both platforms and the existing Node tests pass on the same shared file.
- **Unlocks:** Film Studio validators, templates and the character builder reuse the web files directly.
- **Fail means:** copy the logic and add a drift test (the approach ADR-0158 already uses for the cast).

### S5. Chat image attachment

1. Take a photo with the phone camera (4000 px or larger, HEIC on iPhone).
2. Attach it in a chat and send (row 32).
3. Send the same message again, same photo, without changing anything.

- **Pass:** the server accepts the photo resized to 2048 px; the price shows; the replay is one charge, not two; the photo is upright in the reply.
- **Unlocks:** chat attachments in the release (ADR-0167 move from Proposed).
- **Fail means:** orientation or EXIF was lost: fix the resize step before shipping.

### S6. Long chat turn through iOS suspension

Same as row 35, run five times on iPhone (the key case) and twice on Android.

- **Pass:** every run recovers the reply, one charge each, no duplicate on retry.
- **Unlocks:** the recovery design in ADR-0181 stands; chat long turns can ship.
- **Fail means:** design a read that recovers the reply from the server by job id, without relying on the stream.

### S7. Draw-on-image mask to PNG

Not yet testable: the draw-on-image screen is not on `main` (no such file under `apps/mobile/src/app`). Record **B**.

- **Pass (when built):** a mask saved at the source size is accepted by the server as the same input.
- **Unlocks:** inpaint-style Create options.
- **Fail means:** try another canvas library.

### S8. Film Studio 16:9 master on device

Not yet testable: Film Studio is not on `main`. Record **B**.

- **Pass (when built):** 1920x1080, 24 fps, exact size; duration within one frame; under 60 s.
- **Unlocks:** the Film Studio master step on the phone.
- **Fail means:** a new server ffmpeg route.

## 5. What a failed row should include

Copy this into your note for each F:

```
Row:        
Device:     (model, OS version)
Build:      (EAS build number, profile)
Server:     staging / mock
What I did: (the exact action, one line)
Saw:        
Expected:   
Screenshot: dp-<row>-<word>.png
```

## 6. After the pass

1. Hand every F to the mobile session, one bug per PR.
2. Rows 58 to 65 (store purchase), 19 to 21 (push), 38 to 39 (Cinema play) and 35 to 36 (long chat turn) passing on both phones are the evidence FLAG-PLAN section 4 asks for before production steps 4 and 5. Production flags still change only on your explicit words.
3. Only then submit to TestFlight external review (M7). Quote the passed rows in the review notes and nothing that is not in the table.
4. Delete the throwaway accounts and stop any mock server or Metro left running.

## 7. Screens on `main` that this kit covers

Read from `apps/mobile/src/app` at `ad5b5c81`. The number in brackets is the row that exercises the screen. Screens with no row are small or reached from one that has one.

- **Entry:** `index`, `sign-in`, `email`, `review` (post review link, 74), `+native-intent` (links, 73).
- **Tabs:** Explore (78), Create (13), Cinema (38), Library (53), Publish (22).
- **Create:** `create/[modelId]` (13), `create/presets`, `create/agent` (Video agent: start one short run and record it under 13), `job/[id]` (16, 23), `edit/index` (23), `models`, `pricing`.
- **Library and history:** `library/files` (54), `history`, `search` (55), `projects` (list only: open one and confirm it loads).
- **Chat:** list, `new`, `[id]`, `folders`, `move`, `personas`, `persona/[id]` (30 to 37; open personas and folders once each).
- **Cinema:** `cinema/[id]`, `watch/[id]` (38), `comments` (43), `report-comment` (70), `analytics` (45), `probe` (a developer screen; skip).
- **Oddlings:** index, `[id]`, `build`, `saved` (47 to 52).
- **Publish:** `accounts`, `connect` (22), `compose` (25), `posts`, `post/[id]`, `drafts`, `calendar`, `best-time`, `analytics`, `activity`, `brands`, `approvals`, `team`, `queues`, `queue-edit`, `autolists`, `autolist-edit`, `contacts`, `contact-edit`, `reports`, `smartlink`, `developer`. Open each once and note only crashes and blank screens, under row 26. Flows beyond connect, compose, schedule and cancel are not on this pass list; add rows if they matter for the release.
- **Account:** `account`, `security` (8 to 12), `credits` (58), `topups` (60), `referrals`, `help`, `about`, `appeals` (72), `blocked` (71), `report` (70), `delete-account` (76), `brand-kit`, `oauth-consent` (75), `team-invite` (74).

**Not covered because not on `main`:** passkeys (S2), device upload to Cinema (S3), draw-on-image (S7), Film Studio (S8), the full editor (S1), the paid Cinema Pass purchase, and the first-run intro cards and signed-out browse (USER-JOURNEY N2 and N3; row 1 records whatever appears).

## 8. Map from the old 16 checks

| Old (2026-10-18) | Row here | | Old | Row here |
|------------------|----------|---|-----|----------|
| 1 Email sign-in | 4 | | 9 Save and share | 28, 29 |
| 2 Apple | 5 | | 10 Push | 19, 20 |
| 3 Google | 6 | | 11 App links | 73 |
| 4 Buy pack | 58 | | 12 Cinema playback | 38, 39 |
| 5 Restore | 61 | | 13 Offline | 56 |
| 6 Refund | 65 | | 14 Delete account | 76 |
| 7 Publish Plan paywall | 63 | | 15 Accessibility | 68, 69 |
| 8 Create with a photo | 17 | | 16 Report | 70 |
