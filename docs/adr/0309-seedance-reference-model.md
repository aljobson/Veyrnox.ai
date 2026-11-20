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

## Amendment 2 (2026-11-14): real-person photos must work; templates leave the reference model

**Finding.** The phone's template flow (a person uploads their own photo, 10 s, 170 credits) ended with "This model can't
use pictures that show a real person". Template users upload real photos by design, so every such run was refused and refunded.
Two things pinned templates to the reference model: the `SEEDANCE_REFERENCE_ACTIVE` mapping (69 Seedance-origin templates) and
`BINDING_MODEL` in `lib/templateBinding.js` (every `@ImageN` recipe, 171 contracts).

**Decision.**

1. `SEEDANCE_REFERENCE_ACTIVE` is `false`: Seedance-origin templates run on `Kling 3.0 · I2V` (32 credits for 5 s unit, accepts people).
2. A single-photo `@Image1` recipe is a `bound` contract on `kling-3.0-i2v` (`PEOPLE_BINDING_MODEL`): same exact-token rewrite, the
   photo goes in as the Kling start frame. 73 contracts remain `bound`; those whose duration or framing Kling cannot take
   (`unsupported-duration`, `unsupported-aspect`) take the legacy route.
3. A recipe that needs several pictures has no people-safe model (no registered video model takes several image references and accepts
   real people), so it is `unsupported` with reason `multi-photo-needs-people-model` (96): normal admission on the template's own model, one
   photo, literal tokens, as before activation. The multi-slot web and phone controls stay in the code, dormant.
4. The reference model stays active and selectable on Create with the real-person note and the one-tap Kling switch (amendment 1).
   Revisit only if a provider accepts real-person references.

Contracts regenerated with `node scripts/audit-template-fidelity.mjs --write`. Totals: safe 232, bound 73, blocked-needs-video 392,
unsupported 98.

## Amendment 3 (2026-11-20): long one-photo recipes bind to kie Seedance 2, dark until switched on

**Finding.** PR 2518 capped Kling 3.0 image-to-video at fal's published 2,500 prompt characters, so 49 one-photo recipes whose exact
bound text is longer became `unsupported` (`prompt-limit`) and 45 left the gallery. Templates are exact-prompt-only (ADR-0325): the
text is never trimmed or summarised. No active model took a real-person photo with a longer prompt (Kling 3.0 at every supplier is
2,500; the fal reference model refuses real people, amendment 1; Veo 3.1 is gated and fixed at 8 s).

**Evidence (owner's paid probes, PROD kie key, 2026-11-20).** kie `bytedance/seedance-2`, prompt 3–20,000 characters
(docs.kie.ai/market/bytedance/seedance-2):
- Probe 1, `ghost-makeover` (8,734 characters), photo as `first_frame_url`: success, 410 kie credits, but 960x960 (the square photo's
  shape, not the 9:16 asked for) and the photo itself as the first frame.
- Probe 2, `jellyfish-airlines` (5,814 characters), first frame: refused, failCode 500 "may be related to copyright restrictions",
  creditsConsumed 0.
- Probe 3, `ghost-makeover`, photo as `reference_image_urls[0]` (the ADR-0333 shape), 9:16, 10 s, 720p, audio: success after 272 s,
  410 kie credits, 720x1280, 10.04 s, audio stream, task e19731441b78840a5df9fe08f8325708. Frames read: the clip opens on the
  generated scene, the photo's face is recognisable, the template's beats are followed. The bound `@Image1` tokens were sent unchanged.

**Decision.**
1. A new offer, `seedance-2.0-photo-kie` (migration 0573): kie `market:bytedance/seedance-2`, the photo as its one reference picture
   (capability record of ADR-0333, `reference_image_urls`, max 1), 720p, generated audio, 5 or 10 s. It is not the template-clip row
   `seedance-2.0-reference-kie` (0454), which stays inactive and priced with a reference video.
2. Price from the catalog floor: kie 41 credits a second at 720p, $0.205 a second, $1.0250 per 5 s unit; credits_5s =
   ceil(1.0250 / 0.01796) = 58, so 5 s is 58 and 10 s is 116 (Kling 3.0 was 32 and 64). The app never computes it.
3. Binding (`lib/templateLongPromptTarget.js`, used by `scripts/audit-template-fidelity.mjs`): a one-photo recipe whose exact bound
   text is over `KLING_V3_PROMPT_MAX` and at most 20,000 characters binds to this offer; everything else keeps Kling 3.0. The Kling cap
   is unchanged. Result: 49 contracts move from `unsupported` to `bound` (47 of PR 2518's 61, plus `dreamworks-castle` and
   `sheep-kingdom`, which Kling also refused for aspect). `impact` (28,970) and `cake-in-the-fridge` (21,772) stay `prompt-limit`.
   The 12 no-photo Kling recipes PR 2518 also hid stay unsupported: they route by their own model, and moving them would change the
   route of every like-for-like template.
4. Dark until the owner says so. The runtime key `seedanceLongTemplates` in `APP_RUNTIME_FLAGS` (absent = off,
   `lib/seedanceLongTemplates.js`): while off, GET /api/catalog does not list the offer, POST /api/v1/generations answers
   `model_not_found` before any debit, and the 42 gallery templates (`LONG_PROMPT_GALLERY_TEMPLATE_IDS`) stay out of the gallery,
   search, /api/templates and /api/presets. Turning it on needs the owner-approved apply of 0573 and then the key.
5. Gallery: 42 come back while on (the 45 hidden by PR 2518 minus `impact`, `cake-in-the-fridge` and `jellyfish-airlines`, which kie's
   copyright filter refused in probe 2; it stays runnable by link). MOVIES returns to the filter.
6. A kie refusal (copyright filter, or any `fail`) fails the job and the existing refund path returns the whole debit once; kie
   charged nothing for the refused probe. Callbacks stay HMAC-verified and the outcome is read back from kie's recordInfo
   (ADR-0020); no unsigned callback is trusted.

**Not established.** One template proven on kie (one sample); others may be refused by kie's copyright filter or follow their prompt
less well. kie labels its Seedance 2 price beta. Real-person acceptance rests on one photo. While the key is off, a direct link to one
of the 49 now asks for the photo and is refused before any charge, where it used to fall back to the template's own model.
