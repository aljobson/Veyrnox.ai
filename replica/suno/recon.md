# Recon map: Suno (web)

Scope: first-time web journey plus the publicly documented creation, editing, library, sharing, collaboration, and Studio capability surface as of 2026-11-10.
For: clean-room Veyrnox.ai product discovery. This is a behavioral map, not a plan to copy Suno assets, source, APIs, models, or community data.
Date: 2026-11-10

## Evidence boundary

Suno's current Terms of Service prohibit reverse engineering, scraping, and using the service to develop a competing product. The logged-in account was therefore not used for reconstruction. The evidence set is limited to public Suno pages, the public Help Center, pricing, release material, and the unauthenticated first-touch UI. A browser unexpectedly revealed authenticated state once; inspection stopped immediately and none of that account material is included here.

Legend used below:

- **Observed**: visible on a public page or stated directly in current official documentation.
- **Inferred**: a product structure strongly implied by multiple public sources.
- **Unknown**: needs lawful product documentation or independent product design; it was not filled in from account inspection.

## Sources

| # | source | URL | evidence used |
| --- | --- | --- | --- |
| 1 | Public landing page | https://suno.com/ | Guest composer, navigation, feature cards, first-touch sign-in modal, visual language |
| 2 | Terms of Service | https://suno.com/terms | Recon boundary; prohibited reverse engineering, scraping, and competitive use |
| 3 | Pricing | https://suno.com/pricing | Plans, credits, downloads, queues, upload limits, plan-gated features |
| 4 | Help Center: Making Music | https://help.suno.com/en/categories/550017 | Capability taxonomy |
| 5 | Sign up / log in | https://help.suno.com/en/articles/2408065 | Web sign-up entry and SSO pattern |
| 6 | Simple Mode | https://help.suno.com/en/articles/2462273 | Prompt-only first-song path and random prompt |
| 7 | Custom/Advanced Mode | https://help.suno.com/en/articles/3726721 | Lyrics, instrumental, styles, advanced options, title, create |
| 8 | v6 FAQ | https://help.suno.com/en/articles/13924481 | Multimodal prompting, models, two outputs, cost, variety, Max Mode |
| 9 | Current models | https://help.suno.com/en/articles/13924801 | v6, v6-wild, v6-mini, eight-minute generations |
| 10 | Library | https://help.suno.com/en/articles/3726849 | Songs, Liked, Playlists, Hooks, ordering and filters |
| 11 | Remix category | https://help.suno.com/en/categories/1365953 | Cover, Extend, Reuse, Speed, attribution and permissions |
| 12 | Edit category | https://help.suno.com/en/categories/2828097-edit | Crop, fade, replace/add section, remaster, stems |
| 13 | Song Editor | https://help.suno.com/en/articles/6141505 | Section timeline, alternates, lyric edits, extend, crop and fades |
| 14 | Workspaces | https://help.suno.com/en/articles/14616961 | Shared workspace roles, invitations, ten-collaborator limit |
| 15 | Voices | https://help.suno.com/en/articles/11362433 | Own-voice creation, verification, sharing and compatibility |
| 16 | Custom Models | https://help.suno.com/en/articles/11362497 | Six-song minimum, bulk upload, three-model limit, ownership requirement |
| 17 | Sounds | https://help.suno.com/en/articles/10625537 | One-shot/loop generation, BPM and key |
| 18 | Stems | https://help.suno.com/en/articles/13925185 | Auto, split-from-mix, advanced split and credit costs |
| 19 | Studio 2.0 | https://help.suno.com/en/articles/13670529 | DAW surface, chat, MIDI, effects, plugins, requirements |
| 20 | Studio library | https://help.suno.com/en/articles/13670849 | Dock, auditioning, Song Details, stems, drag/drop and mini-player |
| 21 | Studio recording | https://help.suno.com/en/articles/13671041 | Audio/MIDI recording, count-in, pre-roll and latency calibration |
| 22 | Studio export | https://help.suno.com/en/articles/13925249 | Full song, range, multitrack, WAV and MIDI export |
| 23 | Organize & Share | https://help.suno.com/en/categories/2828673-organize-share | Publish, link-only defaults, deletion and sharing |
| 24 | Albums | https://help.suno.com/en/articles/14227329 | Album assembly, ordering and publish behavior |
| 25 | Suno MCP beta | https://help.suno.com/en/articles/14551361 | Assistant-connected music creation and upload support |
| 26 | Release Notes | https://suno.com/release-notes | Speech, lyrics, cover art, Sample/Mashup, playlists and latest Studio changes |
| 27 | Speech beta | https://suno.com/release-notes/introducing-speech-beta | Spoken audio and soundtrack generation on web |
| 28 | Sample product page | https://suno.com/products/samples | Waveform selection, Chop/As-is/Blend and pitch/speed preservation |
| 29 | Cover Art improvements | https://suno.com/release-notes/cover-art-improvements | Prompt/image iteration into cover image or video |

