# Face Filters — phone specification

**Status:** Planned until the build PR merges. Checked 2026-10-20 against local
`origin/main` at `4ccfbd2a1d4b39c8e20db9a0c5269ddab8f908bd`; the feature sources
are identical in this checkout (`cf1573bf`). Catalog activation is **merged;
production application not verified from the repo**. No production read or
phone-device validation was performed for this document.

**Reads with:** [web feature PRD](../../face-filters/PRD.md),
[technical decisions](../../face-filters/TRD.md), [mobile app flow](APP-FLOW.md).

## 1. Purpose and current boundary

Let a person apply a named filter to their own photo, see the credit price
before submission, compare the immediate output with a temporary local original,
and find the finished output in Library. Use the existing catalog, upload,
generation, polling and asset APIs, with one debit and one submit path.

On the web, filters are models in the Studio with the per-slot `SourcePickers`
upload field. **A Transform mode does not exist.** The web Tools directory
(`app/veyrnox/_lib/tools.js`) and phone Tools directory
(`apps/mobile/src/lib/toolDirectory.ts`) already define the Face filters group;
the live catalog determines which entries actually appear. These entries do not
prove that the dedicated phone selectors, per-photo rights confirmation or
comparison view have shipped. The existing generic phone create form and
`apps/mobile/src/lib/media.ts` provide reusable submission and polling.

## 2. Filters and state

All state and price claims in this section are dated 2026-10-20 at `4ccfbd2a`.
Sources: `packages/db/schema/supabase/0356_face_filters_staged.sql`,
`packages/db/schema/supabase/0357_activate_face_filters.sql` and
`lib/additionalModelCapabilities.js`.

| Feature | Catalog id | Migration state | Credits per output | Phone selectors |
|---|---|---|---|---|
| A1 Skin retouch | `face-retouch` | Active in 0357 | 3 | None required; optional `seed` |
| A2 Face enhancement | `face-enhance` | Active in 0357 | 3 | None required; optional `seed` |
| A3 Relight (image) | `face-relight` | Staged, inactive | 7, provisional | Out of scope until active; requires `prompt`, optional `seed` |
| A4 Digital makeup | `face-makeup` | Active in 0357 | 3 | `makeup_style`, `intensity` |
| A5 Age modify | `face-age` | Active in 0357 | 3 | `target_age` |
| A6 Relight (video) | No row | Not staged | Not offered | None |
| A7 Identity reference | No row | Blocked by web PRD §6 | Not offered | None |
| A8 Face swap | No row | Blocked by web PRD §6 | Not offered | None |

0357 records one output and a $0.04 bill for each activated endpoint on
2026-10-20. A3's probe billed 2 MP ($0.20), double the $0.1000 recorded cost;
that probe did not use the fixed 1000×1000 canvas. A pinned-payload run is still
required before activation/repricing. No fresh provider run is claimed here.
A6 has no real clip evidence. A successful manual apply-migrations dispatch,
as reported in the work order, does not verify production rows. Always read the
current catalog and its price; never hard-code the 3-credit snapshot in the UI.

## 3. Planned phone flow

1. Pick a photo from the device. Keep an app-owned temporary copy for the current
   workflow; do not alter or delete the user's Photos original. Accept JPEG,
   PNG or WebP up to 20 MiB (20 × 1024 × 1024 bytes). HEIC must be converted to
   a supported type before uploading, or refused with a clear explanation;
   do not relabel its MIME type.
2. Upload through `POST /api/v1/uploads`, then PUT the bytes to its returned
   URL with the returned content type and any returned headers. Keep `key`
   as the generation's `source_key`. Show progress and cancellation; cancellation
   before submit does not debit credits. An upload is free but requires a
   positive credit balance and passes the server's limits and admission gate.
3. Choose an available filter and its declared selectors. Show the final credit
   quote before the spend action; require Top up when balance is insufficient.
4. Obtain explicit rights/likeness attestation for this photo using the statement
   in §4; also preserve the app's separate AI-provider-sharing consent gate.
   Do not infer per-photo rights from a previously accepted general AI dialog.
5. Submit once to `POST /api/v1/generations`, using `consent: true`, the upload
   key, selectors, a stable idempotency key, and `confirmed_credits` equal to
   the displayed catalog quote. The existing phone API helper currently emits
   equivalent `source_keys: [{key, slot: "image"}]` descriptors. Reuse that helper
   in the build; do not add a second submit route just to use the singular alias.
