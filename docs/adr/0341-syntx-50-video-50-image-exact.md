# ADR-0341 — 46 Syntx video and 50 Syntx image templates

Status: owner-approved 2026-11-13. No flag: IMAGE_TEMPLATES_ENABLED is already "true" in production, so the image rows are public on merge.

## Decision

Publish 96 exact prompts from the Syntx Trends capture of 2026-11-13: 46 videos and 50 images, following ADR-0325 amendment 2 and ADR-0337 with its amendments. Four previously refused video records are excluded without refill. Source titles, model ids, settings, minimum-file counts and exact prompt bytes remain provenance in [the audit](../product/source-audit/syntx-100-exact-2026-11-13.json).

By owner decision the previews use the exact gallery media. Every shipped preview is a host re-encode: images converted to WebP with the longest side capped at 1080 px, posters converted to JPEG, and videos re-encoded to H.264 at a lower bitrate. There are no crops, trims, overlays or replacement artwork. Video previews start at 0 seconds and are silent like the rest of the gallery, with exactly one video stream and no audio or data/timecode track. The builder performed no encoding. The 142 prepared files total 65,619,847 bytes.

Manifest SHA-256: `30ffbe337444154e657c0b87b6bb09155ac33054757b35881b82855f28f4dc29`. Encode-report SHA-256: `caa71828da3f718968fe7af71ce3f526500b4a5abf4b45fd58afa6948dac997f`. Original media and encoded hashes are verified before copying.

## Dedupe and inventory

The host capture examined 441 feed items and excluded 200 existing record ids, 8 media matches, 2 prompt matches, 3 in-feed repetitions and 8 near-copies (difflib >= 0.85). These capture-stage counts come from the host's capture; committed checks do not reproduce that selection process. Eleven branding drops were replaced before the capture was frozen; the four later refusals receive no refill.

Committed checks compare source record ids, source media ids and whitespace/case-normalized prompt hashes against all provenance modules and within the batch. Record-id and media-id keys only detect matches where older records carry the same field and media variant: most older records lack source record ids, and older media ids use mixed variants. The normalized-prompt key is the backstop. Publication preserves the original prompt bytes, independently hash-pinned in the fixture.

The captured registry contains 772 + 46 = 818 video prompts and 2 + 50 = 52 image prompts, totaling 870. There are 841 + 46 = 887 retained video candidates, 749 + 46 = 795 public video templates and 1,791 + 46 = 1,837 addressable video recipes. All 931 + 46 = 977 visual placements are distinct. All 46 new video signatures use the existing ffprobe checksum path.

## Models, aspects and image categories

Thirty-seven images require one photo, using `nano-banana-pro-edit-grsai`; thirteen text-only images use `nano-banana-kie`. Prices come from the catalog. `sourceMinFiles` stays as provenance; `the-glass` and `a-clear-bottle` additionally require a photo because their prompts explicitly demand the supplied product/photo. No image requires more than one photo.

The aspect must pass both model capabilities and the gateway allowlist. Every image template keeps its source aspect. Seven photo templates with source 2:3 (`moody-filter`, `particle-filter`, `red-light-filter`, `2000s-filter`, `viral-doodle`, `retro-game-loading-portrait` and `silhouette`) first shipped with 3:4, because the gateway allowlist then refused 2:3; the allowlist now accepts every shape a model declares (`lib/generationAspectRatios.js`), so they use 2:3. No price is changed.