## Core loop

Describe a song or provide owned source material, generate two alternatives, listen and rate, refine the preferred result through remix/edit tools, then organize, share, publish, or export it.

Happy-path first song: public landing prompt -> account sign-in -> Create/Simple -> describe song -> Create -> receive two candidates -> listen -> like/dislike or open actions. Public documentation establishes the flow, but the post-auth screens and exact first-run coach marks remain **unknown** because the account was not inspected.

## Screens

| ID | screen | route / how to reach | purpose | key components | states seen or documented |
| --- | --- | --- | --- | --- | --- |
| S01 | Public landing | `/` | Explain product and let a guest start with a prompt | top nav; hero prompt; Add audio; Advanced; random prompt; Create; song carousel; feature cards; pricing | observed: guest; cookie banner; sign-in interception |
| S02 | Sign-up modal | Join, Log in, or guest Create | Create or enter an account | Google, Apple, Phone, Discord, Facebook, Microsoft; close | observed: modal; expanded provider list |
| S03 | Post-auth first-run tour | after first sign-in | Introduce models and creation toolkit | coach marks; next/close; upgrade CTA | unknown beyond public copy; authenticated visuals excluded |
| S04 | Home / Discover | primary navigation | Browse recommended and popular music | feeds; song cards; play/like counts; creator links; search | inferred from landing, Library and publishing docs; empty/error unknown |
| S05 | Create: Simple | `/create`, Simple | Turn one natural-language direction into songs | prompt composer; attachments; model picker; random prompt; Create; credit cost | documented: empty, prompt-filled, generating, two results |
| S06 | Create: Advanced / Custom | `/create?mode=CUSTOM` or Advanced tab | Give granular song direction | lyrics/co-write; instrumental; style; Voices/Personas; Inspo; title; model; Exclude; vocal gender; sliders; Max Mode | documented: vocal/instrumental; paid gates; validation/moderation errors |
| S07 | Create: Sounds | Create -> Sounds | Generate samples and sound effects | prompt; One Shot/Loop; BPM; key; Create | documented: two samples; beta accuracy caveat |
| S08 | Workspace results | Create page lower/right pane | Review generations in the active workspace | two result cards; waveform/player; feedback; share; more actions; filters | documented: queued, generating, ready, failed/moderated; exact layout unknown |
| S09 | Library | Library | Find owned songs and assets | newest-first list; search; filters; Liked; Playlists; Hooks; uploads; stems | documented: populated; empty/loading/error unknown |
| S10 | Song detail / player | song card/title | Listen and inspect metadata/lineage | artwork; waveform/player; lyrics; prompt/styles; creator; original/remix links; share | inferred from publish/remix docs; variants unknown |
| S11 | Song action menu | `...` on a song | Route to reuse, edit, download, publish and organize actions | Remix/Edit; Create; stems; download; workspace; playlist; publish; visibility; delete | documented across official articles |
| S12 | Song Editor | song -> Edit | Non-destructively arrange and regenerate sections | waveform timeline; sections; lyrics panel; fades; split/crop; replace; add; extend; alternates | documented: two previews; commit/regenerate; original preserved |
| S13 | Remix / Edit form | More Actions -> Remix/Edit | Cover, Extend, Adjust Speed, Reuse styles/lyrics | source preview; operation picker; prompt/lyrics/style; strength controls; Create | documented: own and permitted third-party songs; permission denied edge |
| S14 | Stem extraction | song -> Get Stems | Separate a mix into parts | Auto Split; Split from Mix; Advanced Split; instrument search; credit quote | documented: up to 12 stems, nearly 100 instrument choices, paid gates |
| S15 | Voices / Personas | Library or Create picker | Reuse a voice or stylistic identity | create from song/upload; verification phrase; privacy; avatar; description; compatibility | documented: own voice only; age/location restrictions; public/private |
| S16 | Custom Models | model picker -> Create Custom Model | Fine-tune a reusable model on owned tracks | bulk upload; track count; rights notice; training progress; My Models/Shared | documented: minimum six tracks; up to three models; 2-5 minute build |
| S17 | Workspaces | Create/Library -> Workspaces | Organize songs while creating | workspace selector; create; filters; batch move; song list | documented: private and shared; empty/populated |
| S18 | Workspace sharing | Workspace -> Share | Invite collaborators and manage access | handle search; pending invites; member list; remove/leave | documented: owner/collaborator roles; up to ten collaborators |
| S19 | Playlists / Inspo | Library -> Playlists | Group songs and use them as generation inspiration | playlist editor; ordering; add/remove; Inspire CTA | documented: short playlists recommended; owned songs as generation reference |
| S20 | Albums | profile/library -> Albums | Package songs as a release | album metadata/art; add songs/playlists; drag ordering; publish | documented: unpublished songs become public when album publishes |
| S21 | Public profile / publish | avatar -> View Profile; song -> Publish | Present public songs and identity | avatar; bio; songs; albums; follow/engagement; publish options | documented: Link-Only default; public/profile visibility; comment/remix toggles |
| S22 | Hooks feed / composer | Library Hooks or Hooks feed | Pair a song excerpt with a short video | song picker; scrub start; video upload; Show Lyrics; Post | documented: comments, thumbs-up, share and remix |
| S23 | Notifications | navigation | Show invitations and community activity | list; unread state; workspace invite Accept/Decline | documented for workspace invites; full taxonomy unknown |
| S24 | My Taste / preferences | avatar menu | Personalize style augmentation | learned taste; enable/disable; edit; Magic Wand style expansion | documented: enabled by default; all users |
| S25 | Account / plans | `/account`, pricing CTA | Manage subscription, credits and download allowance | plan; billing; credit balance; download balance; add-ons; cancel | documented: Free/Pro/Premier; renewal/reset states |
| S26 | Downloads | song action -> Download | Export owned results | MP3/WAV/video/stems choices; quota status; plan gate | documented: per-song counting; retry does not double-count; Free trial allowance |
| S27 | Trash / deletion | Library -> delete/trash | Recover or permanently delete songs | move to trash; restore; permanent delete confirmation | documented existence; retention window unknown |
| S28 | Studio project hub | Studio | Create/open production projects | project list; new project; open existing song; library entry | documented: Premier-only; desktop/tablet width requirement |
| S29 | Studio timeline | Studio project | Arrange, record, generate, mix and edit | transport; tempo/time signature; audio/MIDI tracks; chat bar; take lanes; details dock | documented: loading/project; hardware/browser permission edges |
| S30 | Studio Library dock | Studio -> Library dock | Audition and insert assets | All/Liked/Stems/Uploads/Workspaces/Projects; search/filter; mini-player; Song Details | documented: remembered view state; drag to timeline/chat |
| S31 | Studio MIDI / instrument editor | add MIDI track | Compose and perform notes | piano roll; velocity; pitch bend; modulation; Wavetable synth; keyboard/controller | documented: Web MIDI unavailable on Safari |
| S32 | Studio effects / plugin editor | track effects rack / chat | Shape sound or generate custom effects | factory effects; presets; automation; MIDI Learn; conversational plugin builder | documented: no VST/AU hosting |
| S33 | Studio export | Export menu | Take a project into another workflow | full song; selected range; multitrack; clip WAV; stem-to-MIDI | documented: WAV/MP3/multitrack; export errors unknown |
| S34 | MCP setup / use | `/mcp` and supported assistant | Create and manipulate music via an AI assistant | connection instructions; tool inventory; upload; create | publicly documented beta; exact consent/error states unknown |
| S35 | Create: Speech beta | Create -> Speech | Generate spoken audio and its soundtrack together | prompt; exact script; tone/pacing/mood/setting; backing music; Variety; vocal gender; Create | documented on web/mobile; beta accent/pause errors |
| S36 | Sample / Mashup | song action or drop audio into Create | Build from a selected slice or combine two songs | waveform range; Chop/As-is/Blend; keep pitch/speed; two-song picker; prompt | documented: owned upload/recording/song; rights and source-length edges |
| S37 | Lyrics workspace | Advanced lyrics -> expand | Draft and revise lyrics without losing work | full-screen editor; Lyricist; natural-language edit; rhyme/line references; section labels; autosave | documented on web; conflict/offline behavior unknown |
| S38 | Cover art editor | song/playlist/profile/banner art action | Create or revise visual identity | image upload; text prompt; iteration history; image/video output; apply target | documented on web; generation limits and moderation unknown |

