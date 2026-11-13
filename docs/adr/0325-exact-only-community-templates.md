# ADR-0325: Exact community prompts and scoped publication

Status: Accepted by owner work order, 5 November 2026.

Community templates use their captured source record as the only positive prompt.
Registration derives `prompt` and `sourcePrompt` from `exactSourcePromptRecord`;
both origin fields are `community-source-exact`. Its existing display-time
platform-word stripping is unchanged. Raw text remains locked by SHA-256.
No separate authored positive or negative prompt is served. Removed authored
prompts survive only as hashes in the regression fixture.

Publication requires a complete source prompt, scoped to `SOURCE_TEMPLATES`.
The 27 promptless adaptations join the 42 unavailable and one truncated row:
70 hidden rows, 841 retained community rows, 749 public exact templates.
Of 64 prepared Syntx pairs, 63 add 126 local assets; Dark Couture is rejected because stripping nine typography mentions materially rewrites its prompt. Source media, hashes and
provenance remain evidence. Clip publication uses template ownership, with
explicit independent landing placements; clip keys need not equal template IDs.
Ten promptless homepage wall cards are removed, leaving 14.

`sourcePromptRunnable` is informational by owner decision: 285 public templates
are audit-compatible and 464 incompatible. The application sends the selected
exact text even when reference slots cannot be filled. This decision does not
change limits, pricing contracts, required-input validation or consent. The Syntx route correction described below follows the existing importer precedent. All three
assigned model routes currently have a 30,000-character prompt limit; none of
the public exact prompts exceeds it. There are 400 prompts with explicit
`@imageN`, `@videoN` or angle-bracket slots, and 424 with reference requirements
under the broader audit parser. No reference is silently invented or substituted.

Both API prompt fields remain populated for installed mobile versions. Unedited
template prompts retain whitespace in Create and Film Studio handoffs and in
chat drafts. Web and mobile Create preserve unedited recovered drafts as well:
recovery has no template provenance. Other typed or edited Create text retains
existing trimming. Film draft formats and recovered drafts cannot distinguish
edited template text; these shared paths preserve all nonempty text. Chat SEND is
unchanged: `validateTurn` and the send handler still trim, because the stored turn
(`chat_complete_turn` stores `btrim(p_user_text)`) and the idempotency request hash
(`lib/chatTurn.js`) both trim; sending raw text would need a forward migration and
a request-hash change, which are out of scope for this change. A template prompt
therefore loses only its surrounding whitespace when sent through chat. Chat's
existing 8,000-character
and token caps still reject oversized text in full. They never truncate it.

The independent effect (1,036) and reference (6) recipe catalogs are out of scope.
They retain their direct routes, detail responses and artwork; they have no
video-backed gallery/list rows. Their authored prompts are unchanged.

Offline proof covers exact bytes, hash exclusion, hidden routes, scoped catalog
publication, media ownership, old metadata and prepared asset hashes. Native
builds and full suites are reserved for the host. No deployment is part of this
work order. ADR number is the next free local number; the host resolves collisions.

The exact-only visual check uses the permitted ffprobe path: one 32×32 grayscale
frame per second, then SHA-256 of the newline-joined frame Adler-32 checksums.
All 931 retained placements have distinct signatures under that common method.
The 63 accepted new audit rows declare this method, and the full comparison is locked in
`tests/fixtures/exactOnlyVisualSignatures.json`. Earlier raw-frame SHA-256
signatures remain unchanged in the historical captures. No video was encoded.

Amendment 1 requires at least ten public exact templates in each of the twelve
content categories. The prepared 30-record category batch contributes 28: two
incomplete prompts are rejected without rewriting them (mid-word truncation and missing replacement slots). KIDS
BIRTHDAY remains excluded pending an owner decision; its twelve promptless
rows stay hidden, and its CATEGORY_ORDER entry is retained. The generated
category table in the product prompt audit is the current count ledger.

Syntx routes and guidance follow `generatedInputGuidance` and R1/R3/R4 in
`scripts/import-seedance-source-templates.mjs`, independently of provider labels.
Compatibility is checked first: any numbered image/video reference or audio
preservation issue selects informational `community.copyOnly` guidance and R3
(Fast, five seconds). Compatible zero-reference text selects R4 (Fast, five
seconds). R1 selects Kling I2V when image guidance is returned; the current audit
marks image references incompatible before that branch. No copy-only enforcement
is added. Human source-model labels use an explicit captured-provider-ID table.
Categories use word boundaries and a reviewed per-record override table.

