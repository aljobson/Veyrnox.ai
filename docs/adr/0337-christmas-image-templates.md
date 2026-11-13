# ADR-0337 — Still-image templates, Christmas first

Status: owner-approved scope 2026-11-12; implementation prepared with publication off.

## Decision

Keep still-image recipes in `app/veyrnox/_lib/imageTemplates.js`, separate from
`SOURCE_TEMPLATES` and the exact-only video transformation. The owner expanded
the initial eleven text-only CHRISTMAS recipes to a target of fifty: forty-nine
authored originals and the captured Flying Elf prompt. No recipe needs a
reference photo. Flying Elf retains the feed's action scene verbatim.

The Flying Elf record is in `imageSourcePromptRecords.js`, captured from the
Syntx public feed on 2026-11-12, source ID
`01a011a9-b028-7328-8f39-4eca02bd4ec4`, source model `banana2`, aspect `16:9`.
Its UTF-8 prompt SHA-256 is
`8adc8eaedc6089dd5703d4a5a99b104c568436299b1d8388aa78c9a53e8c20ab`.
Tests pin the hash independently of the registry. No source artwork is copied.
The combined `SOURCE_PROMPT_RECORDS` is a provenance registry for both kinds;
its module-union test includes the image module. Import deduplication tolerates
missing media fields and still compares captured prompt hashes. Public-ID and
name collision checks reserve all image recipes, including gated originals.

`IMAGE_TEMPLATES_ENABLED` enables publication only when its value is exactly
`"true"`. Absence is off. The flag was installed in production `wrangler.jsonc` as `"true"` on
2026-11-13 on the owner's word (amendment 1). It replaced the redundant
`PUBLISH_CAROUSEL_ENABLED: "false"` var (absent is off), so the Worker stays at
its 67-var cap. Remove the line to turn image templates off. `allPublishedTemplates`, `galleryTemplates` and
`galleryCategories` read it on each call. Legacy `ALL_TEMPLATES`, `PRESETS` and
`PRESET_CATEGORIES` remain video-only exports for existing consumers and
corpus/fidelity generation. Web list/search/detail, sitemap, and the middleware
hard-404 check use the gated accessors. Detail `generateStaticParams` retains
only the original video catalog, in both gate states. Known image IDs cross an
explicit `connection()` request boundary before the gated lookup and 404; they
are never prebuilt. The gallery and detail page no longer declare page-level
`force-dynamic` overrides.

### Rendering constraint (inspection round 2)

True “built once” video HTML cannot be restored within this template change.
The root `app/layout.js` already forces dynamic rendering under ADR-0060,
including on the locally available `origin/main` at `f8abfd100` (rechecked in
inspection round 2); the renderer needs each request's CSP
nonce. The root also reads theme cookies, and `getT()` reads locale/path headers.
The installed Next CSP guide explicitly requires dynamic rendering for nonces.
A separate image route or route group would still inherit that root. Forcing a
static child or caching complete video HTML would not preserve fresh nonces and
request-specific locale/theme behavior. A hash-based CSP or separately isolated
root/origin would be a broader security/rendering migration, not this fix.

The proposed and implemented bounded deviation removes the redundant page
flags, preserves video static-parameter generation and bundled video data, and
makes only image lookup explicitly request-dependent. Actual video HTML remains
SSR under the pre-existing root policy: every HTML visit incurs Worker rendering
and has no shared HTML-cache reuse (`Cache-Control: private, no-store, max-age=0`).
There is no claimed static-rendering restoration or measured CPU/latency parity.
No nonce, locale or theme policy is weakened. Prices still load in the browser.

The sitemap already had `dynamic = 'force-dynamic'`; it remains request-time.
Video URL paths are computed once from bundled `PRESETS`, without catalog reads
or video page rendering. Image paths are appended from the current publication
flag on each invocation. Tests change the flag off/on/off in one process and
verify image URL changes and an identical video URL set. Existing model and
comparison sitemap catalog reads are unchanged. Public API cache lifetimes
still apply; a future activation or rollback must account for cached responses.