## Flows

```text
F01 Create an account and reach Create
    S01 -> S02 -> identity provider -> S03 -> S05
    happy path clicks: 3-5 (provider-dependent)
    edge: provider cancel, age restriction, duplicate/blocked account, region restriction

F02 Make a first song in Simple mode
    S05 enter prompt -> choose/keep model -> Create -> S08 compare two candidates -> listen/rate
    happy path clicks: 2 after typing
    edge: moderation block, insufficient credits, shared queue, failed generation

F03 Make a song in Advanced/Custom mode
    S06 lyrics or instrumental -> style -> optional Voice/Inspo/options -> title -> Create -> S08
    happy path clicks: 3-8 after typing
    edge: incompatible model, artist-name moderation, missing lyrics, plan gate

F04 Generate a sound/sample
    S07 prompt -> One Shot/Loop -> optional BPM/key -> Create -> S08
    happy path clicks: 2-4
    edge: inaccurate loop, unwanted full arrangement, credit failure

F05 Create from owned audio/image/video references
    S05/S06 attach sources -> describe transformation -> Create -> S08
    happy path clicks: 4+
    edge: rights declaration, format/length limit, multimodal cost increase

F06 Iterate from a generated song
    S08/S10 -> S11 -> Cover/Extend/Speed/Reuse -> S13 -> Create -> S08
    happy path clicks: 4-6
    edge: remix disabled, source not owned, retired-model source reruns on current model

F07 Replace or add a section
    S10 -> S12 select range -> prompt/edit lyrics -> generate two alternates -> preview -> commit
    happy path clicks: 6+
    edge: bad transition, regenerate, restore original take

F08 Crop, split, reorder, or fade
    S10 -> S12 select clip/section -> action -> adjust handle/order -> save/commit
    happy path clicks: 4+
    edge: destructive-looking action remains versioned/non-destructive

F09 Extract stems
    S09/S10 -> S11 -> S14 choose split -> confirm credit use -> wait -> S09 stems
    happy path clicks: 4-6
    edge: absent instrument still consumes credits; plan gate

F10 Create a Voice or Persona
    S10 -> S11 -> S15 upload/select source -> metadata/privacy -> voice verification -> save
    happy path clicks: 6+
    edge: own-voice verification fails, under 18, unsupported region, noisy recording

F11 Train a Custom Model
    S06 model picker -> S16 upload >=6 owned tracks -> Create Model -> wait -> select model
    happy path clicks: 5+
    edge: rights failure, too few tracks, three-model limit, training failure

F12 Organize songs into a workspace
    S09 multi-select -> S11 Move to Workspace -> S17 choose/create workspace
    happy path clicks: 3-5
    edge: mixed ownership, empty workspace, delete permission

F13 Invite a collaborator
    S17 -> S18 search exact handle -> select user -> Share -> invite notification
    happy path clicks: 4
    edge: free owner cannot share, handle not found, ten-member limit, invite declined

F14 Accept a workspace invitation
    S23 -> invitation -> Accept -> S17
    happy path clicks: 2
    edge: revoked/expired invite; leave workspace while created songs remain

F15 Use a playlist as inspiration
    S09 -> S19 create/add owned songs -> Inspire -> S06 -> Create -> S08
    happy path clicks: 5+
    edge: no eligible songs, over-broad playlist, referenced song removed

F16 Publish or share a song
    S09/S10 -> S11 -> visibility/permissions -> Publish or copy link -> S21
    happy path clicks: 3-5
    edge: moderation, comments/remixes disabled, Link-Only retained

F17 Assemble and publish an album
    S20 add songs/playlists -> order -> metadata/art -> Publish -> S21
    happy path clicks: 6+
    edge: publishing album makes included songs public

F18 Create and post a Hook
    S22 choose song -> scrub start -> upload owned video -> optional lyrics -> Post
    happy path clicks: 5+
    edge: upload failure, permission/moderation, missing public rights

F19 Download a song or stems
    S09/S10 -> S11 -> S26 choose format -> download
    happy path clicks: 3
    edge: quota exhausted, Free trial limit, failed transfer, repeat download

F20 Personalize My Taste
    S24 review learned taste -> edit/disable -> S06 use Magic Wand
    happy path clicks: 3-5
    edge: user wants deterministic tags; Variety slider set to zero

F21 Open a song in Studio
    S09/S10 -> S11 Edit -> Open in Studio -> S28 create/open project -> S29
    happy path clicks: 4
    edge: Premier gate, unsupported mobile width, insufficient browser capability

F22 Record audio or MIDI in Studio
    S29 add/arm track -> choose input -> optional count-in/pre-roll -> Record -> Stop -> take lane
    happy path clicks: 5+
    edge: microphone/MIDI permission, latency calibration, Safari MIDI limitation

F23 Generate and commit a Studio take
    S29 chat/prompt -> generate two takes -> audition/rate -> commit preferred take
    happy path clicks: 4+
    edge: timing mismatch, keep original in take lane, regenerate

F24 Mix and automate in Studio
    S29/S32 add effect -> adjust -> automate parameter -> draw points -> play back
    happy path clicks: 6+
    edge: custom plugin generation error, unsupported VST/AU expectation

F25 Export a Studio project
    S29 -> S33 choose full/range/multitrack -> format -> export
    happy path clicks: 3-5
    edge: selected range empty, rendering failure, browser download restriction

F26 Create Speech with a soundtrack
    S35 prompt or exact script -> describe tone -> toggle backing music/options -> Create -> S08
    happy path clicks: 2-6
    edge: accent drift, overlong pauses, beta quality, moderation

F27 Build from a sample or two-song mashup
    S09/S10 -> S11 Use as Sample/Mashup -> S36 select slice or second song -> mode/options -> Create -> S08
    happy path clicks: 5+
    edge: source rights, selection too short/long, incompatible sources, pitch/speed mismatch

F28 Draft and revise lyrics
    S06 -> S37 write/import -> optional Lyricist -> select word/line -> ask or choose reference -> autosave -> return to S06
    happy path clicks: 2+
    edge: autosave conflict, unsupported structure label, moderation

F29 Generate or revise cover art
    S10/S19/S20/S21 -> S38 upload or prompt -> iterate -> choose image/video -> apply
    happy path clicks: 4+
    edge: unsafe image, generation failure, wrong aspect ratio, reverting previous art
```

