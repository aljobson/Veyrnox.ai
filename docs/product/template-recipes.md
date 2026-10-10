# Video template recipes

On 10 October 2026 the owner requested usable recipes for the imported previews,
including prompts and inputs, rather than unrelated footage in preset cards.
The source template workflows were inspected with Agent Reach and the REA skill.

`sourceTemplates.js` associates each of the 37 imported clips with its own title,
clip key, Veyrnox remix prompt, supported video model, duration, upload guidance
and original recipe. The gallery exposes 22 recipes; the homepage wall exposes
seven different recipes. These 29 visible template placements retain distinct
footage. The remaining source records describe the feature/model inspiration
clips. A detail page intentionally reuses the preview of the card it describes.

The original 22 hand-authored recipes remain in `LEGACY_PRESETS` so saved URLs
retain their original prompts. They no longer display unrelated imported video.
`ALL_TEMPLATES` drives static routes, lookup, middleware recognition and template
start attribution. Homepage template links now open the matching recipe page.

## Source evidence

SYNTX's shipped TrendsCard and public read-only trends API expose the exact
prompt, `generation_settings`, image/video reference roles and unlocked reference
assets. Each of our 11 SYNTX clips matched an API preview variant. The published
prompt is preserved verbatim with its SHA-256, source model/settings and reference
links. Six recipes use a supplied motion video; Train supplies an environment
image. These source references are distinct from the five-second muted previews.
The Last Stagecoach uses source Seedance 2.0 Pro; the other ten use source
Seedance 2.5. Train's prompt says NO AUDIO while its settings enable audio; the
verbatim source record preserves both without resolving that inconsistency.

Higgsfield's public effect pages expose effect UUIDs, descriptions, required and
optional image inputs, defaults and the effect workflow URL. Inspection of 26 use
pages, 26 example pages and 238 example jobs found no nonempty internal prompt
or model. The optional customization fields begin blank. We preserve the effect
setup and explicitly mark the internal prompt as not public. The local prompt
is an authored Veyrnox adaptation, not an extracted Higgsfield system prompt.
Lidar's public description incorrectly repeats Incline; its adaptation follows
the verified cyan point-cloud flower-field footage instead.

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
story scenes. The original setup is expandable and copyable separately.
No source reference or preview is silently used as the customer's upload.

The detail page shows the full uncropped local preview, editable remix prompt,
copy action, upload guidance, steps, live cost and duration. The studio link
restores the recipe from its ID even without session storage; stored edits can
override only their matching recipe. Prompt, duration and supported negative
prompt carry through; unsupported aspect controls are hidden. Ten-second recipes
quote twice the live five-second catalog price and open with that duration.

Verification includes source prompt hashes, one-to-one clip/title mapping,
model/type and input bounds, legacy URLs, global video uniqueness, direct-link
draft restoration and live-price multiplication. Browser checks confirmed the
matching playable preview, the copy action's success status, published source
references and navigation to the correct model/preset sign-in gate. The in-app
browser clipboard reader returned an empty string, so clipboard contents and
the authenticated studio were not independently verified in this session.
Actual model output can vary; the UI describes this as creating similar content.
