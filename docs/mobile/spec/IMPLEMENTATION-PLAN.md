# Implementation plan: Veyrnox.ai mobile app

**Status:** Source refresh 2026-10-20 against local `origin/main` at `b5bdc1081bbc5876f0852dd7be9628d4ba5da154`; live deployment and device behaviour not verified.

**Evidence boundary:** Source and local merge history were read at that pinned revision. `gh pr list --state merged --limit 200` and the open-PR query could not connect to GitHub; remote freshness and what is currently in review are **not verified**. Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to the checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).
**Rule:** one slice, one PR, each with an exit gate. No flag is enabled by an assistant. A mobile slice never edits server code, migrations or `wrangler.jsonc`.

## 1. Foundation (done)

| Slice | What | PRs |
|-------|------|-----|
| M0 to M3 | Sign-in, balance, chat, generation, jobs, Library, store billing | #1176, #1187 and neighbours |
| M4 | Release plumbing, EAS profiles, CI, crash reporting | #1204 |
| M5, S1 | Account, deletion, report, age gate | #1205, #1218 |
| S2, S3 | Push tokens, app links | #1219, #1216, #1230, #1231 |
| M8 | Cache, offline, 11 locales, accessibility | #1267 to #1272, #1286, #1287 |
| M9 | Cinema free viewing | #1251 |
| M10 | Create with files, Auto Short, video agent, templates, delete, referrals, quick edit | #1249, #1259, #1262, #1263, #1266, #1252, #1293, #1296 |
| M11 | Publish overview, compose, brand switcher, approvals, calendar, connect | #1269, #1273, #1300, #1301, #1306 |
| M12 | Credit history, allowance, help, appeals | #1274 to #1276 |
| M13 | AI consent, privacy manifest, report and block audit | #1278 to #1280 |
| S4, S10 | Publish connect return, block members | #1295, #1294, #1307, #1308 |

The foundation table above is retained as historical PR attribution. Current source adds the following; local squash-merge subjects corroborate the PR numbers, but GitHub's merged/open PR lists are **not verified** because the network query failed.

| Current area | Built at pinned main | Evidence |
|--------------|----------------------|----------|
| Create/Library | Options, drafts, Library input, resolution/audio selectors, Character/camera controls, filters/favourites/provenance/Schedule this, sound and stems | `src/lib/createOptions.ts`, `src/lib/libraryView.ts`, `src/lib/clipEdit.ts`; #1338, #1344, #1346, #1393, #1427, #1436 |
| Chat | Reply options, attachments, Stop/ask again, rename/pin, search/delete, model/instructions, Film/Studio skills, media handoff, suspended-turn recovery | `src/app/(app)/chat/`, `src/lib/chat*.ts`; #1333, #1342, #1374, #1381, #1389, #1391, #1392 |
| Publish | Composer completion, disconnect, calendar/ranges, approvals/drafts, queues/autolists, team/activity, contacts, SmartLink, reports, developer keys/webhooks/logs, ad draft/product editing | `src/app/(app)/publish/`; #1336, #1341, #1347, #1368, #1371, #1373, #1377, #1415, #1428, #1430, #1438 |
| Inbox | Conversation/thread read-only screens | `src/lib/publishInbox.ts`; #1388; reply/workflow editing remains |
| Cinema | Browse/discovery/social/share/profile/application/analytics, Saved/Following hardening, read-only Pass, creator upload web-link shell | `src/lib/cinema*.ts`; #1379, #1405, #1407, #1425 |
| Account/platform | Password, session revocation, assistant grants, TOTP, passkey list/remove; catalogue/search, brand kit and related routes | `src/app/(app)/security.tsx`, `src/lib/auth/accountCalls.ts`, `src/lib/passkeys.ts`; #1334, #1408 |
| Oddlings | Gallery, builder, saved characters, moving previews, portrait animation handoff to Create | `src/app/(app)/oddlings/`; #1348, #1387, #1394, #1429, #1431 |
| Film Studio | Read-first JSON import, seven-stage status, shots, prompt sharing and eligible Create handoff | `src/app/(app)/film/`, `src/lib/filmStudioStore.ts`; #1406, ADR-0210 |
| Continue watching | Server progress route and migration source only | `app/api/v1/cinema/progress/route.js`; #1434, ADR-0232 |
| Face Filters | Inactive A1–A5 catalog staging and phone tools-directory entry | Main #1437, `src/lib/toolDirectory.ts`; activation/use **not verified** |

**In review:** not verified. `gh pr list --state open --limit 100` could not connect; no unmerged work is labelled built or assigned a guessed PR. This checkout starts at `88ef8eb95b126dd3c81131e0abc5fa20c8b246c2`, three commits behind pinned local main; #1436–#1438 facts were read with `git show origin/main:<path>`, without modifying source. The initial diff against origin/main already included 33 unrelated paths; the docs-only acceptance must distinguish that baseline from this task's working diff.