The `/api/templates` image-card shape is additive: `kind: 'image'`,
`previewImage`, `durationSeconds: null`, no `clipKey`, and `clip: null`.
Only a prompt excerpt is in a card. The full detail retains image kind and
model ID. `/api/presets` and `toPublicPresets` always exclude images, including
when passed a mixed list. Native mobile rendering is unchanged.

`presets.cat.CHRISTMAS` has an explicit short translation in all eleven public
locale catalogs. Mobile `webKeys.json` is a curated input to
`apps/mobile/scripts/sync-web-i18n.mjs`, not generated from the public catalogs;
it remains unchanged while mobile image rendering is deferred.

Image models resolve by an explicit allowed ID list (`nano-banana-kie`,
`nano-banana-pro-grsai`, `seedream-4`), bypassing video routing. Image recipes
have no fidelity contract, binding, clip, duration or stored price. The catalog
supplies prices and same-modality picker eligibility. Missing catalog prices
stay unknown. UseTemplate, Create arrival and picker handoff preserve prompt
and aspect, and omit duration even if an old draft or URL supplies one.

Image generation is not template-attributed: clients omit both ranking `preset`
and fidelity `template_id`; `templateStartIdFor` returns null for matching and
mismatched image models. `templateSelectionMatches` preserves image selection in
Create independently of ranking attribution. The nullable ranking-ID contract
remains non-throwing, including stale gate-off selections. An explicitly supplied
image `template_id` is rejected before video fidelity/admission with
`image_templates_disabled` when the gate is off, or `image_template_unattributed`
when it is on. Ordinary prompt-only image generation remains valid. Existing
accepted-job replay rules are unchanged.

Missing source media is not an identity. The public-ID migration, Higgsfield
audit, and both replacement importers use shared nonempty-string media guards;
`undefined === undefined` can no longer claim ownership. Public-ID reservations
use record keys, and exact-source auditing uses template IDs, never a media-ID
join. Thus Flying Elf safely remains in the shared provenance registries.
The prompt-limit total is verified as 772 video captures + 1 image capture = 773,
not merely bumped; its source hash and detail audit remain unchanged.

The shared detail recipe only adds community-source audit fields for
`promptOrigin: 'community-source-exact'`. Originals retain original provenance
and never get the uncaptured-community-source warning. Flying Elf uses its
captured-source audit.

Preview paths are reserved under `/showcase/christmas/`; the files deliberately
do not exist yet. The web image component removes a failed image and leaves
the record's gradient visible on cards, the picker and detail page.

## Content expansion (2026-11-12)

The owner increased the target to fifty Christmas recipes: one exact Flying Elf
capture and forty-nine originals. Additional authored rows live in
`imageTemplatesChristmasExpansion.js` so both registry source files stay below
500 lines. The supplied `extra-templates.md` SHA-256 is
`b8525d062117433db13fd563f8de690a5e1dd2f17830c85614b141283d20b0ce`.

Capability validation uses the same registry as the fallback and public catalog.
Seedream 4 exposes no aspect-ratio input and assumes a 2048×2048 output. Under
the owner's permitted model fallback, these seven additional recipes use
`nano-banana-kie` while retaining their supplied aspect ratios:
`snowy-village-dusk`, `vintage-xmas-postcard`, `sleigh-over-town`,
`papercut-christmas`, `watercolour-robin`, `elf-toy-workshop`, `flat-vector-card`.
The same newly verified limitation also affects four existing recipes:
`gingerbread-village`, `santas-workshop`, `winter-wonderland-landscape`, and
`reindeer-in-the-snow`; they now use `nano-banana-kie` with their existing 16:9
aspect. Flying Elf is unchanged. Tests now use real fallback capabilities,
rather than mocked aspect lists, for UseTemplate and Create acceptance.

On 2026-11-13 the host approved the Snowman Family prompt with “friendly
stylized 3D render style.” That exact approved row completes fifty recipes:
one captured Flying Elf and forty-nine originals. Count assertions remain 50.

The eleven model substitutions listed above are the complete list. They change
neither prompt text nor aspect. In particular the paper-cut diorama, watercolour
robin, flat vector card and vintage postcard retain their supplied style
instructions verbatim. Seedream is text-to-image capable, but no recipe or
capability contract requires it for those styles. Nano Banana remains the
allowed fallback that preserves the requested aspect. Visual style fidelity
will be assessed during deferred preview-art work; no generation was performed.

