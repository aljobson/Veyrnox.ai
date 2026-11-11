# Veyrnox Music — clean-room architecture

## 1. Decision

Build **Veyrnox Music** as a guided product inside the existing Veyrnox application. It is a clean-room implementation of the public capability map in [recon.md](./recon.md), not a copy of Suno's code, models, private APIs, data, assets, branding, or trade dress.

The first product is intentionally smaller than the 38-screen recon:

- first release: S02, S05-S06, S08-S11, S17, S25-S26
- first flows: F01-F03, F06, F12, F16, F19
- proof slice: prompt -> exact credit quote -> one atomic request -> two candidates -> listen -> keep one in Library
- later products: collaboration, Voice/Persona, custom models, social/community, and the browser DAW

This scope is large enough to prove the core user promise and small enough to ship without pretending that a full production workstation or a social network is one feature.

## 2. Existing Veyrnox foundation to reuse

| layer | choice | why |
| --- | --- | --- |
| web | Next.js 16 App Router, React 19, TypeScript at new boundaries | It is the current application; a second frontend would split auth, design, and operations. |
| styling | Tailwind 4 plus Veyrnox CSS tokens | Keeps Veyrnox's identity; no copied competitor measurements or assets. |
| database | Existing Supabase Postgres | One transactional source for ownership, idempotency, credits, lineage, and RLS. |
| data access | Existing PostgREST/RPC clients; SQL migrations | Fits the current Worker runtime and preserves the money-spine conventions. |
| auth | Existing Supabase Auth and `public.users` shadow rows | Google and Apple already fit the first-run requirement; no parallel identity store. |
| generation | Existing catalog, provider adapters, `jobs`, `job_steps`, and verified webhooks | Music becomes a catalog capability, not a provider-specific client integration. |
| files | Existing private EU R2 bucket with signed URLs | Source audio, masters, previews, artwork, and exports stay private by default. |
| payments | Existing credit ledger, Stripe packs, and gated credit subscriptions | Quote in credits and reuse automatic refund/reconciliation; no second wallet. |
| jobs | Current Worker scheduled handler plus provider webhooks/polling | Enough for the first release; do not add a queue vendor until load proves it necessary. |
| email | Existing Resend adapter | Optional completion/failure mail for long jobs, never required for progress. |
| hosting | Existing OpenNext Cloudflare Worker | One deployable application and one `/api/v1/*` security boundary. |
| analytics | Existing privacy-redacted PostHog setup | Measure flow outcomes without recording prompts, lyrics, or media. |

No ORM, microservice, second database, new authentication vendor, or direct browser-to-model-provider call is proposed.

## 3. Product surfaces

### 3.1 First release routes

| route | screen | responsibility |
| --- | --- | --- |
| `/` | S01 | Existing public landing gains an original Veyrnox Music composer card; generation still requires sign-in. |
| `/veyrnox/music` | S05/S08 | Simple composer, active generation pair, and recent workspace results. |
| `/veyrnox/music/create` | S05/S06 | Simple and Custom modes; controls are capability-driven by the selected catalog model. |
| `/veyrnox/music/library` | S09 | Owned songs, search, filters, liked state, workspace move, and trash. |
| `/veyrnox/music/song/[id]` | S10/S11 | Player, prompt/rights/provenance summary, lineage, actions, publish, share, and export. |
| `/veyrnox/music/workspaces` | S17 | Personal workspaces and batch organization. Shared workspaces remain off in v1. |
| `/veyrnox/music/account` | S25 | Music entitlement, credit balance, download allowance, and existing billing handoff. |
| `/m/[token]` | S10 | Revocable link-only player with no direct R2 key or owner-private metadata. |
| `/music/[slug]` | S10/S21 | Moderated public song page under Veyrnox's own visual and community rules. |

### 3.2 Editor behavior

The composer has four stable zones:

1. **Direction** — Simple prompt or Custom lyrics, instrumental choice, style, exclusions, title, and only the controls the selected model supports.
2. **Sources** — owned upload, owned song/version, or later a collection; every source carries rights evidence and lineage.
3. **Quote** — model, output length, two-candidate total, current balance, and the exact expiry of the quote.
4. **Results** — two independently durable candidate cards with playback, failure/refund state, like/dislike, and actions.

Unsupported controls never become decorative UI. For example, lyrics are shown only when an active catalog capability has been verified against an official provider schema to accept lyrics. The existing ACE-Step capability can prove the Simple instrumental slice, but it does not by itself justify claiming full Custom behavior.

### 3.3 State ownership

```text
browser draft
  -> server validation + input policy check
  -> expiring server quote
  -> atomic pair debit + two jobs
  -> provider adapters
  -> verified webhook or bounded poll
  -> private R2 copy + output policy check
  -> two song versions in Library
  -> optional link-only share, public publication, or export
```

Postgres owns identity, money, idempotency, permissions, lifecycle, and lineage. R2 owns bytes. `jobs` owns provider execution. The new music tables own music-domain projections and never duplicate ledger truth.

## 4. Schema

The companion [schema.sql](./schema.sql) is an additive design against the current Veyrnox schema. It defines **17 new owner-scoped tables**.

| table | responsibility |
| --- | --- |
| `music_workspaces` | Personal organization boundary; one default workspace per user. |
| `music_source_assets` | Durable owned uploads and normalized input metadata; bytes remain in R2. |
| `music_rights_attestations` | Versioned evidence for upload, composition, performance, remix, and publication rights. |
| `music_prompt_specs` | Immutable normalized Simple/Custom instructions, separate from provider payloads. |
| `music_generation_requests` | One quoted user intent and its pair-level lifecycle. |
| `music_songs` | Stable Library identity, workspace, visibility, trash state, and current version. |
| `music_song_versions` | Immutable audio/version records with operation and provenance. |
| `music_generation_candidates` | Exactly two v1 slots linking a request to existing jobs and resulting versions. |
| `music_version_sources` | Multi-source lineage for covers, samples, mashups, extensions, and inspiration. |
| `music_lyric_drafts` | Autosaved editable lyrics with optimistic revisions and conflict state. |
| `music_song_feedback` | One like/dislike decision per user and version. |
| `music_policy_checks` | Versioned input, output, publish, and export decisions without vendor payload leakage. |
| `music_share_links` | Revocable, hashed link-only tokens and bounded permissions. |
| `music_publications` | Moderated public slug and publish/unpublish audit state. |
| `music_download_periods` | Trial or monthly allowance windows, separate from credit balance. |
| `music_download_claims` | At-most-once quota use per song version and allowance period. |
| `music_export_attempts` | Idempotent MP3/WAV/stem render and transfer attempts. |

Existing tables remain authoritative:

- `public.users`: identity owner
- `public.model_catalog`: active capability and price source
- `public.jobs` / `public.job_steps`: execution state
- `public.assets`: generated bytes copied to R2
- `public.ledger_entries` / `public.credit_balances`: charges and refunds
- `public.webhook_events`: inbound provider deduplication

### 4.1 Access rules

- Every new row has `user_id`, `created_at`, and `updated_at`.
- RLS is enabled and forced on every music table. Authenticated users receive owner-only `SELECT`; writes occur through authenticated server routes and narrowly scoped RPCs.
- `/m/[token]` and `/music/[slug]` read through purpose-built server functions that return an allowlisted public projection. Anonymous users never query the owner tables directly.
- Service-role use is limited to verified server routes, webhooks, and recovery jobs. A client-provided `user_id`, price, provider ID, R2 key, or rights decision is never trusted.
- Sources and generated masters use `ON DELETE RESTRICT` while referenced. User deletion is a durable, audited cleanup workflow, not an unsafe cascade over external files.
- Prompt text and lyrics are private content. They are excluded from analytics, ordinary logs, error payloads, and webhook event summaries.

### 4.2 Hard invariants

- A v1 generation request has `output_count = 2`; candidate ordinals are constrained to 1 or 2 and unique per request.
- The pair is created and debited in one database transaction. There is no state in which candidate one is charged and candidate two was never created.
- Each candidate has its own existing `jobs` row and therefore its own refund outcome. Pair state may be `partial`; the UI shows exactly what was charged and refunded.
- A song version is immutable. An edit, cover, extend, crop, remaster, or lyric replacement creates another version and lineage edge.
- Publication is private/link-only by default. Public state requires a successful publish-phase policy check.
- Download allowance is consumed once per song version per period. Retrying the same format or a failed transfer does not consume another allowance.
- R2 object keys never appear in public URLs; all playback and downloads use short-lived signed URLs after entitlement checks.

## 5. API

All state-changing endpoints require the existing bearer session, same-origin protection, a bounded body, an idempotency key, and typed errors. Cursor pagination is mandatory for lists. Inputs use Veyrnox concepts; provider request shapes stay inside adapters.

