# Music: Suno feature parity spec

Status: draft for owner review, 2026-11-13. Nothing here is built or approved.

## 1. Purpose and scope

Veyrnox Music should cover what people expect from a prompt-to-song product, using Veyrnox's own credit, flag and rights rules. This spec lists what Suno's web app offers, what Veyrnox already has, and what to build next.

In scope: song creation, song actions, library and discovery, the studio, and the surrounding account surfaces.

Out of scope:
- Copying Suno's name, artwork, copy, layout pixels or models. Behaviour is replicated; brand and wording are ours.
- Voice cloning of a real person (see section 6).
- Hard wall: nothing here touches the Veyrnox wallet product.

## 2. How this was gathered

- **Suno side:** a signed-in walk of suno.com on 2026-11-13 using a free account (page text plus screenshots). Suno's generation step is behind a Cloudflare check that would not pass in the embedded browser, so these were **not observed**: the generating card, the two-versions-per-prompt result, stems, downloads, and the song menu on one's own song. Items marked "Suno (reported)" below come from Suno's own upsell and onboarding copy, not from using the feature.
- **Veyrnox side:** read from the repo at `7779d4f80` (components under `app/veyrnox/_components/music`, API routes under `app/api/v1/music`, flags in `wrangler.jsonc`). Status is from code and flags, **not** from running staging or production. Re-verify each "Built" row before relying on it.

## 3. Suno feature inventory

### 3.1 Create

| ID | Feature |
| --- | --- |
| S-C1 | Simple mode: one prompt box with rotating example placeholder, inline "+" menu (Lyrics, Styles, Playlist, Image, Video, Audio, Voice) |
| S-C2 | Advanced mode: separate Lyrics box (5000 chars, undo/redo, library, expand), Styles box (1000 chars, chips, wand, shuffle) |
| S-C3 | Lyricist: in-box lyric writer with suggestion chips and "ask to write lyrics" |
| S-C4 | Model picker (free mini model, two paid tiers) |
| S-C5 | More Options: vocal gender, duration (auto or custom), Max Mode, Weirdness, Style Influence, Variety, Personalize ("My taste") |
| S-C6 | Audio input: browse library, upload, record |
| S-C7 | Voice input: record or upload your own voice (Pro) |
| S-C8 | Inspo: inspiration input (Pro) |
| S-C9 | Song title (optional) and "Save to" workspace |
| S-C10 | Speech (beta): script, tone, vocal gender, background music, variety |
| S-C11 | Plain-text editing of an existing song ("cover this but add vocals from…", Suno (reported)) |

### 3.2 Song actions

| ID | Feature |
| --- | --- |
| S-A1 | Remix: Cover, Reuse prompt, Mashup, Sample this song |
| S-A2 | Edit: Extend, Reverse, Adjust speed |
| S-A3 | Stems (Pro), selective section edits (Suno (reported)) |
| S-A4 | Add to queue, Add to playlist, Song radio, Share, Report |
| S-A5 | Like and dislike, play counts |
| S-A6 | Song page: cover, title, creator, Follow, styles, lyrics with copy, emoji reactions, timestamped comments with replies and likes, Similar and By-creator rails |

### 3.3 Library and discovery

| ID | Feature |
| --- | --- |
| S-L1 | Workspaces (many per user, archive), list/waveform/grid views, search, sort, filters (liked, public, uploads, covers, extensions, voices, remasters, downloads, hide-disliked) |
| S-L2 | Library tabs: Songs, Playlists, Albums, Workspaces, Studio Projects, Cover Art, Hooks, Liked Hooks, History |
| S-L3 | Cover Art generator (image and video) |
| S-L4 | Hooks (short clips) |
| S-D1 | Home shelves: For You, Staff Picks, Best of model, New Albums |
| S-D2 | Explore: search, ~30 "Best of <genre>" playlists, For You, Staff Picks, New Songs |
| S-D3 | Public profile with followers, following, completion checklist |
| S-D4 | Persistent player with queue |

### 3.4 Studio (browser DAW)

| ID | Feature |
| --- | --- |
| S-S1 | Multitrack timeline: audio, MIDI, video, upload tracks; main bus; tempo, time signature, key detection |
| S-S2 | Transport: record, loop, metronome, follow playhead |
| S-S3 | Magic Bar: prompt-driven generation inside the project |
| S-S4 | Effects: EQ, compressor, reverb; automation lanes; take lanes; clip editor; playable keyboard with arpeggiator |
| S-S5 | Export: full song, time range, multitrack |
| S-S6 | In-app learning: shortcuts, tutorials, hover help |

