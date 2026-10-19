# App flow: Veyrnox.ai mobile app

**Status:** Proposed 2026-10-19; routes read from `apps/mobile/src/app/` on `main` at `4768d535`. Target navigation is from [../USER-JOURNEY-2026-10-19.md](../USER-JOURNEY-2026-10-19.md) and the owner's answers of 2026-10-19. The diagrammed version is the journey artifact.
**Reads with:** [PRD.md](PRD.md), [UI-UX.md](UI-UX.md), [TRD.md](TRD.md).

Existing behaviour is marked *(today)*; new behaviour *(new)*.

## 1. Route map

| Route | Purpose | Auth |
|-------|---------|------|
| `/` | Splash and redirect to sign-in or the app *(today)* | none |
| `/sign-in`, `/email` | Apple, Google, email with the bot check, 18+ tick *(today)* | none |
| `/(app)` | Home: balance and a button list *(today)*; Explore home *(new, N4)* | signed in |
| `/create`, `/create/[modelId]`, `/create/presets`, `/create/agent` | Models, templates, Auto Short and video agent *(today)* | signed in |
| `/job/[id]` | Wait, then result: Save, Share, Report, Delete *(today)*; Edit, Publish, Make another *(new, N5)* | signed in |
| `/library`, `/library/files` | Creations, film masters, editor renders *(today)* | signed in |
| `/edit` | Quick edit: trim, join, captions *(today)* | signed in |
| `/projects`, `/projects/[id]` | Workspaces and projects, read-only *(today)* | signed in |
| `/chat`, `/chat/new`, `/chat/[id]`, `/chat/personas`, `/chat/folders` | Chat with Vey *(today)*; reached from the mascot *(new, N8)* | signed in |
| `/cinema`, `/cinema/[id]`, `/cinema/watch/[id]` | Feed, title page, player *(today)*; list readable signed out *(new, N2)* | list none, play signed in |
| `/publish`, `/publish/accounts`, `/publish/compose`, `/publish/posts`, `/publish/post/[id]`, `/publish/analytics` | Plan paywall, accounts, compose, posts, analytics *(today)* | signed in |
| `/credits`, `/history` | Buy credits, credit history *(today)* | signed in |
| `/account`, `/help`, `/appeals`, `/report`, `/referrals`, `/blocked`, `/delete-account` | Account and safety *(today)* | signed in |
| `/welcome/*` | First-run cards and credits explanation *(new, N3)* | none, then signed in |

## 2. Navigation model

*Today:* one stack. Home lists nine buttons. There is no tab bar.

*New (N1):* five bottom tabs in this order: **Explore**, **Cinema**, **Create** (centre), **Library**, **Publish**. Every tab shows the Credits chip in its header (opens Buy credits and Credit history) and an avatar (opens Account). The **Vey mascot** floats over every signed-in screen and opens chat as a sheet (N8). Screens that are not tabs (Edit, Projects, Library files, Referrals, Help, Blocked) stay reachable from Library, Explore and Account.

## 3. Phases

```
Install ─► Launch ─► Preview ─► Sign in ─► Credits explained ─► Explore ─► Create ─► Wait ─► Result
                                                                              │                  │
                                                                              └── Vey chat ──────┤
                                                              Edit ◄──────────────────────────────┤
                                                              Publish ◄───────────────────────────┘
```

## 4. First run *(new, N2 and N3)*

1. **Launch.** A splash states the promise in one line, then three intro cards (Make, Edit and Publish, Watch). Skippable. Shown once; resettable from Account for testing.
2. **Preview.** Explore and the Cinema list are readable signed out, from anonymous public data only (`/api/catalog`, `/api/presets`, `/api/cinema/*`). Playing, creating and buying ask to sign in and return to the same place.
3. **Sign in.** As today. The 18+ tick stays before any provider button.
4. **Credits.** One screen: what a credit is, and "You have N free credits" with N read from the server, never a fixed number. No purchase is required to try.
5. **Permissions in context.** Photos at the first pick; push after the first job that runs long; nothing at install.
6. **Land.** Explore with a prompt box and presets.

## 5. Create to publish *(today, with the gaps marked)*

1. Pick a template or type a prompt on Create. The price shows before payment. *(today)*
2. First send: the AI consent sheet (ADR-0128). *(today)*
3. Submit with an idempotency key; the job screen waits, polling, and a push arrives if enabled. *(today)*
4. Result: Save to Photos (permission asked once), Share, Report, Delete. *(today)* **Edit, Publish and Make another do not exist yet.** *(new, N5)*
5. Edit: quick edit renders on the server and the clip lands in Library. *(today, reached from Home only)*
6. Publish: the composer picks a Library file, accounts, text, now or later. *(today)* First time with no account: Connect (needs provider redirects). *(today, unproven)*
7. Posts list shows status. A push on publish or failure. *(new)*

## 6. Failure paths

Every row says what the person sees and what happens to their credits.

| Failure | What the person sees | Credits |
|---------|----------------------|---------|
| Offline | Banner; cached Library and balance; paid actions refuse to start | None debited |
| 401 on any call | One silent refresh and retry; on failure, signed out with the sign-in screen | None |
| 429 | "Try again in a moment" (Retry-After to be surfaced) | None |
| Balance too low | Prompt before the job, with Buy credits *(new, N6)* | None |
| AI consent declined | The send does not happen | None |
| Provider failure after submit | The job screen says it failed | Refunded to the source it came from (ledger refund) |
| Cancel while running | Stops waiting; the job keeps running (ADR job-cancel options) | Settled by the job outcome |
| Store purchase fails or is cancelled | Message on Buy credits; nothing credited | None |
| Purchase refunded by the store | Balance reduced by the clawback; nothing shown unless it empties the balance | Clawback caps at the Pack balance |
| Push denied | The job screen still polls while open; Library shows the result later | None |
| Deep link while signed out | Sign in, then land on the target | None |
| Locked Cinema title | Reason shown, not a spinner | None |
| Account deletion blocked (Frozen or held account) | The server's reason on the delete screen | Balance left as it is |

## 7. Out of the phone, on purpose

Multi-track timeline, creator upload, Publish developer keys, ads, SmartLinks, inbox. Each shows a "Continue on web" row, not a dead end.