### 5.1 Core release

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `GET /api/catalog?kind=music` | Lists verified active music capabilities and server-owned controls | signed in | optional mode | models, constraints, credits | F02-F03 |
| `GET /api/v1/music/entitlements` | Reads plan gates, credits, download allowance, and feature flags | owner | none | entitlement projection | F02, F19 |
| `POST /api/v1/music/uploads/reserve` | Reserves an R2 key after type, size, quota, and rights preflight | owner | filename, MIME, bytes, hash, rights version | upload URL and asset id | F05 |
| `POST /api/v1/music/uploads/:id/complete` | Sniffs and records the uploaded source | owner | measured metadata | ready source | F05 |
| `GET /api/v1/music/workspaces` | Lists personal workspaces | owner | cursor | workspace page | F12 |
| `POST /api/v1/music/workspaces` | Creates a personal workspace | owner | name | workspace | F12 |
| `PATCH /api/v1/music/workspaces/:id` | Renames or archives a workspace | owner | revision, patch | workspace | F12 |
| `DELETE /api/v1/music/workspaces/:id` | Deletes an empty workspace or moves songs to default atomically | owner | destination, revision | receipt | F12 |
| `GET /api/v1/music/songs` | Searches and filters the owner's Library | owner | workspace, status, liked, query, cursor | song page | F12 |
| `GET /api/v1/music/songs/:id` | Returns a song, current version, lineage, actions, and entitlement | owner | none | private song projection | F06, F16, F19 |
| `PATCH /api/v1/music/songs/:id` | Renames, moves, or changes private metadata | owner | revision, patch | song | F12 |
| `DELETE /api/v1/music/songs/:id` | Moves a song to trash after active-job checks | owner | revision | trash receipt | F12 |
| `POST /api/v1/music/songs/:id/restore` | Restores a trashed song | owner | destination workspace | song | F12 |
| `GET /api/v1/music/songs/:id/lyrics` | Reads the current autosaved lyric draft | owner | none | draft and revision | F03, F28 |
| `PUT /api/v1/music/songs/:id/lyrics` | Optimistically autosaves lyrics | owner | expected revision, body, structure | new revision or conflict | F03, F28 |
| `POST /api/v1/music/generation-quotes` | Validates model, prompt, sources, rights, policy, and pair price | owner | mode, model, prompt spec, sources | signed expiring quote | F02-F03, F06 |
| `POST /api/v1/music/generations` | Atomically debits and creates the request plus two jobs | owner | quote id, idempotency key | request and candidate ids | F02-F03, F06 |
| `GET /api/v1/music/generations/:id` | Returns normalized pair progress and settlement | owner | none | request and candidates | F02-F03, F06 |
| `POST /api/v1/music/generations/:id/cancel` | Requests cancellation and refunds only unsubmitted work | owner | reason | settlement projection | F02-F03 |
| `POST /api/v1/music/songs/:id/actions/quote` | Quotes cover, extend, crop, replace, or remaster against a version | owner with rights | operation and parameters | signed quote | F06, F07, F08 |
| `POST /api/v1/music/songs/:id/actions` | Creates a non-destructive operation request | owner with rights | quote id, source version, parameters | request | F06, F07, F08 |
| `PUT /api/v1/music/songs/:id/feedback` | Upserts like/dislike for the current version | owner | rating, optional reason | feedback | F02-F03 |
| `POST /api/v1/music/songs/:id/share-links` | Creates a revocable link-only token | owner | permissions, expiry | one-time raw URL | F16 |
| `DELETE /api/v1/music/share-links/:id` | Revokes a link | owner | idempotency key | receipt | F16 |
| `GET /api/v1/music/shared/:token` | Resolves the allowlisted link-only player projection | public | token | public-safe song | F16 |
| `POST /api/v1/music/songs/:id/publish` | Runs publish policy and creates/updates a public slug | owner | permissions, rights version | publication | F16 |
| `DELETE /api/v1/music/songs/:id/publish` | Unpublishes without deleting the private song | owner | idempotency key | receipt | F16 |
| `GET /api/v1/music/public/:slug` | Reads a moderated public projection | public | slug | public-safe song | F16 |
| `POST /api/v1/music/songs/:id/export-quotes` | Checks format, commercial rights, and download allowance | owner | version, format | signed quote | F19 |
| `POST /api/v1/music/songs/:id/exports` | Claims quota at most once and starts/reuses an export | owner | quote id, idempotency key | export id | F19 |
| `GET /api/v1/music/exports/:id` | Returns export state and a short-lived download URL when ready | owner | none | export projection | F19 |

Authentication itself remains the existing Supabase flow for F01; account and Stripe routes remain existing Veyrnox routes rather than music-specific duplicates.

### 5.2 Later capability routes

These routes are architectural reservations, not day-one promises. They are built only after the preceding milestone proves demand and the associated policy/provider gate is green.

| method path | does | who | input | output | flow |
| --- | --- | --- | --- | --- | --- |
| `POST /api/v1/music/sound-quotes` | Validates one-shot/loop controls and quotes two sound candidates | owner | prompt, kind, optional BPM/key | quote | F04 |
| `POST /api/v1/music/sound-generations` | Starts the two-candidate sound request | owner | quote | request | F04 |
| `POST /api/v1/music/songs/:id/stem-quotes` | Quotes the admitted paid vocals/instrumental split | owner with source rights | current version, rights attestation | quote | F09 |
| `POST /api/v1/music/songs/:id/stems` | Starts or reuses the one-job stem archive request | owner with source rights | quote id, idempotency key | request | F09 |
| `GET /api/v1/music/stem-requests/:id` | Projects normalized queued/running/ready/refunded state | owner | none | request | F09 |
| `GET /api/v1/music/stem-requests/:id/archive` | Mints a short-lived attachment URL for the opaque ZIP | owner | none | signed archive projection | F09 |
| `POST /api/v1/music/songs/:id/target-stem-quotes` | Remeasures the current source and quotes one target/residual split | owner with source rights | version, allowlisted target, rights | exact duration-tier quote | F09 |
| `POST /api/v1/music/songs/:id/target-stems` | Starts or reuses one paired-output SAM separation | owner with source rights | quote id, idempotency key | request | F09 |
| `GET /api/v1/music/target-stem-requests/:id` | Projects paired queued/running/ready/refunded state | owner | none | request | F09 |
| `GET /api/v1/music/target-stem-requests/:id/:kind` | Mints a five-minute target or residual WAV URL | owner | target or residual | signed asset projection | F09 |
| `POST /api/v1/music/songs/:id/track-add-quotes` | Remeasures one current MP3 and quotes upload plus one matching part | owner with source and lyric rights as applicable | version, mode, direction, optional lyrics, rights | exact two-stage quote | F07 |
| `POST /api/v1/music/songs/:id/track-adds` | Atomically debits both stages but dispatches only the source upload | owner | quote id, idempotency key | staged request | F07 |
| `GET /api/v1/music/track-add-requests/:id` | Projects upload/generation stage and normalized state | owner | none | request | F07 |
| `GET /api/v1/music/track-add-requests/:id/audio` | Mints a five-minute URL for the separate generated part | owner | none | signed asset projection | F07 |
| `GET /api/v1/music/voices` | Lists consented reusable voices/personas | owner | cursor | profiles | F10 |
| `POST /api/v1/music/voices` | Starts owned-voice enrollment | eligible owner | source, consent evidence | verification challenge | F10 |
| `POST /api/v1/music/voices/:id/verify` | Verifies a live challenge before activation | subject owner | challenge response | profile state | F10 |
| `DELETE /api/v1/music/voices/:id` | Disables new use and schedules provider deletion | owner | idempotency key | deletion state | F10 |
| `GET /api/v1/music/custom-models` | Lists owned training profiles | owner | cursor | models | F11 |
| `POST /api/v1/music/custom-models` | Validates owned training set and creates a draft | eligible owner | sources, rights | model draft | F11 |
| `POST /api/v1/music/custom-models/:id/train` | Quotes and starts training | owner | quote | training state | F11 |
| `POST /api/v1/music/workspaces/:id/invites` | Invites a user with a bounded role | owner | handle, role | invite | F13 |
| `GET /api/v1/music/invitations` | Lists pending invitations | signed in | cursor | invites | F14 |
| `POST /api/v1/music/invitations/:id/accept` | Accepts a live invite | invitee | revision | membership | F14 |
| `POST /api/v1/music/invitations/:id/decline` | Declines a live invite | invitee | revision | receipt | F14 |
| `DELETE /api/v1/music/workspaces/:id/members/:userId` | Removes or leaves membership under role rules | owner/member | reason | receipt | F13-F14 |
| `GET /api/v1/music/playlists` | Lists ordered owned collections | owner | cursor | playlists | F15 |
| `POST /api/v1/music/playlists` | Creates a playlist | owner | title | playlist | F15 |
| `PUT /api/v1/music/playlists/:id/songs` | Atomically replaces ordered membership | owner | expected revision, song ids | playlist | F15 |
| `POST /api/v1/music/playlists/:id/inspire` | Creates a source manifest from eligible owned versions | owner | selected versions | generation draft | F15 |
| `POST /api/v1/music/albums` | Creates a private album draft | owner | metadata, songs | album | F17 |
| `POST /api/v1/music/albums/:id/publish` | Confirms which included songs become public and publishes atomically | owner | rights and policy versions | album publication | F17 |
| `POST /api/v1/music/hooks` | Creates a moderated short video/song excerpt post | owner | song range, owned video, lyric flag | hook | F18 |
| `GET /api/v1/music/taste` | Reads explainable preference tags | owner | none | editable tags | F20 |
| `PUT /api/v1/music/taste` | Updates or disables personalization | owner | revision, tags, enabled | preferences | F20 |
| `POST /api/v1/music/studio-projects` | Creates a versioned production project | entitled owner | source version | project | F21 |
| `GET /api/v1/music/studio-projects/:id` | Reads the project document and capabilities | member | none | project | F21-F25 |
| `PUT /api/v1/music/studio-projects/:id/document` | Saves an optimistic audio/MIDI document revision | editor | revision, document | new revision | F22-F24 |
| `POST /api/v1/music/studio-projects/:id/takes` | Quotes and creates two generated takes | editor | range, prompt, quote | take lane | F23 |
| `POST /api/v1/music/studio-projects/:id/exports` | Renders full, range, or multitrack output | editor | kind, range, format | export | F25 |
| `POST /api/v1/music/speech-quotes` | Quotes speech plus optional backing music | owner | script and controls | quote | F26 |
| `POST /api/v1/music/speech-generations` | Starts the speech pipeline | owner | quote | request | F26 |
| `POST /api/v1/music/sample-quotes` | Validates rights, ranges, and two-source compatibility | owner | sources, ranges, mode | quote | F27 |
| `POST /api/v1/music/sample-generations` | Starts sample or two-song mashup generation | owner | quote | request | F27 |
| `POST /api/v1/music/visual-generations` | Creates original cover image/video candidates | owner | target, prompt, owned reference | visual job | F29 |
| `POST /api/v1/music/mcp/generations` | Exposes the same quote/confirm workflow to an assistant | owner after explicit confirmation | normalized intent | request | assistant integration (S34) |