## Components

| component | variants | states | used on |
| --- | --- | --- | --- |
| App shell | public top nav; authenticated left rail; Studio shell | guest, signed-in, collapsed, plan-gated | S01, S04-S34 |
| Prompt composer | hero; Simple; Advanced; Sounds; Studio chat | empty, focused, attachments, disabled, submitting, moderated | S01, S05-S07, S29 |
| Attachment chip | audio, Suno song, playlist, image, video, MIDI | uploading, ready, failed, rights warning | S05-S07, S29 |
| Model picker | v6-mini, v6, v6-wild, custom/shared | selected, incompatible, locked, retired | S05, S06, S16 |
| Credit quote / balance | per generation, stem action, MIDI conversion | enough, low, insufficient, top-up | S05-S08, S14, S25, S31 |
| Segmented tabs | Simple/Advanced/Sounds; Songs/Speech; library filters | selected, hover, disabled | S05-S09 |
| Song card | list, grid, compact, Studio dock | queued, generating, ready, failed, playing, selected | S04, S08-S10, S30 |
| Waveform player | song, mini-player, editor, Studio clip | idle, playing, buffering, seeking, selected range | S08-S13, S29-S30 |
| More Actions menu | owner, collaborator, public/remixable | open, disabled items, plan-gated | S08-S11, S17, S21 |
| Visibility control | Link-Only, Published | comments/remix on/off, moderation blocked | S11, S21 |
| Feedback control | like/dislike; problem reason | idle, selected, submitted | S08, S10, S29 |
| Lyrics editor | plain lyrics, generated/co-write, section replace | empty, populated, selection-linked, error | S06, S12-S13 |
| Style editor | tags/prompt, Magic Wand, My Taste | deterministic, augmented, excluded terms | S06, S24 |
| Creative sliders | Variety/weirdness, style influence, audio strength | min/max, default, incompatible | S06, S13 |
| Source picker | Voice, Persona, Inspo, owned upload | empty, selected, locked, shared | S06, S15, S19 |
| Queue/progress row | song generation, model training, stems, export | queued, running, complete, failed, canceled | S08, S14, S16, S33 |
| Workspace picker | personal, shared, create new | empty, selected, no access | S08, S17-S18 |
| Invite/member list | pending, owner, collaborator | accepted, declined, removed | S18, S23 |
| Timeline / clip | song sections, audio clip, MIDI clip | selected, muted, solo, armed, locked, take preview | S12, S29-S31 |
| Take lanes | two generated alternates | auditioning, rated, committed, dismissed | S12, S29 |
| Transport | play, stop, record, loop, metronome, follow | idle, playing, recording, count-in | S29 |
| Effects rack | factory effect, synth, generated plugin | enabled, bypassed, preset, automated | S31-S32 |
| Automation lane | volume, pan, plugin parameter | empty, points, curve, copied, deleted | S29, S32 |
| Paywall / upgrade dialog | Pro, Premier, feature-specific | closed, open, checkout handoff | S06, S14-S16, S25, S28 |
| Toast / notification | success, failure, moderation, invite | transient, actionable | all app screens |
| Confirm dialog | publish, credit spend, remove access, delete | open, confirming, error | S14, S18, S21, S27 |
| Speech controls | prompt, script, tone, backing music | empty, saved, generating, beta error | S35 |
| Sample range picker | Chop, As-is, Blend | range selected, keep pitch/speed, invalid range | S36 |
| Lyrics workspace | full-screen draft, Lyricist, references | autosaved, editing, selection, conflict | S37 |
| Visual generation editor | image prompt, uploaded reference, image/video output | generating, alternatives, applied, rejected | S38 |