The chat turn server contract is unchanged. A first version of this change made `lib/chat.js`
`validateTurn` and the web send handler preserve surrounding whitespace; review found that
the database stores `btrim(p_user_text)` and the request hash trims, so a saved partial reply
could not be matched to the raw sent text and a reused idempotency key could replay distinct
prompts. The change was reverted rather than extended with a migration. Mobile Create model
switching passes the possibly edited prompt as the next screen's parameter, so nonempty text
is preserved untrimmed on that path.

The owner approved renaming `community-vehicle-carjacking` to `community-chicken-bucket-swap` / CHICKEN BUCKET SWAP because its prompt describes a chicken-bucket swap.
The eleven renamed Syntx entries now also use neutral public IDs, clip keys and media filenames to remove source franchise/celebrity names from URLs, discovery and mobile handoffs; original slugs remain provenance only, with no redirects for these unpublished additions.
The broader added-corpus scan also identified the Hoonigan brand: `community-hoonigan-custom-swap` becomes `community-custom-drift-car-swap` / CUSTOM DRIFT CAR SWAP under the same owner decision, with exact prompts and media bytes preserved.

<!-- BEGIN PUBLIC PROMPT HYGIENE -->
Captured public text remains verbatim by owner decision, including third-party handles, plates, addresses, domains, promo codes and upload filenames. These are pattern-detected candidates, not verified identities. No redaction or publication change is applied. The shared offline scanner and regression test cover all 299 + 63 + 28 + 11 + 3 accepted raw prompts.

| Capture | Affected public id | Detected kinds |
| --- | --- | --- |
| higgsfield-300-exact | `community-interactive-ar-showroom` | address, handle |
| higgsfield-300-exact | `community-toy-car-swap` | plate |
| higgsfield-300-exact | `community-drift-curve-replacement` | plate |
| higgsfield-300-exact | `community-boxing-identity-swap` | upload filename |
| higgsfield-300-exact | `community-street-squat-duo` | domain |
| higgsfield-300-exact | `community-urban-sedan-pursuit` | plate |
| syntx-64-exact | `frozen-time` | domain |
| higgsfield-category-fill-30 | `community-macro-product-montage` | domain, promo code |
<!-- END PUBLIC PROMPT HYGIENE -->

<!-- BEGIN CLIPPED SOURCE REVIEW -->
The final ending review rejected `community-miniature-desktop-chase`: Incomplete source prompt ends with an unfinished environment/lighting list and a trailing comma. Only audit identifiers, hashes and reasons remain; the rejected records, recipes, clips, media and active fixtures were removed. The 300-record capture now retains 299 pairs. Historical stage-1 counts above describe the earlier snapshot.

The detector reports 74 ambiguous unpunctuated endings, plus 1 separately reviewed ambiguity. These rows remain published. A trailing connector without an origin-gap pattern stays ambiguous; a connector alone never auto-rejects or hides a row. Origin-stripped connectors remain under the source-reference-gaps policy. The complete id/reason/tail inventories are generated in the five audit JSONs under `ending-review`.

Connector endings and separately reviewed ambiguities are listed below. Tails contain the last 80 characters (or the whole prompt if shorter); `\r` and `\n` represent captured line endings.

| Public id | Reason | Final 80 characters |
| --- | --- | --- |
| `community-skyline-delivery` | Trailing connector accompanies origin-stripped references; retained by origin-gap policy. | ` el de , el conductor es el personaje de y la bolsa lleva la marca como se ve en` |
| `community-formal-dance-swap` | Trailing connector accompanies origin-stripped references; retained by origin-gap policy. | ` on the train with a tesa. And try to immitate the exact face + eye movements of` |
| `community-alleyway-dance-crew` | Trailing connector accompanies origin-stripped references; retained by origin-gap policy. | `dog from <<<video_1>>> with the dog on\n and the last cat from <<<video_1>>> with` |
| `community-dragon-summoner` | Complete final sentence; 15-second sequence stops during the 10.2–11.7-second shot. | `\nChin subtly raised.\nFor a brief beat, the protagonist continues looking upward.` |
<!-- END CLIPPED SOURCE REVIEW -->

<!-- BEGIN SOURCE REFERENCE GAPS -->
## source-reference-gaps (informational)

20 retained rows across the five captures are exact as published but incomplete by origin: source feeds delete reference mentions. The owner may hide them. Their captured bytes, publication and `sourcePromptRunnable` flags remain unchanged. Input-asset counts corroborate missing mentions where the capture records them; Syntx does not supply that count in this audit. The detector uses grammatical gaps, not upload counts alone, and does not guarantee detection of every missing mention.

