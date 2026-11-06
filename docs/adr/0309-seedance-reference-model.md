# ADR-0309: Seedance reference model for Seedance-origin templates

Status: accepted (2026-10-31); switched on by the owner the same day (0417, `SEEDANCE_REFERENCE_ACTIVE`, `MULTI_REFERENCE_ENABLED` in production vars) without a billed price proof
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

## Amendment 1 (2026-11-06): a refused real-person picture is named, not "model error"

**Finding.** A production job on this model from the `rap-takeover` template ended `REFUNDED` with
`error_code = provider_error`. fal's webhook showed HTTP 422, one detail at `loc: [body, image_urls, 0]`,
`type: content_policy_violation`, `ctx.extra_info.reason: partner_validation_failed`: ByteDance's partner check
refuses reference pictures that show a real person. The refund was right; the message ("The model returned an
error") and the missing warning were not.

**Decision.**

1. `lib/falFailureCode.js` maps that shape (a `content_policy_violation` type or a `partner_validation_failed`
   reason on an `image_url(s)` location) to the typed code `reference_rejected_likeness`. A policy violation on the
   prompt keeps its old code. Only our code is stored on the job and sent to clients: the vendor's message, location
   and context stay out of `jobs`, responses and the client. No migration: `jobs.error_code` has no CHECK or enum
   (the public shape `^[a-z0-9_]{1,64}$` is enforced by `publicErrorCode`).
2. The money path is unchanged: `job_failed` (one-shot) then `ledger_refund` with `refund:provider_failed`, idempotent per job,
   reached from the job row on a redelivery (`tests/falFailureCode.test.mjs`).
3. User-visible copy (all 11 site catalogues, shared with the app): the failed job says "This model can't use
   pictures that show a real person. Credits refunded. Try an illustration or a character that isn't a real person,
   or run the template on a model that accepts people." It keeps the standard "Credits refunded" fragment so the
   existing rule holds: until `/jobs/:id` reports `refunded: true` the fragment reads "Your credits are on their way back".
4. A one-tap "Run on Kling 3.0 instead" on that failed job reopens the request on `kling-3.0-i2v` (the frame model the
   templates used before). Web keeps the prompt and the template on screen; sources reset on a model change, so the
   start picture is added again. The app reopens the saved request (prompt, settings, Library pictures) on that model.
5. Create shows one note near the reference pictures while this model is selected: "This model can't use photos of
   real people." It never blocks the submit; the provider decides.

**Open product question (not decided here).** Should templates that expect a photo of the person map to this model
at all (`takesReferenceModel`)? Mapping gives up to nine references and a better fit for Seedance-made templates, but
every self-portrait upload can be refused (credits refunded, a wasted wait). Reverting is the single constant
`SEEDANCE_REFERENCE_ACTIVE` (with the catalog row left or set inactive); it was not changed.