6. Retain the returned job id and poll `GET /api/v1/jobs/{id}` through the existing
   helper (currently every 3 seconds, up to 10 minutes per polling session).
   `queued` and `running` continue; timeout/offline means status is unknown,
   not failure or permission to submit again. Resume checking that job. Reuse
   the same idempotency key for the same uncertain request; new settings/new run
   require a new key. Disable duplicate taps while submission is in flight.
7. At `succeeded`, fetch `GET /api/v1/jobs/{id}/asset` for the output URL and MIME
   type. Only DB `STORED` maps to public `succeeded`; provider `SUCCEEDED` still
   means storage is in progress (`lib/jobState.js`). Show labelled Before/After
   using the temporary local original under §6. At `failed`, show a typed
   message and refresh balance; say refunded only if `refunded: true` is returned.
8. The output is **automatically available in Library**: `lib/falWebhookHandler.js`
   calls `job_stored`, which inserts the asset and marks the job stored (0077,
   `packages/db/schema/supabase/0077_asset_content_hash.sql`). Offer **Open in Library**
   and a separate optional **Save to Photos**, requesting device permission only
   for the latter. There is no additional Library-save request. Denial of Photos
   permission leaves the stored Library output available.

## 4. Wire contract and consent

The source of truth is `app/api/v1/generations/route.js` (`ALLOWED_INPUTS`),
`lib/generationSources.js`, `lib/resolveSource.js` and the per-model capabilities.
All API requests use the signed-in account's existing authenticated API client;
do not put tokens in URLs or send them to the presigned storage URL.

Upload request: `{ "content_type": "image/jpeg", "size_bytes": 123456 }`.
Response fields: `key`, `upload_url`, `content_type`, optional `headers`, `max_bytes`,
`expires_in` (900 seconds). The server chooses
`uploads/{auth_id}/{uuid}.{ext}`; the phone never constructs a key or provider URL.

Example generation body (replace key and idempotency value with real values):

```json
{
  "model_id": "face-makeup",
  "idempotency_key": "face-filter-example-0001",
  "source_key": "uploads/00000000-0000-4000-8000-000000000001/00000000-0000-4000-8000-000000000002.jpg",
  "consent": true,
  "confirmed_credits": 3,
  "inputs": { "makeup_style": "natural", "intensity": "medium" }
}
```

- `model_id`: current active catalog slug; `idempotency_key`: 8-128 characters,
  matching `^[A-Za-z0-9._-]{8,128}$` (a UUID is suitable).
- `source_key`: top-level owned upload key, maximum 200 characters. The equivalent
  top-level `source_keys` array accepts `{key, slot: "image"}`; send one source
  representation, not both. `source_assets` exists for owned Library jobs but
  is not needed by this device-photo flow. `inputs` must be an object, at most
  8 KiB by the gateway's serialized-length check.
- A1/A2: `{}` or optional integer `seed` from 0 through 2147483647; no prompt.
- A4 `makeup_style`: `natural`, `glamorous`, `smoky_eyes`, `bold_lips`,
  `no_makeup`, `remove_makeup`, `dramatic`, `bridal`, `professional`,
  `korean_style`, `artistic`. Default `natural`.
  `intensity`: `light`, `medium`, `heavy`, `dramatic`; default `medium`.
- A5 `target_age`: integer 18-100, default 30. The outer `ALLOWED_INPUTS` admits
  6-100, but the model contract narrows it to 18-100. `preserve_identity` is an
  outer boolean field but is fixed true for A5; the client must omit it.
- A3, if later activated: nonempty `prompt` up to 2000 characters, optional
  bounded `seed`. Fixed one output and 1000×1000 canvas. Not a current phone option.
- Do not send `image_url`, `video_url`, `num_images`, `num_frames`, `image_size`,
  `aspect_ratio`, duration, output resolution or safety-checker overrides for
  these active filters. Membership in the gateway's broad allowlist does not
  override the selected model's narrower contract. Server-generated media URLs
  replace client URL fields; only source references persist in job inputs.
- `confirmed_credits`: optional in the API, required by this phone flow; a
  nonnegative integer. A mismatch returns 409 `credit_confirmation_mismatch`
  with `confirmed_credits` and `expected_credits`, before debit. Refresh and ask
  for a new price confirmation, rather than automatically accepting the increase.