## Visual craft notes (public evidence only)

- Near-black canvas with warm orange, raspberry and amber gradients used as creative-energy accents rather than as constant chrome.
- Large rounded composer and card surfaces; high-radius pills for compact actions; primary actions use light or saturated fills against dark panels.
- Public landing is editorial and cinematic, while the creation product is denser and tool-like. Preserve that contrast rather than making every surface equally decorative.
- The first-touch hierarchy is unusually direct: prompt first, optional audio/advanced controls second, account creation only when the user tries to create.
- Capability cards combine short benefit copy with deep links; pricing explains value through concrete limits, not vague tiers.
- Repeated two-option generation creates a consistent compare-and-commit rhythm across songs, section edits and Studio take lanes.
- Accessibility and responsive details are only partly observable. Keyboard shortcuts are well documented for Studio, but public evidence does not establish full focus order, screen-reader announcements or mobile web parity.

## Inferred data model

```text
User               id, handle, display_name, avatar_url, bio, age_band, region,
                   taste_enabled, created_at
                   evidence: S02, S15, S21, S24
                   confidence: high

Subscription       user_id, tier (free|pro|premier), renewal_at, commercial_rights,
                   queue_priority, concurrent_limit
                   evidence: S25 and pricing
                   confidence: high

CreditLedger       user_id, balance, grant_type, amount, spent_at, operation_id
                   evidence: generation/stem/MIDI costs
                   confidence: high

DownloadAllowance  user_id, plan_period, allowed, used, reset_at, trial_lifetime_used
                   evidence: pricing/download documentation
                   confidence: high

Song               id, owner_id, title, audio_url, artwork_url, duration, lyrics,
                   styles, model_id, visibility, allow_comments, allow_remixes,
                   parent_song_id, operation_type, status, created_at
                   evidence: S08-S13, S21, download/remix docs
                   confidence: high

GenerationJob      id, user_id, prompt_spec_id, operation_type, credit_cost,
                   queue_class, status, output_song_ids[2], failure_reason
                   evidence: two outputs per generation and queue rules
                   confidence: high

PromptSpec         id, mode, text_prompt, lyrics, instrumental, style_prompt,
                   excludes, vocal_gender, variety, style_influence, audio_strength,
                   max_mode, model_id, source_asset_ids[]
                   evidence: S05-S07 and v6 docs
                   confidence: high

SourceAsset        id, owner_id, kind (audio|image|video|midi|song|playlist), url,
                   duration, rights_attested, metadata
                   evidence: multimodal input and upload docs
                   confidence: high

Workspace          id, owner_id, name, visibility, created_at
WorkspaceMember    workspace_id, user_id, role, invite_status
                   evidence: S17-S18
                   confidence: high

Playlist           id, owner_id, title, ordered_song_ids[], visibility
Album              id, owner_id, title, artwork, description, ordered_song_ids[], published_at
                   evidence: S19-S20
                   confidence: high

VoiceProfile       id, owner_id, source_song_id, name, avatar, description,
                   privacy, verification_status, compatible_model_ids[]
Persona            id, owner_id, source_song_id, style_snapshot, privacy
                   evidence: S15
                   confidence: high

CustomModel        id, owner_id, name, training_song_ids[], status, shared_with[], version
                   evidence: S16
                   confidence: high

SongEditVersion    id, song_id, parent_version_id, operation, range_start,
                   range_end, prompt, lyrics, candidate_song_ids[], committed_candidate_id
                   evidence: S12-S13
                   confidence: high

StemExtraction     id, song_id, mode, requested_instruments[], credit_cost,
                   output_asset_ids[], status
                   evidence: S14
                   confidence: high

StudioProject      id, owner_id, workspace_id, name, tempo, time_signature,
                   sample_rate, created_at, updated_at
Track              id, project_id, kind (audio|midi), order, name, color,
                   volume, pan, mute, solo, armed, input_device
Clip               id, track_id, kind, asset_id, start, duration, offset,
                   transpose, speed, fades, take_lane_id
TakeLane           id, track_id, generation_job_id, candidate_clip_ids[], committed_clip_id
AutomationLane     id, track_id, target_parameter, points[]
EffectPlugin       id, track_id, type, preset, parameters, generated_definition
                   evidence: S28-S33
                   confidence: high

SoundAsset         id, owner_id, prompt, type (one_shot|loop), bpm, key,
                   output_asset_ids[2]
                   evidence: S07
                   confidence: high

SpeechAsset        id, owner_id, prompt, script, tone, backing_music,
                   variety, vocal_gender, output_song_ids[]
                   evidence: S35
                   confidence: high

LyricDraft         id, owner_id, song_id, text, structure_labels[],
                   lyricist_id, revision, autosaved_at
                   evidence: S37
                   confidence: medium

VisualAsset        id, owner_id, kind (image|video), source_asset_id,
                   prompt, target_type, target_id, revision
                   evidence: S38
                   confidence: medium

Hook               id, owner_id, song_id, video_asset_id, start_offset,
                   show_lyrics, visibility, published_at
Comment/Reaction   id, user_id, target_type, target_id, kind/body, created_at
Notification       id, user_id, kind, actor_id, target_id, read_at
                   evidence: S21-S23
                   confidence: medium; public docs do not expose full schemas
```

