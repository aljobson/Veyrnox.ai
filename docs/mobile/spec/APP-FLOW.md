# App flow: Veyrnox.ai mobile app

**Status:** Source refresh 2026-10-20 against checkout HEAD `df14bedb`; live deployment and device behaviour not verified.

**Evidence boundary:** Source baseline and PR-query evidence are recorded in [README.md](README.md). Paths beginning `src/` are relative to `apps/mobile/`; other repository paths are relative to this checkout. Configuration states are source values, not a live environment inspection; see [TRD section 3](TRD.md#3-configuration-and-flags).
**Reads with:** [PRD.md](PRD.md), [UI-UX.md](UI-UX.md), [TRD.md](TRD.md).

Existing behaviour is marked *(today)*. Headings containing *(new)* retain historical slice names; their current implementation state is stated below.

## 1. Route map

Route files are under `apps/mobile/src/app/`. `(app)` and `(tabs)` are groups, not URL segments. The table groups the verified routes; helpers such as `_layout.tsx` and `+native-intent.tsx` are not screens.

| Route | Purpose | Auth |
|-------|---------|------|
| `/` | Loading indicator, then sign-in or signed-in tabs | none |
| `/sign-in`, `/email`, `/preview` | Sign-in, email, public templates/Cinema preview | none |
| `/welcome` | Once-per-install welcome after sign-in | signed in |
| `/(app)/(tabs)`; `/create`, `/cinema`, `/library`, `/publish` | Explore and the other four tabs | signed in |
| `/create/[modelId]`, `/create/presets`, `/create/agent`, `/create/tools` | Form, templates, agents, file-tool directory | signed in |
| `/job/[id]`, `/edit`, `/library/files` | Result/next steps, quick edit, film masters/editor renders | signed in |
| `/projects`, `/projects/[id]`, `/brand-kit` | Projects read-only; brand kit | signed in |
| `/chat`, `/chat/new`, `/chat/[id]`, `/chat/personas`, `/chat/persona/[id]`, `/chat/folders`, `/chat/move` | Chat and organisation | signed in |
| `/cinema/[id]`, `/cinema/watch/[id]`, `/cinema/comments`, `/cinema/report-comment`, `/cinema/analytics`, `/cinema/probe` | Titles, playback, comments, reporting, analytics, playback probe | signed in |
| `/publish/accounts`, `/publish/connect`, `/publish/brands`, `/publish/compose`, `/publish/drafts`, `/publish/posts`, `/publish/post/[id]` | Accounts, compose, drafts/posts | signed in |
| `/publish/analytics`, `/publish/calendar`, `/publish/best-time`, `/publish/approvals`, `/publish/reports` | Planning, review and reporting | signed in |
| `/publish/queues`, `/publish/queue-edit`, `/publish/autolists`, `/publish/autolist-edit` | Queue and RSS autolist management | signed in |
| `/publish/inbox`, `/publish/inbox-thread`, `/publish/contacts`, `/publish/contact-edit` | Read-only inbox; contacts editing | signed in |
| `/publish/smartlink`, `/publish/ads`, `/publish/ads-edit`, `/publish/commerce`, `/publish/commerce-edit` | SmartLink, ad drafts, product catalogue | signed in |
| `/publish/team`, `/publish/activity`, `/publish/developer`, `/team-invite` | Team, activity, keys/webhooks/logs, invitation | signed in |
| `/oddlings`, `/oddlings/[id]`, `/oddlings/build`, `/oddlings/saved` | Characters, builder and install-scoped saved passports/draft (account cleanup unresolved; SCHEMA section 2) | signed in |
| `/film`, `/film/shot/[id]` | Imported web Film Studio export, stages, shots and Create handoff | signed in |
| `/credits`, `/history`, `/topups`, `/account`, `/security` | Billing/history and account/security | signed in |
| `/help`, `/appeals`, `/report`, `/referrals`, `/blocked`, `/delete-account` | Help, safety and account actions | signed in |
| `/models`, `/pricing`, `/search`, `/about`, `/oauth-consent` | Catalogue, search, product info, assistant consent | signed in |
| `/review` | Publish post approve/reject entry | No account required; signed link token is the credential (`src/lib/shareLinks.ts`) |
| `/dev-s1-editor` | S1 WebView test harness | Signed in; development-only harness checks |

OAuth hand-back is on the **site**, not an Expo screen: `/auth/mobile` and `/social/connect/mobile/:network` return to the constant app schemes (TRD section 2.9).

## 2. Navigation model

*Today:* five tabs in source order **Explore, Create, Cinema, Library, Publish**, with text labels and no icons. `HeaderChips.tsx` supplies Credits and Account. The stack above the tabs contains detail/tools/account screens. `VeyMascot.tsx` opens a chat/help sheet on the four non-Cinema tabs; it is not on every signed-in screen.

The earlier target order (Explore, Cinema, centred Create, Library, Publish), icon treatment and universal mascot coverage remain design intent, not implemented facts. The source order is documented here without changing the app.

## 3. Phases

```
Launch → Sign in ───────────────────────→ Welcome (once) → Explore → Create → Wait → Result
           └→ Public preview → Sign in                                  │          ├→ Edit
                                                    Vey sheet ←────────┘          └→ Publish
```

Preview is optional from sign-in, not the cold-launch default. Film import and Oddlings can hand a draft to Create; that handoff never spends Credits.

## 4. First run *(new, N2 and N3)*

The heading retains the original slice naming; N2/N3 are now built (`src/app/preview.tsx`, `src/app/(app)/welcome.tsx`, `src/lib/firstRun.ts`).

1. **Launch/sign-in.** Root redirects signed-out users to sign-in; the 18+ check precedes provider sign-in. Browse first is an optional text-link entry there (#1445).
2. **Preview.** Public templates and the Cinema list use anonymous reads; selecting an item opens sign-in. Returning automatically to that specific item is not implemented in this screen.
3. **Welcome after sign-in.** Three skippable cards (`hello`, `credits`, `start`); a versioned SecureStore seen flag; an Account reset control is not implemented in the inspected source. No pre-auth looping preview sequence is claimed.
4. **Credits.** Reads `free_credits` from `GET /api/v1/balance`; shows a number only when positive and readable, otherwise explains Credits without promising a grant.
5. **Permissions.** Media and push remain contextual; real permission prompts on iOS/Android are **not verified** in this refresh.
6. **Land.** Explore: prompt collage, templates before the Oddlings banner (#1447), then Recent. An unfinished-creation card can appear above templates.

## 5. Create to publish *(today, with the gaps marked)*

1. Choose a model/template or a Library input. Model-supported options include resolution/audio, aspect, seed and image count; the form shows price and a low-balance Buy credits card that preserves the prompt.
2. Accept AI consent before the first provider send. Generate uses an idempotency key; the job screen polls and explains refunds on failure.
3. Result offers output-appropriate Edit, Publish and Make another, then Save/Share/Report/Delete (`src/lib/nextSteps.ts`). Quick edit supports trim/join/captions and sound; stem results are available through the tools.
4. Publish accepts a Library creation, destination accounts, global/per-network text, YouTube visibility, now/schedule/queue. Schedule is the default in `src/app/(app)/publish/compose.tsx` (#1438); before account selection, the per-account text area explains how to enable it (#1445).
5. Successful submit opens Posts with a scheduled, queued or posting-now confirmation (#1441); posting-now is not proof that the provider has published it. Posts show status; draft approve/discard, approvals, month calendar and analytics ranges are built. Provider account connect needs external redirect registration; real posts are **not verified**.
6. Publish completion/failure push is not verified as built; the implemented push contract is generation-job notifications.

Account places Sign out directly under the email (#1445). Continue watching (#1452), dedicated Face filters (#1453), Publish workflows and Plan status (#1454), Help guides (#1455) and Face Filters docs (#1446) are in review; their proposed screens are not added to this baseline route map.

A Cinema creator's Upload card only opens the website. Pass is read-only; paid purchase flows and native resumable upload remain blocked. Film Studio can import a web export, but cannot discover browser-local projects across devices.

## 6. Failure paths

Every row says what the person sees and what happens to their credits.

| Failure | What the person sees | Credits |
|---------|----------------------|---------|
| Offline | Banner; cached Library and balance; paid actions refuse to start | None debited |
| 401 on any call | One silent refresh and retry; on failure, signed out with the sign-in screen | None |
| 429 | Rate-limit error; `src/lib/api.ts` parses Retry-After. Consistent screen presentation is **not verified** | None |
| Balance too low | Built pre-submit low-balance card with Buy credits; prompt retained | None |
| AI consent declined | The send does not happen | None |
| Provider failure after submit | The job screen says it failed | Refunded to the source it came from (ledger refund) |
| Cancel while running | Stops waiting; the job keeps running (ADR job-cancel options) | Settled by the job outcome |
| Store purchase fails or is cancelled | Message on Buy credits; nothing credited | None |
| Purchase refunded by the store | Balance reduced by the clawback; nothing shown unless it empties the balance | Clawback caps at the Pack balance |
| Push denied | The job screen still polls while open; Library shows the result later | None |
| Deep link while signed out | App-link mapping preserves supported targets; preview item selection only opens sign-in. Device return behaviour **not verified** | None |
| Locked Cinema title | Reason shown, not a spinner | None |
| Account deletion blocked (Frozen or held account) | The server's reason on the delete screen | Balance left as it is |

## 7. Out of the phone, on purpose

Current explicit web continuations include full editor work, Film Studio editing/master preparation, adding passkeys and the Cinema creator upload shell. These are parity gaps, not permanent exclusions. Publish developer keys, ad drafts, SmartLinks and the read-only inbox now have native screens; the old blanket web-only list no longer applies. See IMPLEMENTATION-PLAN for S1/S2/S3 and persistence blockers.