`consent: true` is top-level. The server records
`RIGHTS_ATTESTATION_VERSION = 'aup-2026-09-26'` via `attest_upload_rights`, and
records the job's attestation via `job_consent_attested` (0096, 0146). **There is
no client consent-version field**; displaying the matching wording is the
client's responsibility. Recording errors are logged by the route; do not claim
that a successful response independently proves the attestation write succeeded.

Use the binding `sourceRights` text from
`lib/i18n/messages/legal/en/binding.mjs`, with Acceptable Use linking to
`/legal/aup` (approved translations follow the binding-copy system):

> I own this file, or I have the permission of everyone identifiable in it. No real person's face, body or voice is used without their consent, and I hold the rights to any brand, artwork or recording in it (Acceptable Use). This statement is recorded against the generation and your account.

## 5. Typed errors and credit consequences

Display localized explanations, never raw vendor responses. Codes below are
from the upload route, generation route, source helpers and `lib/submitFailureClass.js`.
Do not collapse consent, admission or moderation refusals into a network error.

| Code | Meaning and phone action | Credits |
|---|---|---|
| `consent_required` (400) | Obtain the per-photo attestation before submitting | No debit |
| `upload_admission_unavailable` (503, uploads) | Required hash matching has no enrolled provider; uploads cannot proceed | No debit |
| `source_not_admitted` (400, generations) | Existing upload cannot be handed to provider while admission is required and unavailable | No debit |
| `insufficient_credits` (402, uploads) | Zero balance; offer Top up | No debit |
| `insufficient_balance` (402, generation debit) | Not enough credits for this quote; offer Top up | No successful debit |
| `model_not_found` (404), `model_gated` (402), `model_region_unavailable` (451) | Refresh catalog / explain unavailable filter | No debit |
| `credit_confirmation_mismatch` (409), `confirmed_credits_invalid` (400) | Refresh quote and obtain valid confirmation | No debit |
| `upload_type_not_allowed`, `upload_size_required`, `upload_too_large` (400) | Ask for a supported, smaller photo or valid size | No debit |
| `source_key_invalid`, `source_asset_invalid`, `source_slot_invalid` (400) | Invalid source reference; reset selection | No debit |
| `source_not_found` (404) | Missing, expired or non-owned source; pick/upload again | No debit |
| `source_unreadable`, `source_type_unsupported`, `upload_unreadable`, `upload_type_mismatch` (400) | Source could not be inspected or does not match declared type; choose a valid file | No debit |
| `inputs_must_be_object`, `inputs_too_large`, `inputs_key_not_allowed:<key>`, `inputs_invalid:<key>` (400) | Correct selectors; missing photo can be `inputs_invalid:image_url` | No debit |
| `rate_limited`, `too_many_pending_uploads`, `upload_budget_exceeded` (429) | Explain limit; respect retry timing where provided | No debit |
| `account_frozen`, `account_on_hold` (403) | Explain account restriction; no automatic retry | No debit |
| `provider_admission_paused` (503) | Provider temporarily paused; respect Retry-After | No debit |
| `provider_moderation`, `provider_input_rejected` (422 on classified submit refusal) | Explain content refusal or rejected input; allow appropriate correction, no bypass or automatic retry | Rejected-submit refund path; refresh balance |
| `provider_submit_failed` (502) | Provider rejected submission without a more specific public classification | Rejected-submit refund path; refresh balance |
| `provider_error` (job read) | Generic provider failure; show safe fallback copy | Check `refunded` before claiming refund |

The gateway also contains `topic_refused` (422, internal `script_refused`), for
script-writing models; it is not a Face Filters-specific moderation code.
Classification depends on provider results / `JEV_SUBMIT_ERRORS_MODE`; not every
provider refusal yields `provider_moderation`. Job reads sanitize error codes
through `publicErrorCode` in `lib/jobState.js`. Keep a safe fallback for other
codes and storage/refund delays. `not_authenticated` requires sign-in;
`user_not_provisioned` requires account recovery. Configuration, balance lookup,
reservation and rate-check outages must leave the action retryable without
pretending a job was created or starting a second charge.

## 6. Privacy, retention and comparison lifetime

