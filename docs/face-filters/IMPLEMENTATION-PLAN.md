# Implementation Plan — Face Filters

**Status:** Draft · 2026-09-18
**Reads with:** [PRD.md](PRD.md) · [TRD.md](TRD.md) · [APP-FLOW.md](APP-FLOW.md) · [UI-UX.md](UI-UX.md) · [SCHEMA.md](SCHEMA.md)

Slices ship in order, each one PR-sized. A slice does not merge before its
predecessor. Every slice states its exit gate; a slice without a green gate is
not done.

Track B is absent. It does not start until its ADR is accepted.

## Slice 0 — Verify the endpoints *(no product code)*

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

## Slice 3 — Server-side content verification

- Before a job is submitted, HEAD the uploaded object and read its leading bytes
  to confirm the magic number matches the declared type.
- Mismatch: delete the object, return a typed error, `console.error` the event
  as security-relevant.
- Tests: a PNG declared as MP4 is rejected; an HTML file with an image extension
  is rejected; a valid file of each allowed type passes.
- **Exit gate:** tests pass. No file reaches a presigned GET without passing.

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

## Slice 5 — Catalog rows, inactive

- One migration inserting the A1–A6 rows with `active = false`, prices from
  Slice 0, `ON CONFLICT (id) DO UPDATE`, idempotent.
- Next free number on `main`; check open PRs first.
- **Exit gate:** migration applies cleanly twice; `migration-ledger` green; rows
  present and inactive; no UI change visible.

## Slice 6 — Studio Transform mode

- `ModeToggle` and `UploadZone` per UI-UX §5.
- Model picker filters by modality on mode.
- Submit disabled with a stated reason when Transform has no source.
- Existing balance check, cost display, gating, and error surface reused — not
  reimplemented.
- **Exit gate:** with a row temporarily activated in staging, a user can upload,
  submit, poll, and see a result. Screenshots in the PR.

## Slice 7 — Result and Library

- `BeforeAfter` in the canvas for Transform jobs.
- Source thumbnail inset on Library cards for Transform jobs.
- **Exit gate:** both render correctly in light and dark themes, under
  `prefers-contrast: more`, and at 400px width.

## Slice 8 — Retention for uploads

- Extend the retention sweep to the `uploads/` prefix with its own, shorter age
  than the ADR-0008 asset default.
- Delete a user's uploads on account closure.
- **Exit gate:** a seeded old upload is swept; a fresh one is not; deletion on
  closure is tested.

## Slice 9 — Activate

- One migration flipping `active = true`, only for endpoints that returned real
  output on a live call, with measured costs.
- Applied on production by the `apply-migrations` workflow after owner approval
  (ADR-0023).
- **Exit gate:** each filter produces a real result in production; every failure
  path refunds; `reconcile_balances()`, `reconcile_free_credits()` and
  `reconcile_top_ups()` return zero rows for 24 hours.

## Blocked — A7 and A8 (identity reference, face swap)

Not scheduled. Every item in PRD §6 must be satisfied first: per-upload consent
attestation recorded against the job, output moderation, a takedown route to the
ADR-0005 §6 designated agent, shortened retention for face references, and a
published statement of use. That is its own ADR and its own plan.

## Blocked — Track B (authenticity)

Not scheduled. Needs a vendor decision, a contract, a new webhook signature
scheme, the `authenticity_checks` shape from SCHEMA.md §5, and an ownership
decision on publishing probabilistic verdicts about identifiable people.

## Standing rules for every slice

- Read the file before editing it. Prefer editing over creating.
- Files under 500 lines.
- No secrets in `wrangler.jsonc`; service credentials via `wrangler secret`.
- Every state-changing RPC takes an idempotency key and replays as a no-op.
- Typed `{error: "kebab_case_code"}` responses; no vendor payloads, no stack traces.
- `npm run build && npm test` green before commit.
- No `Co-Authored-By` trailer unless `.claude/settings.json` sets `attribution.commit`.