## 2. Track A: owner prerequisites (gate everything that ships)

| # | Step | Needed for |
|---|------|------------|
| A1 | App Store Connect API key, in-app purchase products, RevenueCat iOS key, Sentry project, review account on production | First TestFlight build |
| A2 | Owner rollout of `STORE_BILLING_ENABLED` and `PUSH_NOTIFICATIONS_ENABLED`, after checking binding headroom and device proof | Source production values are absent/off; staging true (`wrangler.jsonc`, TRD section 3). Live state **not verified** |
| A3 | Apple sandbox tester, staging review account, account-deletion flag confirmed on staging | Device pass |
| A4 | Register `https://veyrnox.ai/social/connect/mobile/<network>` for YouTube, LinkedIn, X, TikTok | A real Publish connect |
| A5 | Play Console app, Play signing fingerprint into `lib/mobileAppLinks.js` | Android |

## 3. Track B: navigation and first run (mobile session)

N1, N2, N3, N4, N5, N6 and the limited N8 mascot are built. The table keeps the original exit gates; completion of source is not completion of the device gates. N7 has a simulator walkthrough (#1422), not the required real-phone acceptance. N1 source order is Explore, Create, Cinema, Library, Publish. N8 is on four tabs, excluding Cinema and stack screens.

| Slice | Work | Exit gate |
|-------|------|-----------|
| N1 | Built: five-tab shell, Credits chip, avatar to Account; screens moved unchanged | Every current screen reachable; tests and typecheck pass; tab bar labelled (ADR-0133) |
| N5 | Built: result next steps: Edit, Publish, Make another carry the file | Each opens its target with the file; tested |
| N4 | Built: Explore as home: prompt box, presets, Oddlings banner, pick up where you left off | A new person makes something in two taps |
| N8 | Partial: Vey mascot/sheet on four non-Cinema tabs | Opens the sheet; never covers tab bar, keyboard, player or composer |
| N3 | Built after sign-in: first run: intro cards, credits explanation with the real free amount, permissions in context | Shown once/skippable built; Account reset control remains missing |
| N2 | Built: optional `/preview` from sign-in; templates/Cinema list | Cold launch without an account shows content; play, create and buy ask to sign in |
| N6 | Built: empty states and low-balance prompt | No blank screen without a next action |
| N7 | Simulator first pass recorded; real-phone walkthrough still required | A dated note listing every stall; each stall filed as a bug |

## 4. Track C: prove it on a device

| Step | Exit gate |
|------|-----------|
| C1 Run the 16 checks in `DEVICE-PASS-2026-10-18.md` on a signed `preview` build (iPhone) | Every check recorded pass or fail; failures fixed one PR each |
| C2 Real sandbox purchase, restore and refund | `reconcile_top_ups()` returns zero rows |
| C3 Cinema HLS 20-minute soak | No stall at token renewal; fallback decided |

## 5. Track D: ship

| Step | Exit gate |
|------|-----------|
| D1 TestFlight external review (iOS) with `submit.production` filled in | Review result recorded; review notes quote only passed checks |
| D2 Store billing on in production | Flag on, 24 hours of clean reconciliation |
| D3 Android parity pass and Play internal testing | Checks 1 to 9 and 13 to 16 pass on a Pixel-class phone |
| D4 Public store release | Full parity P1–P8 and creator tools, per owner decision; privacy label and Data safety forms match section 6 of the M7 checklist |

## 6. Track E: spikes (before the parity phases they gate)

Run on a real iPhone and a mid-range Android phone. Pass criteria are in PARITY section 7. No device spike was run for this docs refresh.

| Blocked work | Why / next concrete gate |
|--------------|--------------------------|
| Full editor timeline | S1 harness is built (`src/app/(app)/dev-s1-editor.tsx`, #1411), but needs a real iPhone and Android export/background/audio/frame-count result. Owner selected native shell plus WebView engine conditional on S1; fallback rendering needs the result and a decision |
| Native device uploads | S3 must prove a 1 GB resumable/background transfer through force-quit and network changes. Cinema only has a web-link upload shell (ADR-0208); native draft/Rights Declaration/submit follow. Publish device upload is also unfinished. `PUBLISH_UPLOADS_ENABLED` and `PROJECT_MEDIA_UPLOADS_ENABLED` are false in production/true staging; Cinema packed `uploads` is true both, which does not prove device upload or scanner readiness (source: `wrangler.jsonc`, `lib/cinema/features.js`) |
| Passkey enrolment/sign-in | S2 must prove a native WebAuthn dependency, relying-party association/origin and real Auth roundtrip. List/remove already exists; not a reason to mark enrolment built (ADR-0204) |
| Film Studio cross-device list/open | Web state is account-scoped browser-local, explicitly outside Projects (`docs/product/film-studio.md`). Server-side persistence/discovery does not exist. Phone JSON import/read/Create handoff exists; native stage editing and S8 master export are separate remaining work, not solved by adding a list screen |
| Continue watching | `/api/v1/cinema/progress` merged (#1434); migration 0355 unapplied per frozen work order, live application **not verified**. `watchProgress`/`CINEMA_WATCH_PROGRESS_ENABLED` absent/off in both environments (`wrangler.jsonc`, interpreted by `lib/cinema/features.js`). Needs owner migration/activation and account-isolation proof, then phone list/save/seek/dismiss integration |
| Draw on image | Canvas/dependency decision and S7 source-size PNG mask proof outstanding; no new dependency is selected by these docs |
| Enhance | Web feature is not live per parity decision; source/live release readiness **not verified**. Web product/implementation decision precedes native S9 |
| Paid Cinema | Read-only Pass is built; store product, webhook mapping/migration, double-billing guard and credit-subscription decision remain (ADR-0143). Production packed subscriptions/unlocks are false, staging true (`wrangler.jsonc`, `lib/cinema/features.js`); that does not create a phone store purchase path |

The remaining PARITY scope also includes complete inbox/workflow editing, creator forms, multi-item/device Publish media, magic-link sign-in, privacy-export and analytics decisions. Real-device and provider acceptance is not inferred from native screens.

| Spike | Gates |
|-------|-------|
| S1 Web editor in a web view, export 1080p | Harness built; real iPhone/Android proof blocks P4 |
| S2 Passkeys on a native build | Native enrolment and sign-in blocked; list/remove already built (P7) |
| S3 Resumable 1 GB upload | Native creator upload blocked; web continuation shell only (P6) |
| S4 Import shared web logic | Film/Oddlings ported logic and drift tests exist; real-device qualification **not verified** (P8) |
| S5 to S7 Chat attachment, long chat turn, draw mask | P2, P3 |
| S8 Film 16:9 master on device | Film Studio master (P8) |
| S9 Enhance on device | After the web decision |

## 7. Track F: parity phases (owner rule, 2026-10-19: every web feature on the phone)

Original scope, sizes and spike criteria are in [../PARITY-2026-10-19.md](../PARITY-2026-10-19.md). That dated parity inventory is not a current completion or flag report; current source status is above and remaining blockers are below. Phases retain the planned order; a phase never starts while another mobile PR touches the same screens. At most two mobile sessions work at once, in separate folders, and only one edits the tab shell.

| Phase | Scope | Exit gate |
|-------|-------|-----------|
| P1 | Navigation and first run, N1 to N8 (Track B) | Every screen reachable; a new person completes the walkthrough |
| P2 | Create and Library parity: options (aspect, seed, negative, count), Library source picker, filters, favourites, provenance, "Schedule this", clip edit add-audio and stems, Explore and presets | Each feature matches the web's behaviour on staging |
| P3 | Chat parity: per-message options, image attachments, stop, regenerate, rename and pin, Studio skills, Vey help | Spikes S5 and S6 pass; one charge on replay |
| P4 | Editor, per the S1 outcome | The web editor's feature areas work on a phone with a thumb; export passes the frame and audio checks |
| P5 | Publish parity in the order of the Publish audit: composer, disconnect, month view and analytics ranges, drafts and approvals, team, queues and autolists, reports, SmartLinks, then uploads, inbox, ads, commerce, developer keys, more networks | One real post per released network from the phone |
| P6 | Cinema parity: entitlements, tabs, discovery, share, saved and follows, winners, voting, polls; unlocks; Pass through in-app purchase; creator suite; upload; notifications | Screens verified on staging with flags on; paid access under App Store 3.1.1 |
| P7 | Account and platform: two-factor, password, devices, passkeys, magic link, brand kit, review links, grants, developer, search, catalogue pages, analytics decision, privacy export | Every web account control has a phone equivalent |
| P8 | Film Studio, Oddlings, Face Filters; Enhance after the web decision | Spikes S4, S8 pass |

**Owner decision 2026-10-19: the first public store release is full parity (all of P1 to P8), including creator tools.** TestFlight and Play internal builds still ship as milestones after each phase. Creator-uploaded video needs a written App Store 1.2 and Play AI-content plan before any submission.

## 8. Risks

1. **Store review on content:** Apple 1.2 and the Google AI-content policy. Block, report and consent are built; paid Cinema and anything new that shows other people's content re-opens it.
2. **Binding capacity:** Cinema grouping has landed (ADR-0145); actual deployed secret/var headroom is **not verified**. Check the current budget before rollout.
3. **Unproven on a device in this refresh:** bot check, sandbox purchase/refund, HLS token renewal, push, S1/S2/S3 and Film import/handoff. Simulator or Jest evidence does not prove real-device acceptance.
4. **One developer identity:** the wallet and this app share the Apple team and Play account. The hard wall applies to every screen and listing.
5. **Parallel sessions:** two sessions editing `apps/mobile` collide. Lanes are in the plan; a message, not an edit, is the way across.