### 5.3 Webhooks and background jobs

| kind | name | schedule / trigger | responsibility |
| --- | --- | --- | --- |
| webhook in | existing provider callbacks | provider event | Verify signature, dedupe in `webhook_events`, refetch when required, and advance only the matching job. |
| webhook in | existing Stripe callbacks | Stripe event | Existing credit/subscription settlement only; music does not parse billing events separately. |
| webhook out | `music.generation.completed` | optional account integration | Signed, opt-in event with IDs and state only; never prompt, lyrics, or direct media URL. |
| job | music pair projector | provider completion | Creates immutable song/version rows when each job reaches `STORED`; settles pair state as success, partial, or failed. |
| job | stuck music recovery | existing 5-minute Worker sweep | Polls eligible providers, retries bounded storage copy, and invokes existing refunds. |
| job | upload expiry | every 15 minutes | Deletes abandoned upload reservations and queues orphan R2 keys for reap. |
| job | share expiry | hourly | Revokes expired tokens and clears cached public projections. |
| job | export recovery | every 5 minutes | Retries bounded transcodes/transfers without double-claiming allowance. |
| job | rights deletion | daily plus on demand | Deletes revoked sources/derived files once retention and legal holds allow. |
| job | reconciliation | existing nightly job | Adds pair/candidate, export-claim, and orphan-version checks; any row is an incident. |

## 6. Generation and edit orchestration

### 6.1 Pair transaction

`music_submit_pair` is a security-definer RPC called only by the authenticated server route. In one transaction it:

1. resolves `auth_id` to `public.users.id` and locks the user balance;
2. validates the signed quote, its expiry, model catalog version, sources, and latest policy result;
3. creates one `music_generation_requests` row;
4. invokes the ledger's internal debit path twice with derived idempotency keys;
5. inserts candidate ordinals 1 and 2 linked to the two jobs;
6. commits only if both jobs and both debits exist.

Provider submission happens after commit. A submit refusal advances that job through the existing rejection/refund path. One candidate may succeed while the other is refunded; the request becomes `partial`, not falsely `failed` or `succeeded`.

### 6.2 Candidate completion

```text
DEBITED -> SUBMITTED -> SUCCEEDED -> STORED
    |           |            |
    +-----------+------------+-> FAILED -> REFUNDED
```

After `STORED`, the projector creates a stable `music_songs` row and immutable v1 `music_song_versions` row, then attaches the candidate. It records the catalog model ID, prompt-spec ID, source hashes, rights-attestation IDs, provider job ID, policy version, and asset SHA-256 in provenance. Provider-specific payloads are not copied into public metadata.

### 6.3 Non-destructive actions

Cover, extend, crop, replace section, add section, and remaster share the same request spine:

- source is a specific immutable song version, never merely the mutable song ID;
- operation parameters are validated against the selected model capability;
- every source becomes a `music_version_sources` edge with ranges and rights evidence;
- outputs are new versions or new songs according to the user-visible action;
- the original version remains playable until explicit deletion.

Client-side crop/fade preview is allowed, but a downloadable master is always a server-recorded export with lineage and entitlement checks.

## 7. Safety, rights, and provenance

- **Uploads:** allowlisted MIME, magic-byte sniffing, size/duration caps, antivirus where applicable, hash dedupe, private storage, and an explicit rights attestation before submission.
- **Music rights:** distinguish composition, lyrics, master recording, performance, voice, and artwork. “I uploaded it” is not treated as ownership of all layers.
- **Artist imitation:** independent policy and moderation; do not inherit or reproduce a competitor's blocklist or exact behavior.
- **Voices:** not in v1. Later enrollment requires eligible region/age, live challenge, consent evidence, abuse review, revocation, and provider-side deletion support.
- **Public release:** link-only is the default. Publication reruns rights and policy checks and presents the commercial-rights status accurately; it does not manufacture rights.
- **Provenance:** keep source hashes, model/catalog version, prompt-spec version, job lineage, edits, policy decisions, and rights versions. Add C2PA or watermarking only after an ADR and interoperability review; never claim it exists before it does.
- **Deletion:** soft-delete user organization state immediately, revoke public access immediately, then asynchronously delete bytes and provider artifacts subject to fraud, dispute, and legal retention.

## 8. The parts that bite

- **Idempotency:** browser retries, provider callbacks, Stripe events, exports, and publish actions all arrive more than once. Every mutation has a user-scoped key; webhooks keep their external-event unique key.
- **Race conditions:** quotes can expire, catalog prices can change, balances can be spent in another tab, a song can be trashed during export, and one candidate can finish after cancellation. Lock the balance/request rows and make state transitions compare-and-set.
- **Partial success:** two candidates are two jobs. Surface individual settlement and never charge again merely to repair the projection.
- **File limits:** reject before debit using measured duration and MIME; enforce provider limits again server-side after upload. Never rely on browser metadata.
- **Search:** start with Postgres full-text/trigram search over owner-visible title and user-authored tags. Do not index lyrics or prompts into third-party search.
- **Realtime:** poll normalized job state first. Add SSE only when load and UX data justify it; Supabase Realtime is not required for v1.
- **Offline:** composer drafts may be local, but quotes, rights, generation, publication, and deletion require the server. Lyrics autosave uses revision conflicts rather than last-write-wins.
- **Rate limits:** keep the existing generation-attempt limit and add upload, share-token, public-playback, and export limits. Concurrency is an entitlement, enforced in the debit RPC rather than UI.
- **Time:** all timestamps are UTC `timestamptz`. Monthly download windows follow the billing provider's authoritative period boundaries, not local calendar arithmetic.
- **Multi-tenancy:** v1 workspaces are personal. Do not reuse the existing tenant/project tables until shared music collaboration is deliberately enabled and role semantics have an ADR.
- **Email deliverability:** mail is a convenience for long jobs; in-product state is canonical. Suppress repeated failure mail and honor notification preferences.
- **GDPR deletion:** maintain a deletion manifest across Postgres, R2, provider artifacts, analytics identifiers, share caches, and exported derivatives. Preserve only the minimum fraud/billing evidence required by policy.
- **Browser audio:** waveform decoding, large files, Safari behavior, memory pressure, and mobile autoplay rules are product risks. Use AudioWorklets/Web Audio only for preview; render canonical masters server-side.

## 9. Build order

### 1. Vertical slice — Simple instrumental pair

- screens: S02, S05, S08, S09, S10
- flows: F01-F02
- tables: workspaces, prompt specs, generation requests/candidates, songs/versions, policy checks
- routes: catalog, entitlements, quote, create, generation read, Library list, song detail, feedback
- provider: one already verified official catalog capability; two jobs, one atomic quote/debit
- exit: a new user can create, pay the displayed amount, receive two durable playable results, see exact partial failure/refund behavior, and reopen both from Library

### 2. Must-haves — Custom creation and owned sources

- screens: S06, S11, S17, S25-S26
- flows: F03, F05, F12, F19, F28
- tables: source assets, rights attestations, lyric drafts, download periods/claims, export attempts
- routes: uploads, lyrics, workspace mutations, export quote/start/read
- exit: each visible control is proven by the active model schema; owned uploads are private and rights-bound; download retries do not double-count

### 3. Must-haves — non-destructive iteration and sharing

- screens: S11-S13, S21
- flows: F06-F08, F16
- tables: version sources, share links, publications
- routes: action quote/start, share create/revoke/read, publish/unpublish/read
- exit: lineage is complete, originals remain recoverable, link-only is default, and public publication is policy-gated

### 4. Should-haves — organization and creator tools

- screens: S14-S20, S27, S35-S38
- flows: F09, F15, F17, F26-F29
- additions: stems, playlists, albums, Speech, sampling/mashup, richer lyrics, and original cover art
- exit: each area has its own provider/rights evaluation and is not a thin button over an unverified endpoint

### 5. Collaboration and identity products