| Public id | Source model | Runtime model | Source / runtime aspect | Photo | Category |
| --- | --- | --- | --- | --- | --- |
| moody-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | YOUR PHOTO |
| particle-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | VFX |
| red-light-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | YOUR PHOTO |
| 2000s-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | YOUR PHOTO |
| ccd-night-shot-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| dark-aesthetic-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| cinematic-filter | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| handheld-blur-effect | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| triptych-shooting | banana3 | nano-banana-pro-edit-grsai | 9:16 / 9:16 | 1 required | YOUR PHOTO |
| bubble-head | gpt-image-2.5-sunburst | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | CARTOONS |
| kissed-in-silence | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| midnight-fuel-stop | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| black-horsepower | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| face-the-dark | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| upside-down-habit | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| stylized-caricature | gpt-image-2.5-sunburst | nano-banana-pro-edit-grsai | 4:5 / 4:5 | 1 required | CARTOONS |
| life-simulation-portrait | gpt-image-2 | nano-banana-pro-edit-grsai | 4:5 / 4:5 | 1 required | CARTOONS |
| ugly-and-funny-doodle-2 | gpt-image-2 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | CARTOONS |
| viral-doodle | gpt-image-2 | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | CARTOONS |
| neon-city-game-portrait | banana3 | nano-banana-pro-edit-grsai | 9:16 / 9:16 | 1 required | CARTOONS |
| bold-type-product | gpt-image-2 | nano-banana-pro-edit-grsai | 9:16 / 9:16 | 1 required | PRODUCTS |
| toy-brick-portrait | gpt-image-2 | nano-banana-pro-edit-grsai | 4:5 / 4:5 | 1 required | CARTOONS |
| retro-game-loading-portrait | banana3 | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | CARTOONS |
| shadow-beard-portrait | gpt-image-2 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| cinematic-portrait | banana3 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| hotel-corridor | banana2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| pool-toys | banana2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| climbing | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| stained-glass-window | seedream-5.0-pro | nano-banana-kie | 16:9 / 16:9 | none | REALISTIC |
| ripple-light-portrait | gpt-image-2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| sunflower-field | seedream-5.0-pro | nano-banana-kie | 16:9 / 16:9 | none | REALISTIC |
| massive-ocean-wave | gpt-image-2 | nano-banana-kie | 16:9 / 16:9 | none | REALISTIC |
| towering-cliffs | banana2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| swim-rings | banana2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| giant-footballs | banana2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| enormous-basketballs | banana2 | nano-banana-kie | 3:4 / 3:4 | none | REALISTIC |
| borscht | banana2 | nano-banana-kie | 16:9 / 16:9 | none | REALISTIC |
| huge-model | banana2 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| bottle-of-red-wine | banana2 | nano-banana-kie | 16:9 / 16:9 | none | REALISTIC |
| melting-deforming | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| a-wet-transparent-glass | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| composition-of-yuzu | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| floral-perfume-campaign | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| the-glass | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| silhouette | seedream-5.0-pro | nano-banana-pro-edit-grsai | 2:3 / 2:3 | 1 required | PRODUCTS |
| stretch-effect | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| monochromatic | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| sneaker-campaign | banana3 | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | YOUR PHOTO |
| a-clear-bottle | seedream-5.0-pro | nano-banana-pro-edit-grsai | 3:4 / 3:4 | 1 required | PRODUCTS |
| pomegranate-jewel | banana3 | nano-banana-pro-edit-grsai | 9:16 / 9:16 | 1 required | PRODUCTS |

Reviewed image categories total YOUR PHOTO 17, CARTOONS 8, REALISTIC 13, PRODUCTS 11 and VFX 1. `sneaker-campaign` needs a person's photo and belongs to YOUR PHOTO; the text-only `bottle-of-red-wine` still life belongs to REALISTIC. These keys already have translations in all eleven locales.

Ten output defaults differ materially from preview shape. Each default is the recorded source setting; the preview is the source's own media, whose shape can differ from that setting:

| Public id | Source setting | Output default | Preview dimensions |
| --- | --- | --- | --- |
| cinematic-portrait | 3:4 | 3:4 | 603 × 1080 |
| climbing | 3:4 | 3:4 | 603 × 1080 |
| giant-footballs | 3:4 | 3:4 | 870 × 1080 |
| enormous-basketballs | 3:4 | 3:4 | 870 × 1080 |
| a-wet-transparent-glass | 3:4 | 3:4 | 725 × 1080 |
| composition-of-yuzu | 3:4 | 3:4 | 725 × 1080 |
| floral-perfume-campaign | 3:4 | 3:4 | 725 × 1080 |
| silhouette | 2:3 | 2:3 | 608 × 1080 |
| monochromatic | 3:4 | 3:4 | 870 × 1080 |
| a-clear-bottle | 3:4 | 3:4 | 608 × 1080 |

Ten previews differ in shape from their recorded source setting, which is kept: cinematic-portrait, climbing, a-clear-bottle and silhouette are approximately 9:16; a-wet-transparent-glass, composition-of-yuzu and floral-perfume-campaign approximately 2:3; giant-footballs, enormous-basketballs and monochromatic approximately 4:5.

The Crun image route trims edge whitespace: `sunflower-field` ends with a newline and is sent one character short on that route. Stored job inputs keep the exact prompt.

## Video categories and routing

Every video has a reviewed source-slug category entry. The source's own genre tag is kept (movies, cartoons, realistic); its non-genre tags (new, featuring-you, popular, christmas) are ignored, and a row with no genre tag is CINEMATIC, as in the precedent importer. Where the source's products tag contradicts the content, the next source tag is used. The one reviewed exception is FASHION for the outfit transition. Totals are MOVIES 6, CARTOONS 1, ANIME 0, FASHION 1, REALISTIC 23 and CINEMATIC 15.

