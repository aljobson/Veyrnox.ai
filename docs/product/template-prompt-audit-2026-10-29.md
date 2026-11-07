# Template prompt and source-capability audit — 29 October 2026

## Exact-only update — 5 November 2026

This ledger covers the community corpus. Original community text, captured
against the same source record/media, is the only served template prompt.
Raw records are SHA-256 locked; the existing `exactSourcePromptRecord`
platform-word stripping is the only publication transformation. Punctuation
such as the literal `SYNTX.AI` in Frozen Time is preserved by that existing rule.

| Code-derived population | Stage-1 snapshot | Exact-only plus replacements |
| --- | ---: | ---: |
| Retained community templates | 737 | 841 |
| Captured source texts, including one truncated record | 668 | 772 |
| Public community gallery | 694 | 771 |
| Public complete exact prompts | 667 | 771 |
| Hidden community rows | 43 | 70 |
| All addressable recipes including independent catalogs | 1,736 | 1,813 |
| Homepage wall templates | 24 | 14 |

The 27 previously visible `adaptation-only` rows are now hidden everywhere.
They join 42 unavailable and one truncated record. Hidden templates contain no
positive or negative prompt, and are absent from routes, API lists/details,
search, sitemap, random/roller choices and mobile discovery. Their media and
historical provenance stay in the repository. Source records remain evidence.
All public community rows have `prompt === sourcePrompt` and both origin fields
set to `community-source-exact`, including for older installed mobile clients.
Authored adaptation/negative strings were removed from all community data modules;
a hash-only fixture prevents them returning in served fields.

## Compatibility is informational

The owner explicitly requires the complete exact prompt to be handed to the
existing generation route even when source slots cannot be filled. No copy-only
blocking or limit increase is introduced. The Syntx routing correction follows the existing Seedance importer precedent. Existing required-upload,
price and consent checks remain. Audit-compatible: **285**; incompatible: **486**.
The previous stage had 244 compatible and 423 incompatible public exact prompts.

| Constraint | Public exact prompts |
| --- | ---: |
| Exceeds assigned verified prompt limit | 0 |
| Explicit numbered slot tokens (`@imageN`, `@videoN`, `<<<video_1>>>` family) | 414 |
| Image/video reference requirement under the broader audit parser | 444 |
| Any image reference | 432 |
| More than one image reference | 266 |
| More than two image references | 102 |
| Video reference | 201 |
| Audio/music/voice/dialogue/lip-sync mention | 224 |

All assigned route limits are 30,000 characters: `kling-3.0-i2v`,
`seedance-2.0-fast`, `seedance-2.0-reference`. None is shortened. The longest
record is IMPACT (28,970 characters). Chat retains its
separate 8,000-character/token caps and refuses oversized handoffs whole.

## Source evidence and duplicates

The stage before the 300-record expansion had 437 retained rows, 368 captured
texts (one truncated), 394 public templates and 367 public exact prompts.
The [300-record audit](source-audit/higgsfield-300-exact-2026-11-05.json) adds
299 immutable same-record prompt/video pairs and 598 prepared assets
(293,966,731 bytes). Its raw hashes, input roles, media and source metadata
are unchanged. Its 100 compatible / 199 incompatible flags remain informational.
Seventeen captured square labels were corrected using source and shipped
geometry: 16 landscape rows and Courier Pup as portrait. The evidence keeps
`manifestSourceAspect`; no provider aspect capability is inferred.

The [new Syntx audit](source-audit/syntx-64-exact-2026-11-05.json) adds 63
same-record prompts, 126 prepared media files and 80,645,464 shipped bytes.
The prior [Syntx 40](source-audit/syntx-40-2026-10-29.json),
[Higgsfield 90](source-audit/higgsfield-90-exact-2026-10-29.json) and
[Seedance 200](source-audit/seedance-200-exact-2026-10-29.json) ledgers remain
source evidence. Existing names, model routes, credits, durations, guidance,
steps and media are locked by regression hashes of all 737 original rows, except the approved descriptive rename of Vehicle Carjacking to Chicken Bucket Swap.

Only the baseline source-authentic duplicate pairs are allowed:
`who-was-that-business` / `curtain-reveal` and `event-character-swap` /
`rap-takeover` for raw and normalized text; `i-am-here` / `somebody` and
`wassup-freestyle` / `piano-vibe` for normalized text only. New records may
join none of them. Media hashes are unique across all 931 retained placements.

CapCut's six promptless previews, twelve Mixkit/Pexels birthday previews,
one generated preview and eight unproven historical wall previews are hidden.
Buzzy.now has no proven same-media exact-prompt match in this corpus.
LipSync.video's 21 creative-feature examples are feature references, not fixed
community templates. No title similarity or preview inference creates provenance.

The 1,036 effect concepts and six reference recipes remain out of scope and
unchanged. They retain direct routes and template-detail API responses, but
have no video-backed gallery, presets API, search or sitemap rows.
See [ADR-0325](../adr/0325-exact-only-community-templates.md).

The exact-only visual check uses the permitted ffprobe path: one 32×32 grayscale
frame per second, then SHA-256 of the newline-joined frame Adler-32 checksums.
All 931 retained placements have distinct signatures under that common method.
The 63 accepted new audit rows declare this method, and the full comparison is locked in
`tests/fixtures/exactOnlyVisualSignatures.json`. Earlier raw-frame SHA-256
signatures remain unchanged in the historical captures. No video was encoded.

<!-- BEGIN CATEGORY MINIMUM COUNTS -->
## Amendment 1: at least ten exact templates per content category

28 of 30 prepared same-record pairs are published, adding 22,066,713 bytes in 56 unchanged prepared files.
Archery Face Swap was dropped because its source text ends mid-word; Anime Court Match was dropped because both replacement subjects were stripped from an incomplete fragment. Only identifiers, hashes and reasons are retained for these rejections; no prompt or media is shipped.
The source categories follow the manifest except Cartoon Hero Swap, corrected from ANIME to CARTOONS after inspection. The existing Kling I2V route, price and ten-second recipe duration apply; source input totals and numbered tokens select existing starting-image guidance without changing reference support.

| Content category | Public exact templates |
| --- | ---: |
| YOUR PHOTO | 13 |
| CINEMATIC | 142 |
| ANIME | 13 |
| CARTOONS | 22 |
| MOVIES | 33 |
| FANTASY | 109 |
| REALISTIC | 94 |
| FASHION | 121 |
| PRODUCTS | 52 |
| VFX | 120 |
| UGC | 36 |
| ADS | 16 |

KIDS BIRTHDAY is explicitly excluded pending an owner decision: its twelve promptless rows remain retained and hidden, zero are public, and the category is absent from the gallery filter. It remains in CATEGORY_ORDER.
The [category-fill audit](source-audit/higgsfield-category-fill-30-2026-11-05.json) and fixed-list regression tests lock this state.
<!-- END CATEGORY MINIMUM COUNTS -->

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