- screens: S15-S18, S23
- flows: F10-F14
- additions: shared-workspace role model, invitations, voice consent/verification, and optional custom-model training
- exit: abuse, revocation, model deletion, and collaboration ownership rules are tested before launch

### 6. Studio and integrations

- screens: S28-S34
- flows: F21-F25 plus assistant connection
- additions: versioned audio/MIDI document, browser recording, render graph, take lanes, effects sandbox, multitrack export, explicit-confirmation MCP surface
- exit: treated as a separate production workstation project with performance budgets and browser compatibility gates

### 7. Fixes from `/replica-entrepreneur`

Run product differentiation before broadening the surface. Any change must improve Veyrnox's user outcome rather than chasing capability count. Likely candidates are creator-to-video handoff, transparent rights/provenance, and cross-modal reuse with the existing Veyrnox Library.

## 10. Release gates

- a live, official provider capability passes schema and end-to-end output verification
- pair debit/refund and download claims pass Postgres acceptance tests under concurrency
- rights, AUP, privacy, commercial-use copy, and data retention have legal review
- input/output moderation has a documented independent policy and operator path
- R2 lifecycle, source deletion, and provider deletion are rehearsed
- generated audio quality is tested across prompts, vocals/instrumentals, genres, duration, and failure cases
- a Reticle journey proves quote -> create -> two results -> Library on the running app when implementation begins
- production flags default off until staging evidence and an ADR authorize activation

Next step after this architecture is `/replica-design` for the first-release screens, followed by one vertical-slice implementation rather than parallel construction of the whole surface.

## 11. Increment 6 implementation note

Owned-source admission now exists behind `MUSIC_SOURCES_ENABLED` in addition to the schema/UI gates. The browser opens the surface only on explicit intent, records a versioned immutable rights attestation, uploads MP3/WAV bytes directly to a random private R2 key, and asks the server to complete the reservation. Completion trusts neither browser metadata nor duration: the server reads the stored object, sniffs bytes, measures duration and enforces 480-second free or 1800-second paid ceilings plus the 20 MiB transport cap. Browser projections never expose storage keys. Sources remain creation inputs, not proof of universal composition, performance or commercial rights.

The public `/music` entry now captures a guest direction and hands it to the existing authentication surface without quoting or spending. The draft is scoped to session storage, hydrates authenticated Create once, and is removed after consumption. A ready source cannot be submitted through the current instrumental model because its catalog schema does not advertise source input; the UI blocks that path instead of fabricating support. Production flags remain disabled until disposable-database and real-R2 acceptance passes.

## 12. Increments 7–8 implementation note

Public release is deliberately separate from Link-Only sharing and requires `MUSIC_PUBLICATION_ENABLED`. The mutation locks the owner/current immutable version, records immutable publication-rights evidence, reruns the independent prompt policy, stores comments/remix permissions and creates a reversible creator-profile listing. The commercial projection has only two honest values: personal use or plan eligible with terms applying. It never states that Veyrnox cleared third-party rights. Public projections strip storage/job identifiers; five-minute asset redirects are no-store and unpublish fails closed.

Basic crop requires `MUSIC_EDITING_ENABLED`. The browser proposes a range, but the server reads the private object and measures its real audio duration before mutation. One atomic RPC checks the current source version, writes an idempotent receipt, creates an immutable child and edit-source edge, and advances the song pointer without altering the original. The child reuses bytes only for a media-fragment preview and carries `render_state=preview_only`; export refuses it until a later render pipeline creates a distinct canonical asset.

## 13. Increment 9 implementation note

Private playlists require the schema, Library and separate `MUSIC_PLAYLISTS_ENABLED` gates. Creation and pin changes use owner-scoped durable mutation receipts; membership is replaced atomically as an ordered list only after every song is proven to belong to the owner. The playlist revision prevents stale concurrent updates, and browser projections expose no foreign or storage identifiers. The client can search within one selected playlist and shuffle its current listening order. It does not claim continuous queue playback, cross-playlist search or playlist-conditioned generation; inspiration stays visibly unavailable until a compatible independently verified model exists.

## 14. Increment 10 implementation note

Songwriting helpers remain entirely provider-independent. Original direction suggestions are bounded by the existing prompt contract. The first authenticated visit exposes a dismissible inline guide rather than an obstructive modal. Custom opens the same draft in a focused full-screen editor; inserting a structure marker passes through a pure length-bounded transformation, and the existing optimistic revision/autosave hook remains the only persistence path. None of these controls can quote, spend or submit lyrics to the instrumental-only model.

## 15. Increment 11 implementation note

Private feedback is an owner/song value, not a public engagement counter. `music_song_feedback` has a composite foreign key to the owned song, forced RLS and no authenticated-table grants. A service-role RPC accepts only like, dislike or clear after resolving the authenticated owner. The Library projection left-joins by both song and owner, enabling a private Liked filter without exposing aggregate social data. List/grid choice is presentational and does not mutate song state.

## 16. Increment 12 implementation note

Playlist search has two explicit scopes. The default reads only the selected ordered collection; all-playlist search flattens owner-projected memberships, matches song and playlist titles, and retains a composite playlist/song row key so membership in two collections is not falsely deduplicated. Existing reusable surfaces remain separate products: the stock-voice studio performs independently priced speech with exact scripts and delivery controls, and the OAuth-protected MCP endpoint exposes five read-only inspection tools. Neither surface is relabelled as music generation, playlist mutation or soundtrack composition.

## 17. Increment 13 implementation note

Private audio downloads remain one provider-independent exact-format pipeline. A quote carries either `mp3` or `wav`, and the database accepts it only when the immutable asset MIME belongs to that format's allowlist. The start transaction locks the allowance period and claims a version at most once regardless of retry; the owner-scoped export projection carries the quoted format back to the gateway. Before minting a five-minute signed URL, the gateway verifies the projection's format/MIME pair and derives the download extension from a canonical MIME type. This is deliberately not a transcoder: an MP3 cannot be requested as WAV and a WAV cannot be requested as MP3. Preview-only crop versions still fail the independent renderability gate. The migration and `MUSIC_DISTRIBUTION_ENABLED` flag remain unapplied/off until isolated database and R2 acceptance passes.

## 18. Increment 14 implementation note

Writing assistance is local, bounded and optional. The focused editor reads only the current selection/caret and returns a small curated rhyme family plus original craft prompts; it never mutates lyrics. Style augmentation appends the next absent production detail only when the result fits the existing 500-character draft boundary, then persists through the existing optimistic autosave path. Neither operation calls a model or spends credits, and neither is presented as My Taste personalization.

Browser recording reuses Veyrnox's tested Web Audio WAV encoder rather than widening the source MIME contract. Microphone access begins only from an explicit button, MediaRecorder output is decoded locally, and the resulting interleaved 16-bit PCM WAV enters the exact same file selection, immutable rights attestation, server inspection and private upload path as a user-selected WAV. Capture is capped at 60 seconds; timers and media tracks are stopped on completion and unmount. Recording does not weaken the disabled source/library/schema rollout gates or make the admitted model audio-compatible.

## 19. Increment 15 implementation note

The private Library now treats owned source uploads as a first-class collection without changing their trust boundary. The client requests `/music/sources` only after the owner opens Uploads; that route resolves the authenticated owner through the service-role RPC, removes the private storage key and adds a five-minute preview URL only for ready sources. Cards display the original filename and MIME-derived format, measured duration, stored byte size and immutable rights state. Upload and deletion remain in the existing Create admission surface so the collection itself is read-only.

The collection deliberately does not merge uploads with generated song workspaces or present uploaded audio as separated material. It states that stems are unavailable and that each item is the original file. Loading, empty, API error and absent-preview states remain independently recoverable. The surface requires `MUSIC_UI_ENABLED`, `MUSIC_SCHEMA_ENABLED`, `MUSIC_LIBRARY_ENABLED` and `MUSIC_SOURCES_ENABLED`; all remain disabled in production pending database/R2 owner-isolation, signed-URL expiry and deletion-race acceptance.

## 20. Increment 16 implementation note

Song removal is reversible state, not deletion. The lifecycle endpoint accepts only `trash` or `restore` plus the owner's observed 32-bit revision. The transaction resolves the authenticated owner, locks that exact song, returns an idempotent success if the target status was already reached, rejects a mismatched revision for an opposite transition and otherwise advances status and revision together. The Library projection accepts only `active` or `trashed`, remains owner-scoped and withholds playable asset URLs for trashed rows.

The client lazy-loads Trash, removes trashed rows from active selection/workspace counts and restores the same immutable song/version into its original workspace. The surface has no DELETE handler and permanently deleting database rows, R2 assets or provider artifacts is not claimed. Production schema and Library gates remain disabled until two-owner, same-target replay and concurrent opposite-transition acceptance passes on a disposable migrated database.

## 21. Increment 17 implementation note

Music Sounds is discovery and reuse, not a duplicate generation backend. It hands the user to generic Create with the exact catalog IDs `elevenlabs-sfx-v2` and `mmaudio-v2`. Their shared capability registry requires a text prompt and pins provider payloads to one 10-second effect or one 8-second soundscape. Generic Create owns catalog availability, exact credit display, debit/refund and result persistence, so the Music surface cannot drift into a second pricing or job implementation.

