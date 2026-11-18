# Music on the phone: build plan

**Status:** Proposed 2026-11-18, against `main` at `25155a33d`. From three read-only audits; nothing was run on a device or against production.
**Decision (owner, 2026-11-18):** go with the recommendation: run P0 and Spike B1 in parallel, then P1 to P4; decide P5 from the spike result.
**Reads with:** [PARITY-2026-10-19.md](PARITY-2026-10-19.md) (owner decision: every web feature exists on the phone), ADRs 0345 to 0349 (web Music).
**ADR:** take **0352** for "Music in the mobile app" when P0 is built (0350 and 0351 are on main; PR 2401 only amends 0351). Re-check open PRs first.

## Where we are

The phone has a generic audio create form (`audio.tsx`, `lib/audioHub.ts`) and Instruments (`instruments.tsx`, reusing `lib/musicInstruments.js` through `lib/instrumentShared.ts`). It makes no `/api/v1/music/*` call. The web has about 60 such routes.

## Finding that shapes every phase: flags are server-side only

`lib/musicRuntime.js` evaluates `MUSIC_RUNTIME_FLAGS` inside each route, and an off feature answers a typed error (for example 404 `music_unavailable`). No route hands the flag set to a client. So the phone **probes by calling**: a 404 or typed "unavailable" hides the entry. No new server route is needed. Each phase therefore needs a "feature off" empty state and a test with a mocked 404.

Production state (from `wrangler.jsonc`, not the live deploy): all on except `references` and `magicBar`; `beatCloud`, `beatLibrarySave` and the mixdown flag are absent (off). `beatAi` is on in the JSON; ADR-0347 still says qualification is pending. Do not build screens for off features.

## Phases

| Phase | Scope | Size | Pass means |
|---|---|---|---|
| **P0** groundwork | `src/lib/music/` typed client over `/api/v1/music/*`; seams over shared web modules (same pattern as `instrumentShared.ts`): `musicLibraryTabs`, `musicLyrics`, `musicPlaylists`, `musicTempoControls`, `musicRemix`, `musicWavRender`; probe-by-call flag helper; ADR 0352 | 3 days | `entitlements` and `library-tabs` answer against staging; Metro bundles the shared modules on iOS and Android; web Node tests still pass |
| **Spike B1** (parallel, real iPhone + mid-range Android) | Can the web beat engine (`_components/music/beat/*`) run in a web view with usable audio latency and no memory kill? | 1 week | Pad hit to sound under 100 ms; 8 tracks play 5 min; survives backgrounding. Fail means a phone-scoped native editor |
| **P1** library and player | Library tabs, song detail, versions, background-safe player (`expo-audio`), delete, share link; "Your music" entry in the Audio hub | 1 to 2 weeks | A song made on the web plays on the phone; list pages; 404 shows the off state |
| **P2** create | Custom lyrics, styles, `generation-quotes` before spend, candidate cards, queue, lyrics panel; replaces the generic form for music models | 2 weeks | Price shown before spend; one charge on replay (idempotency key reused); candidates land in the library |
| **P3** song actions | Stems, target stems, extend, cover, replace and add section, crop, tempo and key, export. Each is quote, confirm, commit. One PR per action, each behind its flag | 3 weeks | Each action quotes first and the balance moves once |
| **P4** social and public | Discover and rails, playlists, publication and distribution dialogs, comments, reactions, follows, plays, report; app links for `/music/tracks/`, `/music/creators/`, `/listen/` | 2 to 3 weeks | App Store 1.2: report and block reach every user-made surface (reuse the Cinema ones); links open the app |
| **P5** beat editor, labs, studio | Shape set by Spike B1: web engine in a shell, or a native step sequencer, pads, mixer and takes. Then labs, sounds, workspaces, mixdown, Beat AI | 6+ weeks | Decided after B1 |

Order: P0 and B1 together, then P1, P2, P3, P4 in that order, then P5.

## Not building yet

`beatCloud`, `beatLibrarySave`, `magicBar`, `references` and mixdown are off in production. Revisit each when its flag is on.

## Traps to keep in view

- The web Worker is at its binding cap. The phone adds no server flags; probing by call avoids one.
- Credits on the phone follow the store-only rule (roadmap decision 4). Music spends credits only; no web link-out.
- Mobile ADRs 0121 to 0142 were proved against a mock. Prove each music parser against staging, not only a mock.
- Canonical native build and simulator environment is the `veyrnox-mobile-app-f52c2f` worktree; do not create another install.
- Big phases go to Codex through claudex-loop; this plan is the brief's source.

## Unverified

Depth of each web component (read by file name and ADR header); whether the music routes accept the phone's token as they do the web's; real audio latency; whether the shared web modules bundle under Metro as-is (P0 proves it).
