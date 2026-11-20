# Music P4 phone slices (social and public)

Audit of the web surface for Music P4 (`MUSIC-PLAN-2026-11-18.md`, row P4). Read-only against `main` at `7974c211d`. Paths are relative to the repo root; authenticated routes are under `/api/v1/music`, anonymous ones under `/api/music`. Flags are server facts: each route checks its own `MUSIC_RUNTIME_FLAGS` key, the phone never receives the flag set and probes by calling (`apps/mobile/src/lib/music/probe.ts`; a 404 with a typed `*_unavailable` code or `not_found` on a read means off). Flag state below is from the checked-in `wrangler.jsonc` (production and staging blocks both) and is re-verified at build time, not assumed.

## Audit

| Feature | Web evidence | Route and shape | Switch (`MUSIC_RUNTIME_FLAGS`) | Content kind |
| --- | --- | --- | --- | --- |
| Playlists | `MusicPlaylists.jsx`, `lib/musicPlaylists.js`, `0465_music_playlists.sql` | `GET /playlists` returns `{playlists:[{id,title,pinned,revision,created_at,songs:[{id,title,version_id,audio_url,position}]}]}`; `POST /playlists` `{title(1-80, no control chars), idempotency_key}` returns `{playlist}` 201, or 200 on replay (a reused key with a different title is `IDEMPOTENCY_CONFLICT`); `PATCH /playlists/:id` `{action:'replace', expected_revision, song_ids[<=100, unique UUIDs, own active songs], idempotency_key}` or `{action:'pin', expected_revision, pinned, idempotency_key}` returns `{revision, idempotent}`, 409 `revision` conflict carries the current `revision` | `playlists` on | Private, own songs only |
| Discover | `MusicDiscover.jsx`, `lib/musicDiscover.js`, `app/veyrnox/app/music/discover` | **No server route.** A static list of 13 listed samples (id, title, mood, bpm, key, duration, `recipe`), 100 resolvable by id. The web previews them with in-browser Web Audio synthesis. "Use this sample" opens Create with `?sample=<id>` and the tempo/drums/bass/melody mix, and the prompt is built by `buildMusicSamplePrompt`. Saving a mix is a separate web-only feature | none (static data); the generation it starts is the ordinary paid P2 create | None (first-party seeds) |
| Rails | `MusicTrackRails.jsx`, `lib/musicRails.js`, 0516 | No route of its own. Part of `GET /api/music/public/:slug` as `rails:{by_creator,similar}`, each at most 6 `{slug,title,handle,display_name}` | `rails` on (needs `publication`) | Other users' published tracks (UGC) |
| Best of | `lib/musicLyrics.js`, 0535 | `GET /api/music/best-of` (anonymous, no query) returns `{playlists:[{genre,tracks[]}]}` of published tracks | `bestOf` on | UGC |
| Public track | `MusicPublicTrack.jsx`, `app/veyrnox/music/tracks/[slug]` | `GET /api/music/public/:slug` returns `{track,lyrics?,plays?,reports?,social?,comments?,rails?}`; audio is `GET /api/music/public/:slug/asset` (302 to a presigned URL of 5 minutes) | `publication` on; each part has its own switch | UGC |
| Creator page | `MusicPublicProfile.jsx`, `app/veyrnox/music/creators/[handle]` | `GET /api/music/profiles/:handle` returns `{profile,tracks,social?}` | `publication` on | UGC |
| Private share | `app/veyrnox/listen/[token]`, `lib/musicDistribution.js` | `GET /api/music/shared/:token` (+ `/asset`); links are created by `POST /songs/:id/share-links` (built in P1, `lib/music/share.ts`) and revoked by `/share-links/:id` | `distribution` on | The owner's own song, shared by a secret link |
| Reactions and follows | `MusicSocialBar.jsx`, `lib/musicSocial.js` | `GET /social?slug=` or `?handle=` returns `{social:{reactions{fire,love,wow,praise,like,cool,hot},follower_count,my_reaction,following,is_own}}`; `POST /social` `{slug,reaction|null,idempotency_key}` or `{handle,following,idempotency_key}` | `reactions`, `follows` on | Acts on UGC |
| Comments | `MusicTrackComments.jsx`, `lib/musicComments.js` | `GET /comments?slug=&before=` (approved plus the caller's own pending or rejected); `POST /comments` actions `submit` (`body` 1-1000, `at_seconds` 0-600, `parent_id`), `withdraw`, `report` (`category` spam, abuse, privacy, rights, other; `details` 3-500). Every comment waits for an administrator before anyone else sees it | `comments` on | UGC |
| Plays | `lib/musicPlays.js`, 0533 | `POST /comments` `{action:'count_play', slug}` returns `{counted}`; the public total is `plays.count` on the public track | `plays` on | Counter |
| Song reports | `MusicTrackReport.jsx`, `lib/musicPlays.js` | `POST /comments` `{action:'report_song', slug, category, details, idempotency_key}`; 201 `{status:'reported'}`, 409 `own_song`, 429 with `Retry-After` | `songReports` on | Moderation intake |
| Publication | `MusicPublicationDialog.jsx`, `lib/musicPublication.js` | `GET/POST/DELETE /songs/:id/publication`; POST `{version_id,handle,display_name,allow_comments,allow_remixes,rights_confirmed:true,idempotency_key}` returns `{publication:{...,slug,handle,url,profile_url}}`; a server policy check can refuse with `publication_not_allowed` | `publication` on | Makes the owner's song public |
| Distribution (export, share) | `MusicDistributionDialog.jsx` | `songs/:id/export-quotes`, `exports` (P3e, not P4), share links (P1) | `distribution` on | Owner's own |
| Ranking and Labs | `labs-rank` | `GET /labs-rank` (next pair), `?song_id=` (`allow_ranking`), `POST` set ranking or submit a pick | `labs`, `ranking` on | UGC pairs |
| Collaboration | `lib/musicCollaboration.js` | `GET/POST /collaboration`: profile, invitations, workspaces | `collaboration` on | Invitations between users |

Also `references` and `magicBar` are false (out of scope) and `beatCloud` / `beatLibrarySave` are absent (the beat-editor sessions own them).

### Facts that decide the slice order

1. **Discover is not a feed.** It is a static sample catalogue plus a Create prefill. On the phone the faithful, native version is a browse-and-filter list that opens the existing Create screen with the sample's prompt. The web's synthesised preview has no native equivalent (the phone plays files, not Web Audio), so a preview is not in P4a and is recorded as a non-goal. The sample recipe text lives in `lib/musicDiscover.js`; the phone keeps a copy of the 13 listed seeds with a drift test, never a runtime import.
2. **Rails and Best of are other users' published tracks.** They are user-generated content. App Store guideline 1.2 requires report and block before a user-made surface ships, so they cannot ship in the listening-only slice. They move behind P4b.
3. **The public track and creator reads carry comments and counts inline**, so the public-page slice (P4c) has to follow P4b.
4. **Blocking**: the Cinema block list (`src/app/(app)/blocked.tsx`) is a Cinema feature. Whether a Cinema block hides a Music creator is not established from this audit and almost certainly needs server work (a block that the public track, creator and comment reads honour). That is an owner decision for P4b, not something mobile can fake.
5. **Reports and withdraw/comment writes are not paid and not AI-bound.** A comment, reaction, follow, report, publication or playlist edit sends user text to our own server for moderation or storage, not to an AI provider, and spends no credits. They are therefore not registered in `CONTENT_POSTS` (`aiConsent.ts`) or `PAID_ACTIONS` (`hardPaywall.ts`); the tests must prove that classification through the real client guard (the call goes through with no consent and no paywall prompt) so a later regression is visible. Publication makes a song world-readable, so it needs its own explicit confirm and rights step (P4c) even though it is not paid.

## Moderation needs

| Surface | Needs before it ships |
| --- | --- |
| Playlists, Discover | Nothing (own songs, first-party seeds) |
| Public tracks, rails, Best of | Per-track report (`report_song`) and a way to block the creator |
| Comments | Report per comment (`report`), block of the author, own-comment withdraw, the "waits for review" state shown honestly, and a server-honoured block |
| Reactions, follows | Block hides the creator and their counts' targets; follows and reactions are reversible |
| Publication | Rights confirmation, takedown (unpublish) visible, a policy refusal shown plainly |

## Slices

| Slice | Contents | Server gates | Moderation | Native config |
| --- | --- | --- | --- | --- |
| **P4a (this change)** | Playlists (list, create, rename not available on the server, pin, add and remove songs, reorder, listen in the existing player) and Discover samples (browse, filter, open Create with the sample prompt) | `playlists`; none for Discover (Create keeps its own gates) | None needed | None |
| P4b (needs the owner's word) | Report and block foundation for Music, then the public track read (listen only), reactions, follows, comments, song reports, play counts, rails, Best of | `publication`, `reactions`, `follows`, `comments`, `plays`, `songReports`, `rails`, `bestOf` | The whole section above; a server-honoured block is probably required | None |
| P4c (needs the owner's word) | Publication and unpublish dialogs, creator page, public track page, private share pages, app links for `/music/tracks/`, `/music/creators/`, `/listen/` | `publication`, `distribution` | Takedown and rights; reuse P4b | `app.json` associated domains and intent filters: **a store rebuild is required**, and `lib/mobileAppLinks.js` plus the server association files are touched on the server side |
| Later | Ranking and Labs, collaboration invitations and workspaces | `labs`, `ranking`, `collaboration` | Pair content is UGC | None |

## P4a contract (summary; the plan document in the build carries the detail)

- New `playlists*` library files under `apps/mobile/src/lib/music/` (typed client functions, a strict validator for every field the server returns, an attempt/revision helper) and `musicDiscover*` data. No change to the P3 song-action files, the beat-editor files, the Audio hub or any server code.
- Every create and patch has one idempotency key per attempt (built from parts in fixtures). Ambiguous outcomes keep and replay the same key; a revision conflict reloads and never auto-retries with a merged list. Reorder and remove use the server's `replace` action with the full list and the expected revision.
- The playlist title cannot be changed (the server has no rename), so the phone does not offer rename.
- Playback reuses `MusicPlayer` and the player rule that playback pauses in any app state other than active. A playlist plays its songs in order, each song's `audio_url` is relative and goes through the authenticated asset path used by the library.
- Entry points are two rows on the Music hub screen (`music/index.tsx`), each with its own icon from `src/lib/menuIcons.ts`, never the Audio hub.
- All new copy is in all eleven locales (machine translation for ten, native review pending).

## P4b status (2026-11-20)

P4b (Explore, public track and creator screens, reactions, follows, comments, reports, play counts, rails, Best of, Blocked creators) is built on top of the server block of PR #2523 (migration 0570, ADR 0367, switch `blocks`). Everything on the phone hides until the server `blocks` switch is on. Known follow-ups left by the final inspection (not fixed, budget used): social controls and the track-report form flicker on every reload because social state is cleared while refreshing; one flow-wide rate-limit gate silently disables all writes on a screen after any 429; a comment report depends on the comment still being on the page named by the route cursor, so a first-page comment that moved to page 2 cannot be reported from that entry point (pass `author_id` and name as route params and report by id). Not verified: real `expo-audio` playback of the 302 asset redirect, any device.
