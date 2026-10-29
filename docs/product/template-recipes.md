# Video template recipes

On 10 October 2026 the owner requested usable recipes for the imported previews,
including prompts and inputs, rather than unrelated footage in preset cards.
The source template workflows were inspected with Agent Reach and the REA skill.

`sourceTemplates.js` retains 315 audited media-backed source recipes with their title,
clip key, Veyrnox remix prompt, supported video model, duration, upload guidance
and neutral inspiration marker. The public filter removes 44 records whose
matched prompt is unavailable and one whose matched prompt is truncated. The
gallery exposes the remaining 270 recipes and the
homepage wall features 24 of them. Every public template has a distinct local
video and poster. A detail page intentionally reuses the preview of the card it describes.
Source-platform names, record IDs and URLs are not included in public template
objects, browser payloads or media filenames. Exact prompts that creators made
public are the exception: they are exposed read-only as provenance, including
creator-supplied attribution or reference tokens that occur inside the prompt.

On 24 October 2026, 22 legacy recipes without videos were removed. `PRESETS`,
the browsable and API-exposed subset, now contains the 270 publishable video-backed recipes
and drives the gallery, categories, search and homepage. `ALL_TEMPLATES` contains
1,312 addressable recipes: those 270 video-backed recipes plus 1,036 direct-link
effect concepts and 6 reference recipes. It drives route lookup, middleware recognition and template
start attribution. Homepage template links open the matching recipe page.

## Source evidence

SYNTX's shipped TrendsCard and public read-only trends API expose the exact
prompt, `generation_settings`, image/video reference roles and unlocked reference
assets. The 29 October audit covers 98 Syntx-linked source records. Ninety-seven
public prompts are preserved verbatim with locked SHA-256 fixtures; Keyboard Duo
Swap was removed because its public trend record is no longer returned. Two
source-prompt duplicate groups are documented while all 98 local preview videos
remain byte-unique. Exact text loads as the selected template prompt; the shorter
compatible Veyrnox adaptation remains separate fallback metadata.
See [the Syntx prompt audit](syntx-template-prompt-audit-2026-10-29.md).

Higgsfield's public effect pages expose effect UUIDs, descriptions, required and
optional image inputs, defaults and the effect workflow URL. Inspection of 26 use
pages, 26 example pages and 238 example jobs found no nonempty internal prompt
or model. The optional customization fields begin blank. We preserve the effect
setup and explicitly mark the internal prompt as not public. The local prompt
is an authored Veyrnox adaptation, not an extracted Higgsfield system prompt.
Six further canonical effects were added from the public effects inventory on
14 October 2026; their public previews and workflow URLs are preserved without
claiming access to a private internal prompt.
Lidar's public description incorrectly repeats Incline; its adaptation follows
the verified cyan point-cloud flower-field footage instead.

On 29 October 2026 the prompt provenance audit covered all 100 Genjutsu
community previews, all 98 Syntx-linked templates and all 91 other
Higgsfield-sourced previews. The public
Genjutsu feed published an exact prompt for 57 records. One was already
truncated and was removed; the other 56 strings are preserved verbatim in the
public read-only `sourcePrompt` field with locked SHA-256
fixtures. The normalized 100-record feed capture has SHA-256
`c54a2734c2ae117b02727677abebe213d610e807b95dbbf48cb2dd3269d62103`.
Verbatim preservation includes creator attribution, reference tokens and empty
reference slots emitted by the public feed; Veyrnox does not guess missing
references or silently repair source text. The other 43 Genjutsu records expose
no exact public source prompt and are removed from all public template surfaces.
The older Higgsfield-sourced videos remain explicit `adaptation-only` recipes
and must not be presented as copied Higgsfield system prompts. The audit also corrected the High Flip, Earth
Zoom, Pigeons, Raven Transition and Motion Tracking adaptations to match the
published preview behavior and removed an internally contradictory text-label
instruction.

The public feed's `community-survivor-memory-shift` prompt ends mid-sentence at
`At`; the source record marks it `sourcePromptTruncated: true`. This is retained
only as non-public audit evidence, and the corresponding template is removed.

REA static Evidence IDs:

- SYNTX: `ev_db5f7c057ab6eff3673a90eaa9b74f6ba6e3576c29729123edeb84eda9f80019`.
- Higgsfield: `ev_06751a373bab1cc06fab03783d139376da57ecf5581624b6499861014f803c37`.

Public metadata extraction is directly observed. REA inspected inert shipped
JavaScript; it did not execute a paid generation or establish private workflow
behavior. External Higgsfield script assets returned 403; public serialized
effect data and rendered controls supplied the configuration evidence. The
SYNTX semantic graph had a 100,000-node coverage boundary. Full local evidence
is retained under `/tmp/veyrnox-{syntx,higgsfield}-rea-evidence.json` for this
investigation, with normalized recipe extracts alongside it.

## Veyrnox generation

The current Veyrnox gateway does not accept a source effect UUID, multiple named
image references or an arbitrary external motion-video URL. Our compatible
prompts therefore describe similar content using existing supported inputs:
Kling 3.0 I2V with one required starting image and a five-second unit, or
Seedance 2.0 Fast with an optional starting image and ten seconds for the longer
story scenes.
No source reference or preview is silently used as the customer's upload.

The detail page shows the full uncropped local preview, editable remix prompt,
copy action, upload guidance, steps, live cost and duration. The studio link
restores the recipe from its ID even without session storage; stored edits can
override only their matching recipe. Prompt, duration and supported negative
prompt carry through; unsupported aspect controls are hidden. Ten-second recipes
quote twice the live five-second catalog price and open with that duration.

Verification includes one-to-one clip/title mapping, model/type and input bounds,
removed media-less URLs, global video and poster uniqueness, source-platform-neutral public data, direct-link
draft restoration and live-price multiplication. Browser checks confirmed the
matching playable preview, the copy action's success status and navigation to
the correct model/preset sign-in gate. The in-app
browser clipboard reader returned an empty string, so clipboard contents and
the authenticated studio were not independently verified in this session.
Actual model output can vary; the UI describes this as creating similar content.

## Tested Frozen In Motion preview

On 10 October 2026 the owner signed in and requested a generation using the
published Frozen In Motion prompt unchanged. Veyrnox job
`5c5755b0-83d8-4459-96c2-2732277f2bf6` reached STORED through FAL's
`kling-3.0-i2v` at five seconds and 34 credits. The original synthetic starting
image already places the woman in a suspended leap. Review at the beginning,
middle and end shows a stable bent-knee pose with moving pedestrians and
camera motion; there is slight hair/clothing drift.

The owner then approved this generated video as the template preview.
The card and detail page label it as generated on Veyrnox, and input guidance
now specifies a person already suspended mid-leap. The runnable prompt,
negative prompt, model, duration and credit cost are unchanged. Internal
provenance remains documented separately. See [showcase provenance](showcase-clips.md)
for output hashes and encode details, and [ADR-0022](../adr/0022-manual-test-credit-grant.md)
for the approved one-time test grant. This verifies one example, not every
possible customer upload or repeated generation.
