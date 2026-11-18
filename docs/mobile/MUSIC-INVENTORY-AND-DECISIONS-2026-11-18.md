# Music on the phone: inventory, phone fit and owner decisions

**Status:** Proposed 2026-11-18, against `main` at `b7dec3457`. Read-only audit; nothing was run on a device or against production.
**Companion to:** `MUSIC-PLAN-2026-11-18.md` (open PR 2406, the phase order the owner chose) and the beat-engine spike (open PR 2407). This doc does not change that order. It adds the web inventory, the phone/web split, price and store rules, and the decisions the owner still owes. If the plan and this doc disagree, the plan's order wins and this doc's details feed it.
**No supplier names in anything a user sees.** Copy says "music model", "stems", "beat". Model ids stay in the catalog and in code.

## 1. What the web Music section contains today

Source: `app/veyrnox/app/music/*`, `_components/music/*` (about 60 files; 57 in `beat/`), `app/api/v1/music/*`, `lib/musicRuntime.js`, ADRs 0335, 0345, 0346, 0347, 0349 and `docs/product/music-beat-editor-design-2026-11-15.md`.

Web nav (`MusicPreviewShell.jsx`): Create, Discover, Instruments, Music Library, Workspaces, Playlists, Sounds, Beats, Labs. Studio redirects to Beats.

| Area | What it does | Main routes under `/api/v1/music` |
|---|---|---|
| Create | Simple prompt, or Custom (saved draft: styles, lyrics, instrumental, rights confirmation). Quote first, then one paid request that makes two candidates (A and B), each refundable on its own. Tempo, key, time signature, variety, style influence and excluded styles on the premium model | `entitlements`, `generation-quotes`, `generations[/id]`, `drafts/custom` |
| Library | Songs with versions, search, trash and restore, move between workspaces, library tabs (history, liked and similar), covers, plays | `songs`, `songs/[id]`, `songs/move`, `library-tabs` |
| Song actions | Crop, reverse, remix (quote then confirm), extend, replace section, add section, cover, reuse lyrics and styles, render and export WAV | `songs/[id]/crop`, `render`, `extends`, `replacements`, `sections`, `covers`, `reuse`, `exports`, `*-quotes` |
| Stems | Stems, target stems (pick an instrument), add a track. Each is quote, confirm, poll | `stems`, `target-stems`, `track-adds`, `stem-requests`, `target-stem-requests`, `track-add-requests` |
| Lyrics | Lyrics panel and lyricist profiles | `songs/[id]` (lyrics included), `drafts/custom` |
| Sources | Upload your own audio with a rights attestation | `sources` |
| Playlists | Create, edit, order | `playlists[/id]` |
| Social and public | Publication, distribution, public track and creator pages, share links, comments, reactions, follows, reports, notifications, rails, "Best of" | `songs/[id]/publication`, `share-links`, `comments`, `social`, `songs/[id]/feedback` |
| Discover, Labs, Best of | Public discovery shelves; Labs is unpaid listen-and-rank (`labs-rank`) | `social`, `labs-rank` |
| Workspaces | Shared workspaces and collaboration | `workspaces`, `collaboration` |
| Instruments | Playable instruments with takes | none (local) |
| Beats (editor) | Step grid and pads, arrangement timeline, library panel and audio regions, piano roll, cloud save and versions, export and save to Music, AI parts, mixer and automation, recording and take lanes, polish. Design doc phases 1 to 10 | `beat-projects` and children (`versions`, `takes`), `mixdowns` |

Beat editor phase state (from the ADRs; confirm against `main` before relying on it): phases 1 to 9 merged; ADR-0345 cloud save (phase 5), ADR-0346 mixdown (phase 6), ADR-0347 AI parts (phase 7, 5 Credits a part, so 10 per Generate of two alternates), ADR-0349 microphone (phase 9, one route header). Phase 10 polish is in a separate open PR.

### Production switches

`MUSIC_RUNTIME_FLAGS` in `wrangler.jsonc` is on for everything except `references` and `magicBar`. `beatCloud`, `beatLibrarySave` and the mixdown switch are absent, so off. `beatAi` is on in the JSON although ADR-0347 still says qualification is pending. Flags are read inside each route; no route returns the set. The phone therefore probes by calling (a typed 404 hides the entry), as the plan says.

## 2. What fits a phone, and what stays web-only

Test used: a person can do it one-handed, in short sessions, with a 6-inch screen and no keyboard.