The Sounds page is available only when the Music UI gate is enabled, but it does not require Music schema/library gates because it invokes independently admitted generic models. It states that neither route advertises seamless looping, BPM or musical-key control. Loop generation therefore remains unimplemented and unscored rather than being inferred from a short audio output.

## 22. Increment 18 implementation note

Music now admits two exact instrumental pair contracts. ACE-Step v1 keeps its fixed 60-second `tags` payload. ACE-Step 1.5 uses the independently verified `prompt` payload with fixed 60-second duration, thinking enabled and one output per job; Music still creates two independently tracked jobs. Both remain catalog-priced at quote time and catalog-version checked again under the locked submit transaction.

ACE-Step 1.5 is a paid capability, not a client-side label. Entitlements expose it only as available for an active subscription whose paid period ends in the future. The quote RPC and pair-submit RPC independently repeat that check, so a forged request, expired entitlement cache or subscription ending between review and confirmation fails closed before debit. The clean-room UI calls this a higher-quality paid model and does not use or imply Suno v6 weights, identity or behavior. Migration and rollout remain off pending isolated subscription-race and live-provider acceptance.

## 23. Increment 19 implementation note

Shared concurrency is a bounded admission feature rather than an unbounded client queue. The client retains every accepted pair, renders its own title/state/candidates and polls all non-terminal request IDs independently. A successful confirmation clears only its consumed quote, allowing a new exact quote while earlier pairs continue. Four active shared slots are projected by entitlements and visible in Create; priority capacity is not inferred from a paid subscription.

The database owns the ceiling. Migration `0263` moves the previously verified atomic pair function behind a service-role-only inner function and exposes a wrapper that locks the owner row before counting `debited` and `running` requests. A new request is refused at four before reaching either ledger debit. An existing idempotency key bypasses only the capacity check and delegates to the original transaction, preserving replay convergence without minting a slot or charge. Production flags remain disabled until simultaneous-confirmation, terminal-release and fifth-request behavior pass on a disposable migrated database.

## 24. Increment 20 implementation note

Collaboration is a separate private boundary, not an extension of public profiles. Users claim a private exact handle; owners may invite that handle only to a named workspace. Workspace-row locks serialize the ten-member ceiling, invitation keys make ambiguous retries converge, and only the addressed invitee can accept or decline. Owner membership is created for existing and future workspaces.

Collaborators receive a read-only projection of member roles and current shared songs. They cannot move, trash, publish, invite, or otherwise mutate the owner's songs through this surface. The Workspaces page acts as the in-app notification inbox and labels the role boundary explicitly. External notification delivery, member removal, ownership transfer and paid-plan enforcement remain unavailable until their own contracts and isolated two-user acceptance exist.

## 25. Increment 21 implementation note

Lyric assistance reuses the existing Chat product boundary. Music builds one bounded user message from a 280-character editing request and at most the existing 3,000-character private lyric draft. The message identifies the draft as owned, requests original work, rejects living-artist imitation and external lyric reproduction, and remains below Chat's input ceiling. It is a user message, not a hidden system instruction.

The handoff is local and user-scoped: Music writes through Chat's existing per-account New Chat draft store, preserves any unsent text already there, verifies the prepared prompt can be read back, and navigates only after a dirty Music revision saves successfully. Chat retains model selection, price display, explicit Send, ledger debit, provider streaming and refund behavior. No Music endpoint receives model text, no response is parsed or copied back automatically, and the instrumental Music generation boundary is unchanged. A future writeback must present a diff and apply through the existing optimistic revision contract rather than overwriting concurrent lyrics.

## 26. Increment 22 implementation note

Result return is a narrow parser contract, not arbitrary Chat-to-Music mutation. The request requires `BEGIN REVISED LYRICS` and `END REVISED LYRICS` on exact lines. Chat offers a Music return action only for a completed reply containing one non-empty block within the existing lyric limit. The session payload is tied to the current account, expires after one hour, contains no provider credentials or storage identifiers, and is removed on Apply or Discard.

Returning does not mutate server state. Custom first loads the current private draft and shows the assistant proposal as read-only text. If the draft differs from the source captured before Chat, the review warns that it changed. Apply calls the same client update used by direct typing, so autosave submits the currently observed revision and the existing three-way conflict UI remains authoritative if another tab won a race. A malformed, oversized, expired or different-account payload cannot produce an Apply control. Chat still owns explicit send, price, debit, streaming and refund; Music still owns revisioned lyric persistence.

## 27. Increment 23 implementation note

Lyricist profiles are tagged Chat personas, not custom models. They reuse the existing owner-scoped, forced-RLS persona table and definer RPCs, including the twenty-profile account ceiling, unique names, optional feature gate and deletion semantics. Music loads personas only after explicit disclosure, filters on both a name prefix and versioned instruction prefix, and never exposes unrelated Chat personas in the Music picker.

Profile creation requires explicit ownership consent plus bounded examples and a separate broad craft direction. The stored instruction says examples are private and owned, permits inference only of general imagery/cadence/density/structure, forbids distinctive-line reuse and living-artist imitation, and never claims training. A selected profile contributes only its UUID to the one-hour account-bound handoff. Chat verifies that UUID is still present in the caller's persona list and invokes the existing new-chat persona selection; it does not change an existing thread, auto-send, change price, enable web search or bypass the normal system-prompt copy on first send. Deletion removes the reusable profile while prior chats retain only the instructions already copied under Chat's established contract.

## 28. Increment 24 implementation note

Selected-line editing is a constrained variant of the existing Chat handoff, not an audio regeneration claim. Focus lyrics records integer start/end offsets only for a non-empty selection in the current private draft. The unsent Chat prompt includes the exact selected text and bounded draft context, preserves the 4,000-character Chat ceiling and requires only one block between `BEGIN REPLACEMENT LINES` and `END REPLACEMENT LINES`. Chat pricing, explicit Send, debit/refund and streaming remain unchanged.

The one-hour account-bound return stores only parsed replacement text plus the captured source revision, lyrics and offsets. Music loads the latest private draft before review and disables Apply when its lyrics differ from the captured source, because offsets may have moved. Otherwise a pure bounded splice replaces exactly `[start,end)` and leaves the prefix and suffix byte-for-byte unchanged, then uses the normal optimistic autosave path. Empty, malformed, oversized, expired, different-account and out-of-range payloads fail closed. No Music provider call, automatic send, automatic apply or production flag change is introduced.

## 29. Increment 25 implementation note

Canonical crop rendering begins with one format that can be transformed without a third-party codec: fixed-frame integer PCM WAV. The pure renderer validates a single RIFF/WAVE format and data chunk, PCM tag, channel/rate/bit-depth agreement, frame alignment and requested bounds. It copies only whole selected frames into a fresh standalone WAV with corrected RIFF/data lengths. Compressed, floating-point, malformed, ambiguous and oversized inputs do not become masters; they retain the earlier preview-only behavior.

The Worker measures the stored source, reads the private object only for an eligible bounded WAV, hashes the rendered bytes and writes a new random `music-renders/<owner>/<version>.wav` object. Migration `0265` admits zero-credit jobs only for the exact `music-local-crop`/`local`/`STORED` tuple, then one owner-locked transaction creates that job, immutable asset, child version, source edge and replay receipt and advances the current pointer. A retry checks the receipt before R2 work; a concurrent late replay deletes only its unreferenced duplicate object, while an ambiguous database response leaves bytes intact for safe reconciliation. Export accepts generated or `render_state=canonical` versions. Production schema/editing flags remain off until the migration, R2 object lifecycle, simultaneous replay and cross-owner paths pass in isolated staging.

## 30. Increment 26 implementation note

Fade and speed reuse the canonical PCM parser rather than widening the provider boundary. The parser accepts unambiguous integer PCM WAV at 8, 16, 24 or 32 bits and preserves the declared sample format. Fade copies all frames before applying linear gain envelopes, so the input bytes remain immutable. Speed linearly interpolates frames at a fixed sample rate; its duration becomes source duration divided by the selected 0.5×–2× ratio, and the UI explicitly discloses that pitch changes with speed. A 1× no-op, empty fade, overlapping fade longer than the source, compressed/float/malformed WAV and objects above 25 MiB fail closed.

The gateway obtains owner/current-version context before reading R2, hashes and uploads one new random WAV object, then calls a single owner-locked commit. Migration `0266` admits zero-credit jobs only for `music-local-crop`, `music-local-fade` or `music-local-speed` in the exact local/STORED state, and expands operation allowlists only to fade/speed. The commit binds the job, asset, immutable child, `edit_source` edge, exact parameter receipt and current pointer. Same-key retries compare operation, source and canonical JSON parameters before returning the prior version; explicit rejection deletes an unreferenced upload, while ambiguous commit responses retain bytes for reconciliation. Production flags remain disabled pending disposable-database and real-R2 concurrency acceptance.

The Music browser harness uses `VEYRNOX_E2E_ISOLATED=true` to select a dedicated `.next-music-e2e` dist directory. This prevents test compilation from sharing Next's development lock or Turbopack state with the owner's active preview. Default development and production builds continue to use `.next`.

## 31. Increment 27 implementation note