| Source slug | Public id | Category | Source model display label |
| --- | --- | --- | --- |
| london-london | london-london | MOVIES | Wan 3.0 Omni |
| hand-frame-switch | hand-frame-switch | CINEMATIC | Wan 3.0 Omni |
| blow-and-throw | blow-and-throw | REALISTIC | Wan 3.0 Omni |
| light-and-blow | light-and-blow | CINEMATIC | Wan 3.0 Omni |
| cake-in-the-fridge | cake-in-the-fridge | CINEMATIC | Seedance 2.5 |
| one-breath-wish | one-breath-wish | CINEMATIC | Wan 3.0 Omni |
| flaming-candle-blowout | flaming-candle-blowout | REALISTIC | Wan 3.0 Omni |
| make-a-wish | make-a-wish | CINEMATIC | Seedance 2.5 |
| lil-tjan | stage-performer-recast | REALISTIC | Kling 4 Omni |
| ride-the-beat | ride-the-beat | REALISTIC | Kling 4 Omni |
| epic-arrival | epic-arrival | CINEMATIC | Seedance 2.5 |
| football-legends | football-duo-recast | REALISTIC | Wan 3.0 Omni |
| retro-groove | retro-groove | CINEMATIC | Kling 4 Omni |
| kick-and-run | kick-and-run | CINEMATIC | Seedance 2.5 |
| surprise-knockout-kick | surprise-knockout-kick | REALISTIC | Seedance 2.5 |
| fans-go-wild | fans-go-wild | REALISTIC | Seedance 2.5 |
| outfit-transition-gone-crazy | outfit-transition-gone-crazy | FASHION | Wan 3.0 Omni |
| carousel | carousel | CINEMATIC | Wan 3.0 Omni |
| wish-a-merry-christmas | wish-a-merry-christmas | CINEMATIC | Kling 4 Omni |
| desert-chase | desert-chase | REALISTIC | Seedance 2.5 |
| reality-in-wonderland | storybook-reality-recast | CARTOONS | Seedance 2.5 |
| street-phantom | street-phantom | REALISTIC | Seedance 2.5 |
| on-the-winter-roof | on-the-winter-roof | REALISTIC | Seedance 2.5 |
| new-year-on-the-nose | new-year-on-the-nose | REALISTIC | Wan 3.0 Omni |
| rig-it-right-for-gta | game-character-rig | CINEMATIC | Seedance 2.5 |
| bad-santa-run | holiday-heist-run | REALISTIC | Seedance 2.5 |
| home-alone-again | holiday-home-recast | MOVIES | Wan 3.0 Omni |
| the-winning-gift | the-winning-gift | REALISTIC | Seedance 2.5 |
| dance-in-the-snow | dance-in-the-snow | REALISTIC | Wan 3.0 Omni |
| the-bigger-gift | the-bigger-gift | CINEMATIC | Seedance 2.5 |
| one-more-dance | one-more-dance | CINEMATIC | Seedance 2.5 |
| snowball-revenge | snowball-revenge | CINEMATIC | Seedance 2.5 |
| drift-therapy | drift-therapy | REALISTIC | Seedance 2.5 |
| dj-performance | dj-performance | REALISTIC | Seedance 2.5 |
| 500-days-of-summer | summer-romance-recast | MOVIES | Kling 4 Omni |
| athlete-flex | athlete-flex | REALISTIC | Seedance 2.5 |
| 3-friends | 3-friends | MOVIES | Seedance 2.5 |
| helicopter-jump-2 | helicopter-jump-two | REALISTIC | Seedance 2.5 |
| landing | landing | REALISTIC | Seedance 2.5 |
| fridge-down | fridge-down | REALISTIC | Wan 3.0 Reference |
| hyenas-run | hyenas-run | REALISTIC | Seedance 2.5 |
| burn-it-to-ashes | burn-it-to-ashes | REALISTIC | Seedance 2.5 |
| taxi-chase | taxi-chase | MOVIES | Seedance 2.5 |
| helicopter-jump | helicopter-jump | REALISTIC | Seedance 2.5 |
| rope-swing | rope-swing | CINEMATIC | Wan 3.0 Reference |
| rumpelstiltskin | fairytale-villain-recast | MOVIES | Seedance 2.5 |

All 46 additions pass through the unchanged fidelity machinery: 0 like-for-like-safe, 9 bound and 37 blocked-needs-video, with no unsupported rows. Overall totals are 232 safe, 171 bound and 392 blocked. All 46 prompts contain image/video references. Video minimum-file counts (35 with two and five with three) remain provenance; binding is determined only by the existing classifier. Source model display labels are separate from raw model ids in records and audit data.

Copy-only input guidance is selected for reference tokens, preserved-audio vocabulary or prompts exceeding 30,000 characters, following the precedent importer. This rule changes no retained row's guidance. Runtime video framing follows preview dimensions without changing the media. Every video recipe runs at the gallery's 5-second default although the source clips are 7 to 30 seconds, so a prompt written as a longer timeline is sent unchanged and generated as a 5-second clip. Routes occupy 33,726 bytes, below the 60 KiB budget.

## Public names

Source titles and prompts remain exact provenance; public ids and names use neutral descriptions. The duplicate Black & White titles receive distinct names. Helicopter Jump Two spells out its number to avoid the secret-scanner false positive.

