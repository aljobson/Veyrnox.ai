# Implementation Plan — Face Filters

**Status:** Draft · 2026-09-18 · slice status updated 2026-10-08 against `main` at `42150476`. Slices 1-4 done (#187); Slice 0 partly done; Slices 5-9 not started.
**Reads with:** [PRD.md](PRD.md) · [TRD.md](TRD.md) · [APP-FLOW.md](APP-FLOW.md) · [UI-UX.md](UI-UX.md) · [SCHEMA.md](SCHEMA.md)

Slices ship in order, each one PR-sized. A slice does not merge before its
predecessor. Every slice states its exit gate; a slice without a green gate is
not done.

| Slice | State 2026-10-08 |
|---|---|
| 0 Verify endpoints | partly: 5 of 8 ran; no cost read; A6 not run |
| 1 Presigned PUT | done (#187) |
| 2 Upload endpoint | done (#187), since extended (audio, rate limit, consent, caps) |
| 3 Content verification | done (#187) |
| 4 Gateway accepts a source | done (#187) |
| 5 Catalog rows, inactive | not started; no Track A row in any migration through 0227 |
| 6 Studio Transform mode | not started as specified; per-slot upload field exists |
| 7 Result and Library | not started |
| 8 Upload retention | partly: sweeps exist; account-closure deletion unverified |
| 9 Activate | nothing to activate |

Track B is absent. It does not start until its ADR is accepted.

## Slice 0 — Verify the endpoints *(no product code)*

**Video Enhance update, 2026-09-26:** [validation findings](VIDEO-ENHANCE.md)
separate photo retouch from video smoothing. The public probe now runs without
a key and resolves the endpoint's actual request schema. Paid video probes
require `TEST_VIDEO_URL`; mixed-media endpoints also require an explicit
`TEST_IMAGE_URL` reference frame. Missing inputs or output URLs fail verification.
The Light-X default mode still needs endpoint-specific conditional inputs.

Nothing below is worth building if the endpoints do not behave. Do this first
and record the results.

- Call each candidate endpoint in PRD §4 (A1–A6) directly against fal with a
  real key and a real test image.
- Record per endpoint: does it return an output, what does it cost, what is the
  latency, what input schema does it actually take.
- Kill any endpoint that fails. Replace it or drop the feature — do not carry a
  maybe into a migration.
- **Exit gate:** a written table of endpoint → verified output → measured
  `provider_cost_per_unit` → proposed `credits_5s` clearing the ADR-0014 floor.

**Status — 5 of 8 submitted real jobs; prices still missing.**

_Corrected 2026-09-20: this read "6 of 8". `scripts/.slice0-results.json`
holds five rows. `fal-ai/retoucher` did produce output, but on an earlier
run whose request id was overwritten, so it cannot be costed against the
dashboard and must be re-run before it is priced._
`scripts/verify-filter-endpoints.mjs` probes schemas for free and submits real
jobs with `--submit`.

| Feature | Endpoint | Wall | Inference | Output |
|---|---|---|---|---|
| A1 retouch | `fal-ai/image-editing/retouch` | 19s | 18.3s | yes |
| A1 alt | `fal-ai/retoucher` | >180s cold | 13.8s | yes |
| A2 face enhance | `fal-ai/image-editing/face-enhancement` | 16s | 14.8s | yes |
| A3 relight | `fal-ai/iclight-v2` | 53s | 18.5s | yes |
| A4 makeup | `fal-ai/image-apps-v2/makeup-application` | 22s | 21.4s | yes |
| A5 age modify | `fal-ai/image-apps-v2/age-modify` | 28s | 26.6s | yes |
| A6 video relight | `fal-ai/id-v2v/relight` | — | — | **not run** |
| A6 alt (registered as "A3 alternate" in the script — script is wrong, the schema has no image_url) | `fal-ai/lightx/relight` | — | — | **not run** |

The two video models were held back: they cost materially more per call and
need a real clip, not the test image.

**Wall clock is not inference time.** `fal-ai/retoucher` computed in 13.8s and
took over three minutes end to end on a cold endpoint. Users wait for the wall
clock, so the Studio needs wait-time hints for these from day one.

*Status 2026-10-08: unchanged. `scripts/.slice0-results.json` is not in the
repository checkout, so the request ids cannot be matched to a dashboard from
here (unverified). A `fal-catalog-watch` workflow exists but was not
checked against these endpoints.*

**Still blocking `active = true`:** fal does not return cost per call, so
`provider_cost_per_unit` has to be read off the dashboard against the request
ids in `scripts/.slice0-results.json` and checked against the ADR-0014 floor.
No catalog migration until that exists.

## Slice 1 — Presigned PUT in the R2 adapter

- Add `presignPutUrl(key, contentType, expiresSeconds, cfg)` to
  `packages/adapters/r2.js`, built on the existing `signingKey`, `rfc3986`, and
  `iso8601BasicNow` helpers. No new crypto, no new dependency.
- Unit tests: signature shape, expiry bound, `Content-Type` pinned in the
  signature, key escaping.
- **Exit gate:** tests pass; a signed URL from a local run accepts a real PUT to
  the staging bucket and rejects a mismatched `Content-Type`.
- **Status 2026-10-08: done** (#187; `tests/r2PresignPut.test.mjs`). The staging-bucket exit check itself is unverified from the repository.

## Slice 2 — Upload endpoint

- New route under `/api/v1/`. Do **not** revive `get_upload_url` — it stays 410
  per ADR-0007.
- `POST {content_type, size_bytes}` → validate against the MIME allowlist and
  per-type size cap → derive `uploads/{user_id}/{uuid}` from
  `x-veyrnox-auth-id` → return `{upload_url, key}`.
- Rate limit on the existing Postgres sliding window.
- Typed errors only. Malformed input is 400, never 500.
- Tests: allowlist rejection, size rejection, key derivation, unauthenticated
  request is 401, an inbound `x-veyrnox-auth-id` header from the client is
  ignored.
- **Exit gate:** tests pass; an authenticated browser can PUT a file to R2 and
  no other user's prefix is reachable.
- **Status 2026-10-08: done** (`app/api/v1/uploads/route.js`). Also now: audio types, `insufficient_credits` for a zero balance, the ADR-0035 rate limit, a 10-upload cap, kebab-case error codes. ADR-0044 (reserved byte budget) is Proposed and its flag is off in production.

## Slice 3 — Server-side content verification

- Before a job is submitted, HEAD the uploaded object and read its leading bytes
  to confirm the magic number matches the declared type.
- Mismatch: delete the object, return a typed error, `console.error` the event
  as security-relevant.
- Tests: a PNG declared as MP4 is rejected; an HTML file with an image extension
  is rejected; a valid file of each allowed type passes.
- **Exit gate:** tests pass. No file reaches a presigned GET without passing.
- **Status 2026-10-08: done** (`sniffType`, `lib/resolveSource.js`). Delete-on-mismatch is not in that path; the 24-hour sweep removes the object.

## Slice 4 — Gateway accepts a source

- Add `video_url` to `ALLOWED_INPUTS` in `app/api/v1/generations/route.js`,
  `kind: 'url'`, matching `image_url`. Add nothing else.
- Accept an upload **key** on the request, resolve it to a presigned GET at
  submit time, and place it in the provider payload. The key is what persists in
  `jobs.inputs`; the signed URL never does.
- Reject a key whose `user_id` segment is not the caller's.
- Add tests pinning `kindOf()` and `priceFor()` for `image-to-image` and
  `video-to-video` before any catalog row depends on them.
- **Exit gate:** tests pass; a hand-rolled request with an uploaded source
  completes end to end against one verified endpoint.
- **Status 2026-10-08: done** (`video_url`, `source_key`, ownership check, `tests/kindOf.test.mjs`). The end-to-end exit run is unverified; existing image-edit and lip-sync models take uploaded sources the same way. A consent statement is now required with any source.

## Slice 5 — Catalog rows, inactive

- One migration inserting the A1–A6 rows with `active = false`, prices from
  Slice 0, `ON CONFLICT (id) DO UPDATE`, idempotent.
- Next free number on `main`; check open PRs first.
- **Exit gate:** migration applies cleanly twice; `migration-ledger` green; rows
  present and inactive; no UI change visible.
- **Status 2026-10-08: not started.** Next free number on `main` is 0228 (check open PRs). The CI rule for new catalog UPDATE migrations (exact positive row count) applies to the Slice 9 flip, and `apply-migrations` skips silently when a file is numbered below production's latest.

## Slice 6 — Studio Transform mode

- `ModeToggle` and `UploadZone` per UI-UX §5.
- Model picker filters by modality on mode.
- Submit disabled with a stated reason when Transform has no source.
- Existing balance check, cost display, gating, and error surface reused — not
  reimplemented.
- **Exit gate:** with a row temporarily activated in staging, a user can upload,
  submit, poll, and see a result. Screenshots in the PR.
- **Status 2026-10-08: not started as specified.** No `ModeToggle`, `UploadZone` or `BeforeAfter`. Check `SourcePickers`, `LibraryPicker` and the `/tools` page before building; they cover part of this.

## Slice 7 — Result and Library

- `BeforeAfter` in the canvas for Transform jobs.
- Source thumbnail inset on Library cards for Transform jobs.
- **Exit gate:** both render correctly in light and dark themes, under
  `prefers-contrast: more`, and at 400px width.
- **Status 2026-10-08: not started.**

## Slice 8 — Retention for uploads

- Extend the retention sweep to the `uploads/` prefix with its own, shorter age
  than the ADR-0008 asset default.
- Delete a user's uploads on account closure.
- **Exit gate:** a seeded old upload is swept; a fresh one is not; deletion on
  closure is tested.
- **Status 2026-10-08: partly done.** `sweepUploads` (24 hours, `tests/uploadSweep.test.mjs`) and `sweepConsumedUploads` run on the 5-minute cron. The age is one value for all uploads, not a shorter one for face references (none exist). Deletion on account closure: no code found, unverified.

## Slice 9 — Activate

- One migration flipping `active = true`, only for endpoints that returned real
  output on a live call, with measured costs.
- Applied on production by the `apply-migrations` workflow after owner approval
  (ADR-0023).
- **Status 2026-10-08: not started; nothing to flip.** Production flags are unchanged by Track A.
- **Exit gate:** each filter produces a real result in production; every failure
  path refunds; `reconcile_balances()`, `reconcile_free_credits()` and
  `reconcile_top_ups()` return zero rows for 24 hours.

## Blocked — A7 and A8 (identity reference, face swap)

Not scheduled. Every item in PRD §6 must be satisfied first: per-upload consent
attestation recorded against the job, output moderation, a takedown route to the
ADR-0005 §6 designated agent, shortened retention for face references, and a
published statement of use. That is its own ADR and its own plan.

*Status 2026-10-08: unchanged, and no ADR drafted. Closest existing pieces: the consent attestation (0096, 0146) and violation records (0146). CSAM hash matching (ADR-0025 §8.1, product plan D1) has no code; it gates any public upload surface, including Slice 6.*

## Blocked — Track B (authenticity)

Not scheduled. Needs a vendor decision, a contract, a new webhook signature
scheme, the `authenticity_checks` shape from SCHEMA.md §5, and an ownership
decision on publishing probabilistic verdicts about identifiable people.

*Status 2026-10-08: ADR-0025 is still Proposed. Overlap checked: ADR-0069 (model free allowance) offers two models, `chat-mistral-small` and `nano-banana-kie`, neither a filter, so no overlap yet; a filter row would need `free_allowance_per_day` set deliberately, and the allowance is capped at $0.05 a job. ADR-0073 (studio skills, Proposed in the ADR, built in #605) has "Fix this photo", "Edit with words" and "Bring it to life" assistants that only prepare a Studio draft pointing at existing models; a filter row in the open catalog could be offered by them, and they never run one.*

## Standing rules for every slice

- Read the file before editing it. Prefer editing over creating.
- Files under 500 lines.
- No secrets in `wrangler.jsonc`; service credentials via `wrangler secret`.
- Every state-changing RPC takes an idempotency key and replays as a no-op.
- Typed `{error: "kebab_case_code"}` responses; no vendor payloads, no stack traces.
- `npm run build && npm test` green before commit.
- No `Co-Authored-By` trailer unless `.claude/settings.json` sets `attribution.commit`.