ACE-Step 1.5's official fal schema exposes `lm_temperature` from 0 to 2 and defines higher values as more creative/diverse. The paid-model Simple form maps a bounded 0–100 Variety value piecewise so 0 → 0, 50 → the provider default 0.85 and 100 → 2. Migration `0267` stores the user value on the immutable `music_prompt_specs` row and a `BEFORE INSERT` dispatch trigger derives the provider field for both candidates inside the same transaction. The quote boundary rejects the control for every other model and rejects fractional/out-of-range values. No unsupported style/audio influence control is displayed, and all rollout flags remain off pending live database/provider acceptance.

## 32. Increment 28 implementation note

The same official ACE-Step 1.5 schema defines `lm_cfg_scale` from 1 to 10 and `lm_negative_prompt` as guidance away from unwanted characteristics. The progressive Advanced section therefore maps Style influence 0–100 to 1–10, where zero preserves the provider default, and clearly warns that non-default language-model CFG may be substantially slower. Excluded styles/instruments are bounded to 500 trimmed characters and described as guidance rather than a guaranteed content filter.

Migration `0268` stores both values on the already immutable prompt spec. Its seven-argument quote wrapper delegates all existing catalog, plan, rate and affordability checks before updating that exact snapshot. The dispatch trigger now reads Variety, Style influence and exclusions through the job's candidate/request/prompt chain and adds only the corresponding documented provider fields. Base ACE-Step and malformed values fail before quote creation. All rollout flags remain off pending disposable-database and live-provider acceptance.

## 33. Increment 29 implementation note

Both admitted provider schemas accept duration, but their maximums exceed the fixed 60-second catalog tier currently priced by Music. The product control is therefore intentionally narrower: integer values from 10 through 60 seconds in five-second UI steps. Migration `0269` stores the exact value on the prompt spec and the existing dispatch trigger overwrites the fixed payload duration for both endpoints and both candidates. The candidate credit quote does not change and the UI states that it covers every selectable length. Longer generation remains a separately priced future capability.

## 34. Increment 30 implementation note

Custom generation accepts no lyrics or styles from the quote request. The browser submits only `mode=custom`, the currently observed saved revision, duration and a true ownership attestation. The route reads the owner-scoped draft for moderation; `music_create_custom_quote` resolves the same owner again, requires exact revision equality under `FOR SHARE`, requires non-empty bounded lyrics/style, requires ACE-Step 1.5 and delegates paid-plan/catalog/rate/affordability checks to the existing quote spine.

Migration `0270` widens the prompt-spec shape into two disjoint checked schemas. Simple remains instrumental with no lyric fields; Custom must be non-instrumental, paid-model-only, revision-bound and carry `music-lyrics-rights-v1`. The dispatch trigger reads only that stored snapshot and supplies exact `prompt` plus `lyrics` to both provider jobs. A before-insert version trigger replaces the older hard-coded simple provenance with the stored mode/schema/rights/revision. No browser can forge provider lyrics, and the base model remains a private draft-only target. All rollout flags stay off pending stale-revision, cross-owner, plan-expiry and real-provider acceptance.

## 35. Increment 31 implementation note

Custom instrumental is an explicit quote dimension, not a client-only presentation toggle. The request must contain one boolean `instrumental` and the complementary rights value: vocals require `rights_confirmed=true`; instrumental requires `false` because no lyric-rights claim applies. The quote route moderates only style direction for instrumental requests, while vocal requests continue to moderate style plus the authoritative saved lyrics. Both modes re-save and bind one exact owner draft revision before price review.

Migration `0271` changes the checked Custom prompt shape into two mutually exclusive branches. Vocal snapshots retain non-empty lyrics and `music-lyrics-rights-v1`; instrumental snapshots store no lyrics and no rights version, even when the private writing draft retains text. Dispatch derives the official ACE-Step 1.5 `[Instrumental]` lyrics marker only from the immutable stored boolean. Provenance now records that boolean beside mode/schema/revision. The base ACE-Step contract remains required-instrumental, pricing and two-candidate settlement are unchanged, and every production rollout gate remains disabled pending migrated-database and real-provider acceptance.

## 36. Increment 32 implementation note

Cover is a separate source-audio admission boundary, not a relabelled text generation. The browser submits only the current version UUID, bounded musical direction, 10–90 source-character value and explicit recording-rights attestation. The quote route resolves that owner/current version to its immutable asset, verifies stored MP3/WAV bytes, measures one-to-120 seconds and passes only the measured duration to a service-role quote. The browser never supplies an audio URL. Confirmation repeats source/current-version checks, measures the object again, rejects duration drift and creates a short-lived signed provider URL only on the server.

Migration `0272` stages Stable Audio 3 Small audio-to-audio at two credits per candidate from the documented $0.0248 flat cost, but keeps the catalog row inactive. The prompt snapshot binds source song/version/duration, influence and `music-cover-source-rights-v1`; both debit jobs receive the same prompt, duration and output bounds while influence maps to `init_noise_level = 1 - influence/100`. Successful candidates settle into the source song as separate `cover` versions with immutable `cover_source` edges, leaving the quoted parent recoverable. A distinct `MUSIC_COVER_ENABLED` flag composes Library, generation and durable dispatch gates. No production flag or provider row is activated pending billed provider, migrated-database, R2 expiry, cross-owner and concurrent-settlement acceptance.

## 37. Increment 33 implementation note

Stem separation is admitted as one narrow paid archive contract, not a claim of arbitrary instrument extraction. The owner submits only the current version UUID plus explicit source-rights confirmation. Both quote and confirmation re-resolve the owner/current version, inspect stored bytes, require MP3 at or below the provider's ten-megabyte limit, and create the short-lived provider URL only on the server. Before the separate confirmation, the UI shows the exact 13-credit price and states that missing or unclear vocals/instrumental material may produce a silent or limited result while still spending the quote.

Migration `0273` stages Mureka `audio-separation-3` at the documented $0.20 flat provider price, rounded up to 13 internal credits, while keeping the catalog row inactive. An owner lock, paid-period check, two-active-request cap, quote binding and idempotency receipt precede one ledger debit and one durable fal job. The immutable payload contains only the server URL and exact model enum. Webhook settlement recognizes the documented `zip_url`; storage admits the result as an opaque `application/zip` asset and never extracts provider-controlled paths on the server. Ready state requires a stored ZIP, and only the owner can mint a five-minute attachment URL. `MUSIC_STEMS_ENABLED` composes the schema, generation, dispatch and Library gates; all production gates remain disabled pending disposable-database, R2 and billed-provider acceptance.

## 38. Increment 34 implementation note

Extend uses ACE-Step's documented audio-outpaint endpoint rather than relabelling a variation model. The first contract is intentionally fixed: append 30 instrumental seconds, never prepend, never replace the ending, and never claim seamlessness before live acceptance. The browser submits one current version UUID, bounded style direction and recording-rights attestation. Quote and confirmation independently resolve and measure the owner/current MP3 or WAV, reject drift, and create the provider URL only on the server.

Migration `0274` stages `fal-ai/ace-step/audio-outpaint` inactive at the documented $0.0002 per generated second: a fixed 30-second candidate costs $0.006 and maps to one credit, so the pair quote is two credits. One owner lock, current paid period, shared four-pair cap, exact quote and replay key precede two independently refundable debits. Both jobs receive the same immutable tail-only payload with `[instrumental]`; successful candidates settle as sibling `extend` versions with `extend_source` evidence while the source remains recoverable. `MUSIC_EXTEND_ENABLED` composes schema, generation, dispatch and Library gates. No catalog row or production flag is active pending billed endpoint, migrated-database, R2 drift and simultaneous-settlement acceptance.

## 39. Increment 35 implementation note

Replace Section uses ACE-Step's separately documented audio-inpaint endpoint and does not masquerade as a local splice. The first contract is intentionally narrow: one exact 1–30 second range inside an owner/current MP3 or WAV whose measured duration is at most 60 seconds, one bounded instrumental direction and explicit recording-rights evidence. Quote and confirmation each re-resolve the immutable current version, inspect stored bytes, reject duration or revision drift, and expose a short-lived provider URL only from the server. The browser cannot nominate an asset URL or broaden the range after quote creation.

Migration `0275` stages `fal-ai/ace-step/audio-inpaint` inactive at the documented $0.0002 per generated output second. Because the whole admitted source is capped at 60 seconds, provider cost is bounded at $0.012 per candidate and maps conservatively to one internal credit, so the pair quote is two credits. Owner locking, active paid period, frozen-account and balance checks, the shared four-pair ceiling, a recent-job rate limit, exact catalog/quote binding and one replay key all precede two independently refundable debits. The payload freezes start/end relative to the source start, tags, `[instrumental]`, variance, safety and inference steps. Successful jobs become sibling `replace_section` versions with `edit_source` edges carrying exact source, range and rights evidence; prior Simple/Custom/Cover/Extend provenance and failure codes remain intact. `MUSIC_REPLACE_ENABLED` composes schema, generation, dispatch and Library gates, and no catalog row or production flag is active pending billed endpoint, migrated-database, R2 drift and concurrent-settlement acceptance.

## 40. Increment 36 implementation note

Replace candidates no longer race to become current during asynchronous settlement. Both ready versions remain sibling takes while the quoted source stays current. The owner-visible generation projection adds only the already-owned immutable version UUID—never an R2 key or provider URL—so the dialog can bind a deliberate choice to the exact generation request.