| Source slug | Public id | Public name |
| --- | --- | --- |
| helicopter-jump-2 | helicopter-jump-two | HELICOPTER JUMP TWO |
| rig-it-right-for-gta | game-character-rig | GAME CHARACTER RIG |
| home-alone-again | holiday-home-recast | HOLIDAY HOME RECAST |
| 500-days-of-summer | summer-romance-recast | SUMMER ROMANCE RECAST |
| gta-vi-style | neon-city-game-portrait | NEON CITY GAME PORTRAIT |
| sims-style | life-simulation-portrait | LIFE SIMULATION PORTRAIT |
| lego-style | toy-brick-portrait | TOY BRICK PORTRAIT |
| gta-sa-style | retro-game-loading-portrait | RETRO GAME LOADING PORTRAIT |
| football-legends | football-duo-recast | FOOTBALL DUO RECAST |
| lil-tjan | stage-performer-recast | STAGE PERFORMER RECAST |
| rumpelstiltskin | fairytale-villain-recast | FAIRYTALE VILLAIN RECAST |
| iphone-blurry-effect | handheld-blur-effect | HANDHELD BLUR EFFECT |
| bad-santa-run | holiday-heist-run | HOLIDAY HEIST RUN |
| reality-in-wonderland | storybook-reality-recast | STORYBOOK REALITY RECAST |
| black-white-2 | shadow-beard-portrait | SHADOW BEARD PORTRAIT |
| black-white | ripple-light-portrait | RIPPLE LIGHT PORTRAIT |

## Rejections and content review

A committed source-record denylist prevents the four inspection refusals and earlier `the-push-2` and `dark-couture` refusals from returning. The four inspection entries are retained in the audit's `rejected` list:

| Source slug | Reason |
| --- | --- |
| wing-backflip | rejected by earlier host screening recorded in ADR-0325 (staged real-event realism) |
| bed-trap | rejected by earlier host screening recorded in ADR-0325 (sexualised body focus) |
| the-mouse-king | rejected by earlier host screening recorded in ADR-0325 (requires a storyboard sheet no slot can supply) |
| classroom | refused by the 64-batch content screen (minors term); depicts schoolchildren; not re-approved by the owner |

The importer applies the precedent BLOCK and REAL expressions to prompt plus source title. Every content match requires a reviewed per-row decision; any other match fails. REAL has no matches. The only allowed BLOCK matches are:

| Source slug | Matched term | Reviewed reason |
| --- | --- | --- |
| retro-groove | minor | minor character reference; a secondary character |
| bad-santa-run | children | children's letters and drawings as props |
| ugly-and-funny-doodle-2 | child | similar to a child's crayon drawing; a style description |

No retained prompt contains Syntx or needs platform-word stripping. Any material platform-word rewrite is rejected without substitution. Shared hygiene and ending inventories cover all six captures. This batch has two source-reference gaps and sixteen ambiguous unpunctuated endings, retained as informational findings under the exact-source policy.

The host excluded eleven branding rows before freezing the selected capture:

| Source slug | Reason |
| --- | --- |
| vice-city-popart-1 | syntx-logo |
| vice-city-popart-2 | syntx-logo |
| monumental-type-silhouette | syntx-name |
| vacuum-sealed-display | syntx-logo |
| frozen-product-burial | syntx-logo |
| monochrome-luxury-typography | syntx-name |
| desert-branch-editorial | syntx-logo |
| framed-poster | syntx-name-in-image-and-prompt |
| on-a-swimming-pool | syntx-logo |
| snow-logo-imprints | syntx-logo |
| football-goal | syntx-logo |

## Host preview review

The host reviewed every image preview and frames at 0%, 50% and 90% of every video before the build. The review notes are held by the owner outside the repository.

## Rendering and Worker size

Preview artwork renders independently of photo requirements. A container query shows the full requirement note at widths of 20rem and above; smaller cards show the translated “Needs your photo” chip. Image failures retain the gradient. The two Christmas paths and their missing-file fallback behavior are unchanged.

Middleware reads a small generated public-id list instead of importing the template library and its prompt records. Legacy-id resolution and request-time image publication gating remain equivalent. The Worker budget is unchanged; the import-graph test limits middleware's reachable source to 400,000 bytes and excludes template/record modules.

## Verification

The importer checks frozen capture hashes, exact prompts, source and prepared media hashes, byte budgets, single-video-stream previews, refusal/content decisions, supported aspects, reviewed categories, and deterministic output bytes. Tests pin prompt hashes, identity dedupe, photo handoff and gateway validity, file-to-template identity, silent single-track videos, unchanged visual signatures, routing totals, translated notes and real card/picker/detail rendering. Middleware tests pin generated-list freshness and equivalence with the complete registry for both image flag states.
