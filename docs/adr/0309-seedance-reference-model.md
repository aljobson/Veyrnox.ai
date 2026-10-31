# ADR-0309: Seedance reference model for Seedance-origin templates

Status: proposed (2026-10-31)
Relates: ADR-0256 (supplier routes), ADR-0301 (Kling O1 reference), multi-reference contract (`lib/multiReference.mjs`).

## Context

Templates whose source recipe was made with Seedance (`sourceModel` "Seedance 2.0/2.5" in
`seedanceTemplateMetadata.js`, for example Shadow Warriors) run on `Kling 3.0 · I2V`, which has only a
Start frame and an End frame. The source recipes take several reference pictures. No registered video
model takes image references.

## Decision

1. **Model record** `bytedance/seedance-2.0/reference-to-video` (fal), catalog id `seedance-2.0-reference`:
   one `image` slot, `image_urls`, `list: true`, `max: 9`, no frame slots. Provider contract read from fal on
   2026-10-31: `image_urls` up to 9, `video_urls` up to 3, `audio_urls` up to 3, 12 files in all, at least one
   picture or video. Only pictures are admitted now; the owner's "about 10" is 9 pictures at the provider.
   Video and audio references need duration/size checks and are a follow-up.
2. **Other providers.** Crun, kie and FEI are not given records: their Seedance reference limits and prices
   could not be verified (Crun's model JSON returned 404; kie's docs were not found; third-party listings
   disagree, one says 1–2 pictures). A provider is added by registering a record and a catalog row with its own
   `provider_endpoint`; a record may declare `max` above 1 only with `verifiedAt`, `verification` and
   `priceVerification` (`verifiedReferenceLimit`). Template mapping is by catalog model id, not provider.
3. **Limits.** `MAX_SLOT_FILES = 9` is the ceiling for a verified slot (`hardMaxFiles`, `publicSlotMax`, the
   public catalog, the web and mobile attach planners); `MAX_REFERENCES` is 12 (the fal combined cap). Every
   other model keeps 3 a kind: the attach planners use `max(3, largest verified slot)` per kind. MCP and the
   developer API still cap at 3 per slot (unchanged surface).
4. **Price.** $0.3024/s at 720p without video input = $1.512 per 5 s; floor `ceil(1.512/0.01796)` = 85 credits,
   170 for 10 s (Kling frame model: 32). Migration `0416` stages the row inactive. The catalog stays normative.
5. **Template mapping** is behind `SEEDANCE_REFERENCE_ACTIVE` in `seedanceReference.js` (false). While the row
   is inactive, mapping templates to it would mark every one unavailable, so they stay on Kling. Activation is
   one change: a migration setting `active = true` after a billed staging run proves price and refunds, and
   the constant set to true. The web and phone Create pages then show "Reference pictures" (up to 9) instead
   of the frame cards, because both read the catalog's `media` slots.
6. `MULTI_REFERENCE_ENABLED` must be `"true"` for more than one file per slot; it is not set in
   `wrangler.jsonc` today. Flipping it is the owner's call.

## Consequences

Not done here: prompts still say "Animate the uploaded starting image"; at activation they should be
rewritten to name `@Image1…`. The 85-credit price is 2.7× the Kling frame model: confirm before activating.