Uploads go to the existing R2 path and then to the selected AI provider. The
server checks owner prefix, admission, bounded bytes and magic number before
hand-off. `lib/uploadAdmission.js` has **no matching provider enrolled**.
`UPLOAD_HASH_MATCH_REQUIRED` is absent from checked-in production vars (default
off); turning it to exact string `"true"` currently closes upload issuance and
uploaded-source hand-off. `UPLOAD_INTEGRITY_ENABLED` and
`UPLOAD_REQUEST_RATE_LIMIT_ENABLED` are `"true"` in those vars. These are dated
repository settings, not verified production runtime values; no claim of active
CSAM scanning is made. Catalog activation does not resolve the public-upload gate.

`lib/uploadSweep.js` sweeps abandoned sources at 24 hours, and consumed sources
on subsequent five-minute cron runs after a terminal job. Consumed cleanup has
a 16-minute job-age guard (outliving the PUT URL) and a 30-minute terminal-update
lookback; missed runs fall back to the age sweep. Say “normally within minutes
after completion, or through the 24-hour sweep”, not an exact deletion promise.
Account-closure source cleanup and provider-side retention remain unverified.
Do not imply that the platform's R2 sweep controls the provider's storage.

**Planned local lifetime:** keep the app-owned selected original in temporary
device storage for the active workflow, scoped to account and job. Once the
immediate result view opens, delete that copy when the view closes or after a
short bounded timer, whichever happens first. Clear it on sign-out, account
change, cancel/reselection and abandoned workflow expiry. A proposed implementation
bound is 10 minutes in the result view and 30 minutes overall from selection;
these are planned limits, not existing behaviour. Purge stale copies on startup
and never restore comparison after restart. If the local copy has expired before
a slow job completes, show output only with an explanation.

After app restart or reopening from Library, show **output only**. Uploaded
originals are swept and **are not readable through job or asset reads**. Do not
persist presigned URLs or copy originals into generated assets to fake persistent
comparison. A persistent comparison is a separate unresolved storage/API and
retention requirement. “Save to Photos” explicitly saves the output to the
user's device; local cleanup never deletes the user's source or saved output.

## 7. Accessibility and copy

Use the app's existing tokens, accessible controls and translation system.
Label each selector and selected value; explain unavailable actions next to the
control. Support screen readers, Dynamic Type, both themes and reduced motion.
Announce upload progress, queued/running/result and failure states without
relying on colour. Label comparison images “Before” and “After”; stack them on
small screens and provide an accessible output-only state when the original is
gone. Do not require a gesture-only comparison slider.

Show the price in credits before submission. Use plain, nonjudgmental descriptions
of retouching and aging, without promises of identity accuracy, guaranteed
safety or an authenticity verdict. Use “Open in Library” and “Save to Photos”.
Keep rights attestation separate from AI-sharing permission and from Photos
permission. Only confirmed refunds may be described as refunded.

## 8. Out of scope and open questions

Out of scope: A3 until active; A6-A8; Track B authenticity verdicts; real-time
camera filtering; persistent before/after storage; a Transform mode; a second
submit path; any additional Library-save request.

Open before treating this flow as shipped:

- Has 0357 actually applied in production? This docs task does not read production.
- Which build PR implements the selectors, explicit per-photo rights statement,
  temporary comparison cleanup and both result actions? No merge is asserted here.
- Confirm the proposed local cleanup timers during that build and verify account
  switching, restart, backgrounding, slow jobs and Photos permission denial.
- Enroll and enforce the upload matcher under its approved contract; the fail-closed
  seam alone does not satisfy the public-upload launch gate.
- Run A3 with the pinned canvas and verify billing before activation/repricing.
- Resolve persistent comparison separately if required; no existing API supplies it.
- Verify account-closure cleanup, provider retention and the remaining PRD §6 gates
  before any A7/A8 work.

Build-plan correction (Revision 2): specify **Save to Photos**, alongside
**Open in Library**, not “Save to Library”. The other six mobile spec documents
are owned by a parallel branch and remain untouched by this documentation task.

Existing evidence: `tests/faceFilters.test.mjs`, `tests/uploadAdmission.test.mjs`
and `apps/mobile/__tests__/toolDirectory.test.ts` cover contracts/grouping, not
production activation or the planned phone experience. The agreed TypeScript
and Jest commands check the current mobile source, not an unmerged build.