Relationships: User 1-n Songs, Workspaces, Playlists, Albums, Voices, Personas, CustomModels and StudioProjects. Workspace n-n Users through WorkspaceMember. Song 1-n Generation/Edit/Stem records and self-references its remix lineage. StudioProject 1-n Tracks 1-n Clips, TakeLanes, AutomationLanes and EffectPlugins.

## Feature matrix

See `features.csv`. Must: 43, should: 54, could: 78, skip: 7. Every buildable capability starts at `clone=no`; exact proprietary assets and networks are `skip`.

## Craft Anything audit

Craft Anything was used only against this local clean-room Markdown file, never against Suno's authenticated site, scripts or requests. Its static evidence path confirmed the file opens with readable English, identifies itself as `Recon map: Suno (web)`, and reads like a research note. Craft inspected the first 1,024 bytes rather than the entire document, so this is a file-integrity/readability check, not evidence that the capability map is complete.

## Out of scope (cannot or should not be cloned)

- Suno's model weights, training corpus, inference stack, prompt transformations and exact output behavior.
- WMG/BMG or other artist/label partnerships and any licensed catalog rights.
- Existing Suno songs, creators, engagement graph, comments, playlists, recommendations and marketplace/network effects.
- Suno branding, logo, marketing copy, artwork, audio, videos and screenshots.
- Private APIs, internal request shapes, JavaScript bundles, source code, telemetry and account data.
- Exact moderation, fingerprinting, watermarking, provenance, fraud, download-enforcement and voice-verification systems. A clean-room product needs independent safety and rights controls.
- Conventional plugin hosting: Suno explicitly does not support VST/AU in Studio, and there is no reason to mimic that limitation unless it serves Veyrnox users.

## Size

Screens: 38. Flows: 29. Inferred entities: 30. Hard parts: (1) high-quality controllable music/speech generation with consistent voices/styles, (2) non-destructive audio/MIDI editing and low-latency browser production, (3) rights, moderation, provenance and collaboration at scale. Full surface size: **XL**; rescope to the core loop for an **L** first product.

Recommended clean-room MVP: S02, S05-S06, S08-S11, S17, S25-S26 plus F01-F03, F06, F12, F16 and F19. Treat Studio, Voices, Custom Models, community feeds and shared Workspaces as later products, not day-one requirements.