| Verdict | Items | Why |
|---|---|---|
| **Phone, first** | Library and player; song detail and versions; trash and restore; Create (simple, then custom); candidates A/B with price shown first; share link | The "my music is missing" gap. Short sessions, background listening, push when a song finishes (push infrastructure already exists, ADR-0113) |
| **Phone, next** | Stems, extend, cover, crop, tempo and key, export; playlists; audio templates and "make a beat from a template" using the existing create path | Each is quote, confirm, poll, so one reusable sheet |
| **Phone, with App Store work** | Discover, public pages, comments, reactions, follows, publication, reports | Needs report and block on every user-made surface (guideline 1.2) and app links for `/music/tracks/`, `/music/creators/`, `/listen/` |
| **Phone, decided by the spike** | Beat editor: pads, step grid, a small mixer, record a take, save to Music | Needs low-latency audio and memory headroom. Spike B1 decides web view or native |
| **Web-only for now** | Arrangement timeline with many tracks, piano roll, automation lanes, MIDI, latency calibration, workspaces and collaboration, Labs ranking, lyricist profiles, distribution dialogs | Dense, precision-pointer editing; the design doc already scoped the editor "web only for phases 1 to 10" (D8). Show a "continue on the web" card, never a dead end |
| **Skip until the switch is on** | Beat cloud save, beat library save, mixdown, magic bar, reference links | Off in production (and references reversed by ADR-0335). Do not build screens for off features |

The phone already has Instruments (`instruments.tsx`), the audio hub (`audioHub.ts`) and audio templates (`audioTemplates.ts`, read from `GET /api/templates?kind=audio`). The audio hub's music card opens a generic create form for a music model. That form does not call any `/api/v1/music/*` route, so songs made there are not in the web Music library. This is the root of the "the phone has no Music" finding and the reason P1 and P2 come first.

## 3. Build order, smallest slice first

Same phases as the plan; this adds the exact endpoints, switches and exit checks.

| Phase | Slice | Endpoints | Switches it needs | Done when |
|---|---|---|---|---|
| **P0** | Typed client, probe helper, shared pure modules (PR 2406) | `entitlements`, `library-tabs` | none | Answers against staging; Metro bundles the shared modules |
| **P1 (smallest useful)** | "Your music" entry in the audio hub. List songs, play one in a background-safe player, open detail, trash and restore | `GET songs`, `GET songs/[id]`, `PATCH songs/[id]`, `library-tabs` | `ui`, `schema`, `library` (`libraryTabs` for tabs) | A song made on the web plays on the phone with the screen locked; the list pages; a 404 shows "Music is not available right now" |
| **P2** | Create. Prompt, then custom lyrics and styles. Quote, show total, confirm, then two candidate cards, then they land in the library | `entitlements`, `generation-quotes`, `generations`, `generations/[id]`, `drafts/custom` | `generation`, `dispatch` | Price on screen before spend; replay with the same idempotency key charges once; failed candidate refunds on its own |
| **P2b (cheap win)** | "Make a beat from a template": audio template card opens P2 with the prompt filled and the option set | same as P2, plus `GET /api/templates?kind=audio` | as P2 | The templates the owner counts as missing are browsable by category and one tap from a quote |
| **P3** | Song actions, one PR each: stems, target stems, extend, cover, crop, tempo and key, export | the `*-quotes` route then its commit route | each action's own flag (`stems`, `targetStems`, `extend`, `cover`, `editing`) | Each shows the quote first; the balance moves once |
| **P4** | Playlists, Discover, publication, comments, reactions, follows, reports, app links | `playlists`, `social`, `comments`, `songs/[id]/publication`, `share-links`, `feedback` | `playlists`, `rails`, `publication`, `comments`, `reactions`, `follows`, `songReports` | Report and block reach every user-made surface; links open the app |
| **P5** | Beat editor, after the spike | `beat-projects` family, `mixdowns`, AI parts | `beatEditor` (+ `beatAi`; `beatCloud` and mixdown only once on) | Decided after PR 2407's device run |

Server work needed before P1 to P4: none found. The routes accept a Bearer token like the rest of `/api/v1`; confirm the phone token is accepted (the plan lists this as unverified) in P0.

## 4. Price and credit handling