## Deferred

Preview-art generation and spend, mobile image rendering and flag activation require
separate work. No provider generation, deployment or publication is performed.

## Verification

The frozen proof is:

```sh
node --test tests/categoryFill.test.mjs tests/replacementTemplates.test.mjs tests/sourceTemplates.test.mjs tests/templateDraft.test.mjs tests/clientTemplates.test.mjs tests/routesOutsideGate.test.mjs tests/presetsRoute.test.mjs tests/useTemplate.test.mjs
```

Additional coverage: `imageTemplates`, `useTemplate`, `createTemplateArrival`,
`templatePicker`, `presetsRoute`, `trendsCategories`, and existing template
handoff/generation tests. Offline React fixtures execute the real components
with catalog and network I/O stubbed; they do not claim a browser or provider
acceptance run. Run heavier proof under `~/.local/bin/with-build-slot` on the
host.

Number allocation: checked the main-branch `docs/adr` directory and all five
open PRs (#2097, #2096, #2092, #2089, #1979) through the GitHub connector on
2026-11-12. Main's highest number was 0336; none of those PRs added an ADR.


## Photo-reference amendment (2026-11-13)

The registry remains exactly fifty: two exact community captures (Flying Elf
and Christmas Tree Ornament) and forty-eight originals. `pet-in-a-santa-hat`
is removed: its invented pet portrait overlaps the ornament's ability to use a
person's own pet, while the remaining originals retain wider scene variety.

Christmas Tree Ornament uses the exact UTF-8 prompt from Syntx record
`01a1cb5f-c1b3-7030-b572-c82fbba8b92c`, slug `christmas-tree-ornament`, captured
2026-11-13 from the public trends feed, published `2026-11-11T19:06:00Z`.
The source records banana / banana-2.1, 2K, 3:4. Its independent test hash is
`1082539cb0da501164497e48479807657804cd60042ed6902e00127ac4750129`.
No prompt rewriting, source artwork copying or preview generation occurs.
Shared provenance now contains 772 video captures + 2 image captures = 774;
nonempty source-media guards continue excluding both image records.

The declarative image-only `photo: { required: true, count: 1 }` requirement
uses UseTemplate's existing one-photo picker and in-memory same-tab handoff.
This photo recipe proceeds to Create; text-only templates retain inline
Generate. Create receives `sources.image`, requires exactly one usable photo,
and submits an ordinary image request with `references`, no duration, no
ranking `preset` and no fidelity `template_id`, including after prompt edits.
The template ID in the draft and handoff is only a UI key. Images also never
receive the video-specific character-preservation sentence.

The lightweight allowlist adds `nano-banana-pro-edit-grsai`. Its existing
`grsai:nano-banana-pro-edit` capability requires one image and accepts 3:4;
`nano-banana-pro-grsai` remains text-only. Price still comes from the catalog.
UseTemplate requires a live compatible model; the Create picker omits the
ornament when its model is absent or cannot accept a photo. Arrival never
silently substitutes a fallback model. A missing photo, expired/lost handoff,
removed photo or missing capability blocks Generate and explains the problem.
All eleven locales include the photo-required message. Gallery, picker and
detail artwork show that note instead of any preview image for this recipe.

Existing gateway tests prove admission, source ownership, provider payload and
polling using simulated I/O; an added explicit-reference test preserves the
ornament prompt and 3:4 aspect through the real gateway. Server, ledger, jobs,
webhooks, migrations, routes and Worker variables are unchanged. The publication
gate remains exactly `"true"`, absent/off by default. `/api/presets` still skips
image records before video routing; the sitemap and hard 404 behavior remain.

Validation limitations and bounded deviations: live `/api/catalog` verification
was attempted but shell DNS and the web-fetch tool could not reach it. No live
availability or provider generation is claimed; runtime capability checks fail
closed. The pre-existing Create page and public locale catalogs exceed the
500-line rule; this amendment makes narrow edits without an unrelated split.
New helper files remain below 500 lines. No commit, push, publish, new native
build environment or additional preview server is part of this work.