| Capture | Affected public id | Detected gaps | Captured input assets |
| --- | --- | --- | ---: |
| higgsfield-300-exact | `community-music-video-recast` | empty reference before punctuation, missing reference between connectors | 7 |
| higgsfield-300-exact | `community-gas-station-reveal` | empty reference group | 6 |
| higgsfield-300-exact | `community-skyline-delivery` | missing Spanish reference | 3 |
| higgsfield-300-exact | `community-dragon-summoner` | empty reference before punctuation, missing reference after use, missing reference between connectors | 1 |
| higgsfield-300-exact | `community-vaulted-temple-walk` | missing reference between connectors | 2 |
| higgsfield-300-exact | `community-cabin-rhythm-duo` | missing reference assignment | 2 |
| higgsfield-300-exact | `community-formal-dance-swap` | empty reference before punctuation, missing reference at end | 2 |
| higgsfield-300-exact | `community-rainy-street-encounter` | missing reference before line break, missing reference between connectors | 2 |
| higgsfield-300-exact | `community-kitchen-feline-reveal` | empty reference before punctuation, missing reference after use | 2 |
| higgsfield-300-exact | `community-noir-espionage-flow` | missing swap subject | 7 |
| higgsfield-300-exact | `community-nightclub-duo-recast` | empty reference before punctuation, missing reference after use, missing reference between connectors | 4 |
| higgsfield-300-exact | `community-desk-chair-spin` | missing reference after article | 1 |
| higgsfield-300-exact | `community-tactical-gear-montage` | missing reference between connectors | 2 |
| higgsfield-300-exact | `community-model-vehicle-swap` | missing replacement before scope | 1 |
| higgsfield-300-exact | `community-summit-lounge-style` | missing reference between connectors | 2 |
| higgsfield-300-exact | `community-industrial-lens-flare` | missing reference between connectors | 1 |
| higgsfield-300-exact | `community-alleyway-dance-crew` | missing reference at end, missing reference before line break | 5 |
| syntx-64-exact | `grab-heist` | empty reference before punctuation, missing conditional subject | not recorded |
| higgsfield-category-fill-30 | `community-supercar-night-drive` | empty reference before punctuation | 1 |
| higgsfield-category-fill-30 | `community-apocalypse-terrace` | empty reference before punctuation | 1 |
<!-- END SOURCE REFERENCE GAPS -->

## Amendment 2: fourteen self-contained replacement templates — 7 November 2026

The host screened the Higgsfield community feed, Syntx Trends and the Seedance
page for self-contained exact prompts naming no reference video and requiring
zero to two images, then viewed the shortlisted previews. Sixteen prepared
same-record pairs were frozen: twelve Higgsfield and four Syntx. The owner
approved the flagged Cyberpunk Rooftop Encounter, Pet Affection Reveal, Martial
Arts Suit and Luxe Timepiece Reveal previews. Cyberpunk remains deferred despite
that content approval: it and The Push 2 need two separately identified character
images, which no offered route can bind. Their audit rejection reason is
“two separate character references cannot be bound by any offered route”. Neither
ships a record, template or medium. Eleven Higgsfield and three Syntx pairs add
fourteen public exact templates and 28 unchanged prepared files (18,604,756 bytes).

The final reviewed per-id table in each offline importer takes precedence over
token-derived routing. Nine text-only scenes use Seedance 2.0 Fast, 19 credits,
five seconds and null needs. Five single-portrait scenes use Kling 3.0 · I2V,
32 credits, ten seconds and existing `community.cinematic` guidance. Scene music
and lip-sync words do not require preserving an input soundtrack. The import
audits mark all fourteen compatible under that reviewed table, while retaining
token image/video/audio facts and separate `tokenAuditRunnable` values. The
unchanged runtime parser marks nine runnable and five incompatible; totals are
285 and 486 respectively. This informational difference changes no consumer,
route, capability, validation, pricing rule or publication predicate. The same
70 historical rows stay hidden; all 757 formerly public rows remain public.

Earlier screening rejected Groovy Night Routine because its preview contains an
unmentioned second dancer; wing-backflip for staged “real event” realism;
bed-trap for sexualised body focus; mouse-king for a required storyboard sheet;
and Dark Couture under the earlier platform-typography decision. None is imported.

The shared public-prompt-hygiene scanner reports zero matches for both replacement
captures, so it adds no affected-id table rows. BIGOTTI remains exact brand text
in Luxe Timepiece Reveal, not a detected handle; no redaction is applied. Both
source-reference-gap inventories are empty. Ending-review inventories remain
informational and are generated with the existing detector. Regression tests
lock every reviewed route, category delta, raw prompt hash, baseline record,
shipped hash and five-frame visual signature. No encoding or network is used.

Unedited exact community prompts are sent unchanged with a photo attached on web and phone (R4 fixed), lifting the G5a shipment hold.