- The catalog is normative. Music prices come back from the server in the quote (`credits_per_candidate`, `total_credits`, `balance`, `balance_after`, `affordable`, `expires_at`). The phone never computes a price and never hard-codes one, including the beat part price.
- One quote, one confirm. The confirm sends the quote id and a fresh idempotency key and keeps that key for any retry. A lost answer (`pair_acceptance_unknown`, 503) is replayed with the same key, never a new debit.
- Quote expires: show the countdown, re-quote on expiry, never confirm an expired quote.
- Two candidates are charged and refunded independently. The UI must say so before confirm ("2 versions, each charged separately; a version that fails is refunded").
- The premium music model needs a paid plan (`requires_paid_plan` and `available` in `entitlements`). Show a plain "needs a subscription" state with the in-app upgrade, not a hidden row.
- Credits follow the store-only rule (roadmap decision 4): Music spends credits that already exist; no web link-out to buy more. Top-ups use the in-app store flow. Do not mention web prices.
- Beat AI parts, when P5 gets there: use the quote it already has (`beat-ai.<uuid>` key), show balance after, never auto-submit on reload.
- Local actions (crop, reverse, WAV export, beat mixdown) cost zero Credits and write no ledger row. Say "free" only where the server says zero.

## 5. Store and privacy constraints

- **User-generated content (App Store 1.2):** report, block and a way to hide content on every public or shared surface (discover, public tracks, comments, playlists). Reuse the existing Cinema report and block screens. P1 to P3 ship no public surface, so they are not blocked by this.
- **AI disclosure and consent:** the phone already gates generation behind `aiConsent`. Music create reuses the same gate; no new wording that names a supplier.
- **Rights:** custom lyrics need the rights confirmation (`rights_confirmed`); uploaded audio and recorded takes need the rights attestation. Both are server requirements; the phone must show the checkbox and send the exact field.
- **Microphone (recording takes, P5):** a purpose string is needed in the app config; voiceover already asks (ADR-0302), so reuse its permission flow. Ask only when the person arms a track.
- **Background audio:** the player needs the audio background mode and an interruption policy; today only the editor and instruments play audio.
- **Account deletion and export:** songs and sources fall under account deletion (ADR-0111) and its classification test. Beat documents, versions and takes are explicitly excluded from automated privacy export (ADR-0345); that must be fixed on the server before `beatCloud` is turned on, and the phone must not offer cloud beat saves before then.
- **Push:** a "your song is ready" push goes through the existing sweep (ADR-0113); never from the generation path.
- **Data on device:** cache song lists and audio in the existing app cache with the same sign-out wipe as other private caches; presigned audio links are short-lived, so never persist them.
- **Review risk:** a first submission with a Music tab that lists nothing for a reviewer account looks broken. Seed a reviewer account or keep the entry hidden when the probe says off.

## 6. Risks

| Risk | Mitigation |
|---|---|
| Phone memory and audio latency in the beat editor | Spike B1 first; phone track cap; chunked render (the design doc already plans it) |
| Shared web modules may not bundle under Metro as-is | P0 proves it for the six named modules |
| Mocks passed for earlier mobile ADRs but failed on the real server | Prove each parser against staging in each phase |
| Flags are server-side only; a flag flipped off after release shows a dead screen | Every screen has an "unavailable" state and a mocked-404 test |
| Duplicate work across sessions (this area has had three open PRs in one day) | Check open PRs and `git worktree list` before each phase; one owner per phase |
| Drift between the ADR "pending" status and the live flags (`beatAi`) | Re-read `wrangler.jsonc` and the ADR headers at the start of P5 |
| Canonical native build is a single checkout | Build only in the `veyrnox-mobile-app-f52c2f` worktree; no second install |

## 7. Decisions the owner still owes

1. **Where Music lives in the navigation.** An entry inside the Audio hub ("Your music") is the plan's default. A top-level Music tab is bigger and changes the tab bar. Recommend the hub entry for P1 and revisit after P2.
2. **P2b first or after P2?** A template-to-quote shortcut gives the quickest answer to "where are the audio templates". Recommend building it with P2, not before.
3. **Beat editor on the phone: web view or native?** Spike B1's early read favours native; decide after the device run. Until then, P5 is unscheduled.
4. **Paid-plan model on the phone.** Show it locked with an in-app upgrade, or hide it? Recommend show locked, with plain wording.
5. **Public features timing.** P4 needs report and block on every surface. Ship P1 to P3 (private) first, or hold for P4? Recommend ship private first.
6. **Beat cloud, library save and mixdown.** Off in production. Does the owner want them on for web before the phone gets a beat editor? The phone cannot save beats to the account until they are.
7. **Privacy export for beat data.** ADR-0345 needs it before `beatCloud` is on. Owner to decide to add the export section or accept an explicit exclusion.
8. **Reviewer account.** Which seeded account holds a few songs for store review?

## 8. Unverified

Component depth (read by file names, route headers and ADRs, not run); whether `entitlements`, `songs` and `generation-quotes` accept the phone token (the plan's P0 checks it); live production flags (read from `wrangler.jsonc`, not the deployed Worker); beat editor phase merge state after 2026-11-17; real audio latency and background behaviour on a device.