Migration `0276` adds a forced-RLS, service-role-only take-commit receipt. The commit locks the owner and song, requires a ready candidate from the exact Replace request, checks the version's song, operation and parent source, refuses a stale current pointer, and makes both same-key replay and one-commit-per-generation deterministic. Only then does it advance `current_version_id`; it never deletes or mutates either audio version. The UI auditions both audio assets, disables both choices after one succeeds, acknowledges the chosen take before refreshing, and returns to history with one current marker. This closes the staged audition/commit behavior but does not activate the inpaint provider or schema gates.

## 41. Increment 37 implementation note

Reuse is a private draft transformation, not a provider remix. The action appears only when the owner/current version has a generation request. Its read boundary joins that exact version through its owner-scoped request to the immutable prompt snapshot and returns only stored lyrics/style plus the current private-draft revision. It never returns storage keys or accepts copied text from the browser.

Migration `0277` applies selected lyrics and/or style under the owner lock and optimistic draft revision. It preserves title and every unselected field, switches to the verified Custom-ready model target, creates no job or ledger entry, and stores the result snapshot in a forced-RLS service-only idempotency receipt so a lost acknowledgement cannot apply twice. Cross-owner, stale current-version, stale draft, missing selected material and incompatible-model cases fail closed. `MUSIC_REUSE_ENABLED` is independent and remains disabled pending a disposable two-user migration test.

## 42. Increment 38 implementation note

Phone onboarding reuses Supabase Auth rather than adding an identity store. The shared AuthGate exposes an E.164 SMS option, requests one OTP through GoTrue with the existing Turnstile token and verifies exactly six digits before adopting the normal persisted session. The public `/auth/v1/settings` projection can fail closed when phone signup is disabled; an unreadable settings endpoint permits an ordinary attempt so a temporary settings outage does not hide a configured provider. SMS delivery, rate limits and account creation remain Supabase/provider responsibilities. No test sends a real SMS: the isolated browser harness replaces only settings, OTP and verification responses, while ordinary builds retain the production Turnstile site key.

## 43. Increment 39 implementation note

The canonical PCM-WAV renderer now supports one bounded section operation without claiming a DAW. An owner chooses one measured split that leaves at least one second on either side; the renderer copies whole frames into fixed order `[2,1]`, preserving format and duration. Migration `0278` admits only the exact zero-credit `music-local-reorder` stored job and `reorder` version/receipt values, validates the fixed permutation and measured duration again, then atomically creates the immutable asset/version, edit-source edge and replay receipt before advancing the current pointer. Compressed/float WAV, MP3, more than two sections, arbitrary permutations and timeline editing remain unavailable. Schema, editing and storage rollout gates remain disabled pending disposable-database/R2 acceptance.

## 44. Increment 40 implementation note

Sounds looping reuses the existing admitted ElevenLabs Sound Effects v2 generation path and its unchanged two-credit fixed 10-second unit. The official ElevenLabs API and fal endpoint schemas both define `loop` as a boolean request for a smoothly repeating effect. That evidence becomes one `bool` input in the shared capability record, public catalog projection, generic Create model shape, transport allowlist and pre-debit model validator. Provider shaping forwards the field unchanged; no new adapter, database table, price or rollout switch is introduced.

The generic settings form renders Seamless loop only when the selected catalog capability declares it. The fallback catalog preserves that same model-specific mark while live catalog data remains authoritative. MMAudio drops the UI field and rejects it at the model boundary if a client tries to send it directly. BPM and musical key are disclosed only as natural-language prompt directions because neither admitted provider schema exposes them as guaranteed structured controls. The v2 endpoint is deprecated, so replacement requires a separate schema and billed-output acceptance rather than silently moving this contract to v3.

## 45. Increment 41 implementation note

Remaster is a measurable local PCM operation, not an AI-mastering claim. The renderer accepts only fixed-frame PCM WAV and one explicit peak ceiling from −3, −2 or −1 dBFS. It measures each channel's arithmetic mean, subtracts that DC offset sample by sample, finds the corrected inter-channel peak and applies one linked gain. The linked gain preserves the stereo image; the output retains the source sample rate, channels, bit depth and frame count. Constant/silent material, unknown ceilings, compressed/float WAV and malformed containers fail closed. No compressor, limiter, EQ, source separation or loudness target is implied.

Migration `0279` extends the existing local-render trust boundary rather than introducing a provider. Only `music-local-remaster` may create a zero-credit stored job, and only an exact `remaster` receipt with the selected ceiling can replay. The commit rechecks owner/current source, output duration, R2 key shape, hash and exact parameter object before creating a new immutable WAV asset/version plus `edit_source` edge and advancing the current pointer. The source version remains recoverable. Schema, editing and storage gates remain disabled pending disposable-database/R2 acceptance; no provider catalog row or production flag changes.

## 46. Increment 42 implementation note

Add Section uses the documented ACE-Step audio-outpaint inputs as a separate transformation, not a second label for fixed Tail Extend. The request freezes one owner/current MP3 or WAV up to 120 seconds, `beginning` or `end`, one of 10/20/30 generated seconds, a bounded style string, optional structured lyrics and explicit recording/lyric permission. Empty lyrics map to the provider's `[instrumental]` marker. The UI discloses that this is edge outpainting only: it cannot insert into the middle, count beats, replace an existing passage or guarantee a seamless join before live acceptance.

Migration `0280` stages `ace-step-add-section` inactive against `fal-ai/ace-step/audio-outpaint` at the maximum documented 30-second cost of $0.006 per candidate, conservatively mapped to one credit each. The prompt constraint separates `add_section` from `extend`, records position/duration and requires lyric-rights evidence only for a lyrical section. Owner locking, active paid period, source remeasurement, shared pair concurrency, rate limits, exact catalog/quote binding and one replay key precede two independently refundable debits. Dispatch maps beginning/end to mutually exclusive `extend_before_duration`/`extend_after_duration`, and settlement creates immutable `add_section` children with `edit_source` evidence. `MUSIC_ADD_SECTION_ENABLED` composes all durable gates and remains false pending migrated-database, R2 and billed-provider acceptance.

## 47. Increment 43 implementation note

Target-stem separation is a distinct paired-asset workflow, not a relabelled Mureka archive. The official SAM Audio text-guided endpoint accepts a source plus a target description and returns both the isolated target and the residual. Veyrnox exposes only nine bounded labels, resolves them to provider descriptions server-side, remeasures one owner/current MP3 or WAV and caps the source at 120 seconds. The quote uses the documented $0.05 per started 30 seconds to freeze 4/7/10/13 credits. The UI states that an absent, ambiguous or blended sound may be quiet or bleed while still spending the quote.

Migration `0281` stages `sam-audio-target-stem` inactive at the 120-second maximum cost, keeps rights, source duration, catalog revision and target label immutable, shares the two-request stem concurrency boundary and uses one replay-safe ledger debit. Dispatch pins automatic span prediction, one reranking candidate, balanced acceleration, 60-second chunks, five-second overlap and WAV output. Generic fal settlement cannot safely collapse the two URLs into one asset, so the verified callback recognizes a target/residual pair, copies each under a deterministic key, then calls one service-only transaction that inserts both assets, binds their roles and moves the job to stored. Owner reads expose only five-minute signed URLs. `MUSIC_TARGET_STEMS_ENABLED` composes schema, dispatch, generation and Library gates and remains false pending database/R2/billed-provider acceptance.

## 48. Increment 44 implementation note

Matching-part generation follows Mureka's documented two-endpoint contract rather than pretending the track endpoint accepts a browser audio URL. One owner/current MP3 is byte-sniffed, measured at no more than 10 MB and 120 seconds, then frozen with a bounded direction, vocal or instrumental mode and source rights. Vocal mode additionally freezes exact lyrics and lyric-rights evidence; instrumental mode rejects both. The UI states that the output is a separate part and never claims that Veyrnox mixes it into the source.

Migration `0282` stages inactive one-credit `mureka/api/files/upload` and six-credit `mureka/v8/generate/track` rows. One owner lock, paid-plan/current-version/catalog checks and one replay key atomically create both debits, but only the upload dispatch exists initially. A verified upload callback validates the opaque provider id, marks the metadata-only upload stage stored, inserts the already-debited track dispatch with exact `Vocals`/`Instrumental`, direction, safety and optional lyrics fields, then wakes that job. Upload failure or malformed success fails and refunds both jobs in one service-only boundary; later track failure uses the generic independent six-credit refund because the one-credit upload was already delivered. Generic track settlement stores one private audio asset, and the owner reads it only through a five-minute signed URL. `MUSIC_TRACK_ADD_ENABLED` composes schema, dispatch, generation and Library gates and remains false pending disposable-database, R2 and billed-provider acceptance.

## 49. Increment 45 implementation note

The matching-vocal contract now carries only Mureka's documented optional range preference: `female`, `male` or omission. Automatic stores `auto` in the immutable quote and omits the provider field; the two explicit choices become the exact lowercase provider enum only for `generate_type='Vocals'`. Instrumental mode clears the browser control and is rejected at both parser and database boundaries if any explicit vocal range is injected. The UI describes this as a generated vocal-range preference, not a selected identity, reusable Voice, consent claim or clone. No pricing, ledger, callback, asset or rollout semantics change.

## 50. Increment 46 implementation note