### 3.5 Account surfaces

| ID | Feature |
| --- | --- |
| S-U1 | Onboarding: birthday, profile, persona, first song, plan |
| S-U2 | Earn credits: listen-and-rank, invite friends, commissioned collabs |
| S-U3 | Labs: genre wheel, listen-and-rank, a small sequencer |
| S-U4 | Notifications with activity tab |

## 4. Veyrnox status against the inventory

Legend: **Built** = shipping in code and flag on. **Dark** = built, production flag off. **Gap** = not found. **Verify** = could not tell from code.

| Suno ID | Veyrnox status | Evidence |
| --- | --- | --- |
| S-C1, S-C2 | Built (custom draft with lyrics, styles, title, model; autosaved, conflict-merged) | `MusicCreateStudio.jsx`, `useMusicCustomDraft.js` |
| S-C3 | Built (lyricist profiles, writing helpers) | `MusicLyricistProfiles.jsx`, `musicLyricist.js` |
| S-C4 | Verify. Catalog model is `ace-step`; no tiered picker seen | `useMusicCustomDraft.js` |
| S-C5 | **Gap** for vocal gender, duration control, Max Mode, Weirdness, Style Influence, Variety. Depends on what the provider exposes | no matches in create components |
| S-C6 | Built (owned-audio upload with rights attestation) | `MusicSourceUploadPanel.jsx`, ADR-0335 |
| S-C7 | **Policy-blocked** (section 6) | |
| S-C8 | Verify (sample seeds exist; reference links were removed, ADR-0335) | `MusicSampleSeedCard.jsx` |
| S-C9 | Built (title, workspaces) | `/music/workspaces` |
| S-C10 | Built outside Music: text-to-speech and dialogue studios, linked from the Audio hub (PR #2121) | `app/audio/page.js` |
| S-A1 Cover | **Dark** (`cover:false`) | `MusicCoverDialog.jsx` |
| S-A1 Reuse prompt | Built (`reuse:true`) | `MusicReuseDialog.jsx` |
| S-A1 Mashup, Sample | Verify | |
| S-A2 Extend | **Dark** (`extend:false`) | `MusicExtendDialog.jsx` |
| S-A2 Reverse, speed | Verify (a speed control exists in server song detail) | `MusicServerSongDetail.jsx` |
| S-A3 Stems | **Dark** (`stems`, `targetStems`, `trackAdd`, `replace`, `addSection` all false) | `MusicStemDialog.jsx`, `MusicReplaceSectionDialog.jsx`, `MusicAddSectionDialog.jsx` |
| S-A4 | Playlists built; queue, radio, report: Verify | `MusicPlaylists.jsx` |
| S-A5, S-A6 | Public track, profile and shared song pages built; comments, reactions and follow: Verify | `MusicPublicTrack.jsx`, `MusicPublicProfile.jsx` |
| S-L1, S-L2 | Library, workspaces, playlists built; Albums, Hooks, History, Cover Art as library tabs: **Gap** | `MusicLibrary.jsx`, `MusicServerLibrary.jsx` |
| S-L3 | **Gap** inside Music (image studios exist elsewhere in the product) | |
| S-D1, S-D2 | Discover page built; curated genre playlists: Verify | `MusicDiscover.jsx` |
| S-S1 to S-S5 | Built (studio with clip editor, effects, MIDI, recorder, latency calibration, instrument takes); automation, take lanes: Verify | `MusicStudioWorkspace.jsx` and siblings |
| S-S3 Magic Bar | **Gap** | |
| S-U2 | Partly built elsewhere (referrals, daily check-in per CLAUDE.md); listen-and-rank: **Gap** | |

The pattern is clear: Veyrnox has already built most of the structure. The biggest single lever is **turning on the dark flags**, which needs verification and owner sign-off, not new code.

## 5. Recommended work, in order

Every item ships behind a `MUSIC_RUNTIME_FLAGS` key (or a new one) that starts `false`, per the repo's delivery rule. Every credit-spending path uses the existing quote, debit and refund RPCs; no new raw ledger writes.

### P0. Activate and prove the dark editing set

Cover, Extend, Replace section, Add section, Stems, Target stems, Track add.

- Requirements: for each, a staging run end to end with a real provider call, a billed-cost check against the catalog price, a refund-on-failure test, and an idempotency test.
- Acceptance: the flag flips on staging with no console errors; credits reconcile (`reconcile_balances()` returns zero rows); an owner-approved prod flip.
- Dependency: the 129/128 binding limit noted in ADR-0095 means production flags that are JSON members of `MUSIC_RUNTIME_FLAGS` cost nothing extra, but any new top-level var does.

### P1. Create controls that change the result

Suno's More Options block (S-C5). Build only what the provider supports; hide the rest.

- First step: read the provider's input schema for the chosen model and list the supported parameters. Likely candidates: duration, instrumental toggle, seed, vocal gender via style text.
- Requirements: controls map 1:1 to provider inputs; unsupported controls are absent, not disabled; defaults reproduce today's output; quote shows the price before Create; the control values are saved with the draft and with the song so Reuse prompt restores them.
- Acceptance: a Reuse of any new song reproduces its settings; a settings change that alters price re-quotes.

### P1. Song page parity

Comments with timestamps and replies, emoji reactions, Follow, Similar and By-creator rails, Song radio, Add to queue.

- Requirements: comments are text-only, length-capped, reportable, and visible only on public songs; a held or reported comment is hidden from others; no raw HTML.
- Acceptance: block and report paths tested; account erasure removes the person's comments (new tables classified in `scripts/test-account-deletion.mjs`).

### P2. Library tabs

Albums, Hooks (short shareable clips), History, Cover Art.

- Cover Art reuses the existing image studios; the song stores one chosen cover.
- History is a read-only projection over jobs filtered by `deleted_at IS NULL`.
- Acceptance: deleting a creation follows ADR-0116 (file and prompt removed, row and ledger kept).

### P2. Mashup and Sample this song

- Requirement: only songs the person owns or that carry an explicit remix permission can feed a mashup or sample; otherwise the action is absent. Reuse the rights-attestation flow from owned-audio upload.

### P3. Magic Bar in the studio

A prompt box that adds a generated loop or stem to the current project.

- Requirement: output lands as an owned asset on a new track; nothing plays or spends credits until Send is pressed, with the price shown first.

### P3. Discovery extras

Curated "Best of <genre>" playlists, For You ranking, notifications with an activity tab, listen-and-rank for credits.

- Listen-and-rank must grant only through `ledger_grant` and needs its own ADR and abuse limits before any credit is paid.

## 6. Constraints that apply to every item

- **Rights:** audio provided by a person needs the recording and composition attestation already used for owned uploads. A pasted link is never model input (ADR-0335).
- **Voice features (S-C7):** recording or uploading a voice to sing as is not built. A prior check found voice cloning conflicts with the acceptable use policy; do not start without a written owner decision.
- **Credits:** price comes from `model_catalog`; no price in app code. Every debit has a matching refund path.
- **Content:** generated audio and prompts go through the existing scanning and hold rules; held content blocks sharing and publication.
- **Privacy:** new tables are RLS-forced, service-role-only or user-JWT by explicit allowlist, and are erased with the account.
- **CSP:** no new hosts without an ADR.
- **i18n:** all new strings in the 11 locales.
- **UI:** each UI change ends with the "The goal is met when…" lines from `docs/design-goal-criteria.md`.

## 7. Things not to copy

- Hover overlays that put Remix next to the three-dot menu; in testing the two icons were easy to confuse. Separate them.
- A security check that loops. Suno's generation check kept re-asking in an embedded browser; if Veyrnox gates generation with Turnstile, make the failure state say what to do.
- Pro-gated controls that open the same upsell wall with no explanation. Say which feature and which plan.
- A first-run flow that spends a free generation before the person has seen the product.

## 8. Open questions for the owner

1. Is the goal full parity or the shortest path to "extend, cover, stems"? This spec assumes the second, ordered by section 5.
2. Which provider models should back music beyond `ace-step`? Parameters in P1 depend on this.
3. Are public comments and follows wanted at all, given moderation cost?
4. Is listen-and-rank for credits acceptable given the abuse risk?
5. Does the "Reverse" and "Adjust speed" pair belong in Music or only in the editor?

## 9. Verification before any of this is trusted

- Run each "Verify" row against staging and update this table.
- Replace the unobserved Suno items (section 2) with captures from a session where generation works.