Studio begins as an owner-scoped session workspace over existing immutable Music data, not as a fabricated project database. `musicStudioEnabled` composes the schema and Library gates with the separate `MUSIC_STUDIO_ENABLED` flag. Only then does the owner song projection expose `open_studio`, the Music shell show Studio navigation and the two Studio routes render. The project hub directs owners through their existing Library and explicitly says named projects and saved arrangements do not exist.

The song workspace reads the same owner-only song projection and current short-lived audio URL used elsewhere. One real audio clip drives browser-native playback, seeking, looping, mute, volume and visibility. Local tempo, 3/4–4/4–6/8 guide, grid density and contrast affect only the session grid and Web Audio metronome; they never alter, stretch or persist the immutable source. The dock is a read-only view of existing versions and operations. The page states that save, multitrack and MIDI editing, recording, take generation, effects, automation, stretching and export are absent. No migration, credit entry, provider request, storage mutation or production flag is introduced.

## 51. Increment 47 implementation note

Studio audio recording is a local browser boundary, not a hidden source upload. The page calls `getUserMedia` only after explicit Prepare input intent, stops the permission probe, enumerates `audioinput` devices and later opens the exact selected `deviceId` for capture. Count-in and project pre-roll admit only none or 1/2/4 bars at the bounded session tempo and signature. Count-in uses short Web Audio oscillator clicks; pre-roll starts the existing source player before capture. The recorder stops automatically at 60 seconds.

MediaRecorder containers remain browser-specific, so the captured Blob is decoded by Web Audio and passed through the existing tested interleaved 16-bit PCM WAV encoder. The resulting object URL becomes one of at most five tab-local takes with start-position/duration labels, playback, explicit removal and WAV download. Cleanup stops tracks, cancels timers, closes the click context and revokes object URLs. No gateway call, R2 object, database row, credit event or immutable song version is created. The UI discloses that takes are unsaved, unaligned and not latency-corrected; MIDI and durable project mixing remain separate work.

## 52. Increment 48 implementation note

Studio MIDI is another tab-local boundary. `requestMIDIAccess({sysex:false})` is called only after explicit user intent; connected inputs are enumerated by id/name and exactly one input receives the note handler. Note-on/off messages and the documented A–semicolon musical-typing map feed the same capture path. Z/X changes a bounded octave offset and C/V changes bounded velocity. Safari/Web-MIDI absence fails to a musical-typing fallback without a permission retry loop.

Capture labels notes from the current audio playhead and elapsed session tempo. The local piano roll caps at 64 notes and edits only pitch, start beat, length and velocity within explicit bounds, plus sixteenth-note timing quantization and deletion. A Web Audio OscillatorNode makes notes audible with four elementary waveforms and can schedule the clip at the session tempo. Cleanup stops active voices, detaches device handlers and closes its context. No MIDI file, project record, provider request, credit event or browser storage is created. The UI expressly disclaims wavetable synthesis, MIDI Learn, CC/transport, chord/arpeggiator, pitch bend/modulation and generated-audio conversion.

## 53. Increment 49 implementation note

Studio effects attach only after explicit user intent. Until then the original `HTMLAudioElement` owns mute and volume and no media-source node exists. Activation creates one `MediaElementAudioSourceNode` for that element and transfers manual mute/volume to a Web Audio master gain so the signal is never double-scaled. The ordered rack contains a peaking biquad EQ, dynamics compressor, WaveShaper distortion, feedback delay and generated-impulse Convolver reverb. Each device has a real bounded parameter surface; reorder and bypass reconnect the source through only the active devices while preserving one source and one destination. Unmount disconnects the graph and closes its context.

The first automation lane is deliberately narrow. Up to 16 local volume points carry time and 0–1.25 gain values; the live playhead linearly interpolates adjacent points and multiplies that value by the manual track level at the same master gain. Clearing the lane returns its multiplier to one. No fetch, gateway call, storage write, provider request, credit event or project mutation exists. The UI explicitly disclaims gate, sidechain, presets, custom chat plugins, nonlinear curves, pan/effect-parameter lanes, persistence, offline rendering and effect-bearing export. This supports partial effects and automation credit only, not a complete factory rack or durable DAW claim.

## 54. Increment 50 implementation note

Clip settings produce a separate local render instead of mutating the transport element or immutable version. Explicit Render intent reads the current media URL; `data:` sources decode without a network request so CSP remains intact, while ordinary same-origin or permitted signed asset URLs use credential-safe fetch. Web Audio decodes the bytes and the renderer clamps one range to 60 seconds before allocating output. Reverse walks source samples backward. Semitone/cents tuning maps to one bounded power-of-two rate and linearly resamples every channel, intentionally linking pitch and duration rather than pretending to preserve either independently.

Fade-in and fade-out are applied per output sample using selected linear, exponential or logarithmic envelopes. The existing PCM encoder writes the processed buffer to a tab-local object URL for native audition and WAV download; replacement revokes the prior URL and unmount revokes the final one. No gateway call, database row, R2 write, credit event, project save or current-version change exists. The UI expressly disclaims pitch-preserving stretch, formant, warp markers, quantize, loop flags, lyrics/styles/stems info and transport replacement. This supports partial clip settings, fine pitch, fade-curve and clip-download credit only.

## 55. Increment 51 implementation note

Effects are now instance records with a unique id, processor type, independent parameter object and UI state. The initial five types remain bounded, while copy stores a detached parameter snapshot and paste or direct duplicate creates a fresh id and processor. Move changes array order, remove drops one instance and the chain caps at ten. A graph-synchronization effect compares identity sets: parameter-only changes update the existing node; any add/remove disposes every old processor node, constructs the exact next rack and reconnects it in order. The original media-element source and master gain survive those rack rebuilds, preventing the platform-invalid second source attachment.

The browser contract verifies parameter independence rather than row count alone: the original EQ remains +6 dB while its pasted copy changes to −4 dB; moving that copy and directly duplicating the original produces separate biquad nodes but leaves the media-source request count at one. State is still tab-local. Cross-track dragging, keyboard shortcuts, persistent presets and plugin-library reuse remain outside the boundary.

## 56. Increment 52 implementation note

Latency calibration is an acoustic measurement, not a stored number picker. Preparation requests microphone permission only after intent, immediately stops the probe and enumerates audio inputs. A run reopens the exact selected device with echo cancellation, noise suppression and automatic gain disabled. One Web Audio input source feeds an analyser while three short 1.2 kHz output clicks are scheduled at 150, 450 and 750 milliseconds. Animation-frame sampling finds returned peaks above a fixed threshold only inside a 250 ms window after each expected click; the reported value averages detected return offsets and includes a detected/expected confidence count.

No detection returns no number. Permission/start failures apply no state. Completion or unmount cancels the frame and timeout, disconnects nodes, stops every stream track and closes the context. The result remains tab-local and expressly does not compensate, align or persist recorded takes; it also cannot distinguish device buffering from physical speaker-to-microphone travel. This supports partial calibration credit only.

## 57. Increment 53 implementation note

The MIDI instrument now constructs sound from explicit harmonic tables rather than selecting an elementary oscillator type. Each voice creates two `OscillatorNode` sources with independent `PeriodicWave` objects, crossfades them through complementary gains, then routes the sum through a resonant low-pass `BiquadFilterNode` and one amplitude envelope. A third sine oscillator modulates filter frequency through a bounded LFO gain. Note frequency and velocity feed the same graph for typing, selected Web MIDI input, scheduled piano-roll playback and the floating pointer keyboard, so the instrument is one audible implementation rather than decorative controls.

Three presets populate the two table choices, morph, cutoff, resonance, attack, release, LFO rate and depth; any direct edit marks the patch custom. Live polyphony evicts the oldest voice after 12 active keys, scheduled notes stop after their release and unmount stops remaining sources before closing the context. The floating panel is a labelled in-page dialog with eight pointer keys and explicit copy that it cannot move to another display. No server request, browser storage, provider job, credit event or project mutation exists. Table uploads/capture, auxiliary envelopes, the full modulation matrix, glide/detune/mono modes, MIDI Learn, chat patch design, generated-audio conversion, durable patches and detached plugin windows remain outside the boundary, so both synth and pop-out rows receive partial—not complete—credit.

## 58. Increment 54 implementation note

Discovery is a curated Veyrnox seed catalog, not a copy of another service's community feed. Six immutable allowlisted records carry an original title, generated cover, tempo, key, mood, bounded production recipe and a compact procedural preview pattern. The browser schedules the 12-second sketch through Web Audio only after Play; no remote catalog, user recording, hidden ranking signal, provider request or credit event is involved. Mood filters and search operate on that in-memory projection.

`/app/music/create?sample=<id>` accepts only one exact registry id on the server. A valid id becomes an attached seed card while the creator's new direction stays in a separate 200-character field. The quote prompt is assembled from the canonical server-known recipe plus that direction and remains under the existing 500-character parser boundary. Removing the card returns to ordinary Simple creation. The preview recording itself is never attached or claimed as an audio-conditioned source: the existing exact quote, explicit confirmation, two-candidate dispatch and refund behavior are unchanged.

The six cover images are original Veyrnox project assets generated specifically for these beat cards. Suno community audio, thumbnails, branding, creator identities and engagement data remain excluded. Personalized ranking, public publishing into Discover, likes, play counts and true audio-to-audio sampling require separate rights, data and provider contracts.
