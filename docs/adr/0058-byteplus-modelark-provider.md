# ADR-0058 — BytePlus ModelArk as the provider for Seedance video

- **Status**: Proposed 2026-09-26. Rows stage inactive; nothing goes live until the
  "Before activating any row" list is complete and the owner accepts.
- **Date**: 2026-09-26
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0014 — Floor pricing](0014-floor-pricing.md),
  [ADR-0020 — kie.ai and OpenRouter as generation providers](0020-kie-and-openrouter-providers.md),
  [ADR-0027 — Capability registry](0027-model-capability-registry.md),
  [ADR-0037 — 50% contribution margin](0037-higgsfield-credit-parity.md),
  [ADR-0056 — Project media quarantine](0056-project-media-quarantine.md),
  `docs/pricing/wholesale-survey-2026-09-26.md`,
  `docs/pricing/byteplus-cost-levers-2026-09-26.md`,
  `docs/pricing/syntx-competitor-analysis-2026-09-26.md`.

## Context

The 2026-09-26 wholesale survey priced every video and audio model across fal.ai,
kie.ai, the first-party vendor APIs and 13 aggregators. For the Seedance family the
cheapest verified source is ByteDance's own platform, BytePlus ModelArk (BytePlus
Pte. Ltd., Singapore), once its prepaid resource packs are used:

| Model, 5s 16:9 720p, no video input | Our cost today | BytePlus list | BytePlus with pack | Next cheapest verified |
|---|---:|---:|---:|---|
| Seedance 2.0 Fast | $0.454 (OpenRouter) | $0.60 | **$0.35** | kie $0.62 |
| Seedance 2.0 Mini | not sold | $0.38 | **$0.23** | kie $0.205 |
| Seedance 2.0 | not sold | $0.76 | **$0.47** | Segmind $0.76 |
| Seedance 2.5 | not sold | $1.16 | **$0.69** | Segmind $1.19 |
| Seedance 1.0 Pro Fast | not sold | **$0.10** | no pack | fal $0.11 |

Packs are $4.30, $3.30 and $2.10 per million tokens for 2.0, 2.0 Fast and 2.0 Mini
and $6.40 for 2.5, against list rates of $7.00 to $11.70. Minimums are $30 to $42, validity
three months (one page says 90 days), non-refundable, deducted before pay-as-you-go,
open to individuals and enterprises. No commitment is required. The AI Savings Plans
need $7,000 per month and give Seedance 2.x 0% anyway, so they are out of scope.

Two things about the current OpenRouter route pushed this from "nice to have" to a
decision. Our $0.454 is exactly BytePlus's 25% promotional rate, which ends 2026-10-07,
after which OpenRouter can be expected to follow list to $0.60. And syntx.ai sells
Seedance 2.0 Fast at €0.23 to €0.38 per clip; with the pack rate and our 50% floor we can
sell it at $0.86 instead of $1.20, which is the closest we can get to them without giving
up the margin policy or grey sourcing.

Seedance 1.5 Pro, the cheapest Seedance row in the survey ($0.0875 on kie), is marked
**Retired** on BytePlus's model list with 2.0 Mini as the recommended replacement. It is
not adopted here; kie may drop it without notice.

### What BytePlus requires of us

BytePlus's Service Specific Terms for the Model Services (updated 2026-09-08), section
4.2 "Platform Customers", apply to anyone who "integrates BytePlus video generation model
APIs into its own platform and makes them available to external enterprises or creators".
A consumer generation product is an "AI content creation tool" and an "aggregation
platform" in those terms. The permitted shape is end users generating video "for their
own use". Reselling API access needs written authorisation. Section 4.2.2 sets four
minimum controls: identity verification for end users, a security incident response
process, tiered violation handling with content traceability and complete records, and
a process to verify and retain rights in user-uploaded content including real-person
imagery. Unauthorised resale means an immediate ban and liquidated damages. The full
quotes are in `byteplus-cost-levers-2026-09-26.md`.

Section 2(1) of the same terms says the Model Services "are not available in the United
States". Whether that binds only the customer's location or also end users is not stated.

### Data handling

- Region: every Seedance model is served from `ap-southeast-1` (Singapore) at
  `ark.ap-southeast.bytepluses.com/api/v3`. The `eu-west-1` endpoint exists but serves
  only two text and image models today. Prompts and reference media leave the UK and EU.
  This is the same class of transfer the owner accepted for kie (US) in ADR-0020's
  2026-09-24 update, and BytePlus is on firmer footing: a published Data Processing
  Addendum with UK GDPR and EU GDPR annexes, a sub-processor list with 15 days' notice,
  and deletion within 180 days of termination.
- Output ownership sits with the customer (General Terms for AI Services 2.1). The GenAI
  Acceptable Use Policy forbids removing "watermarks, identifiers, metadata" that mark
  BytePlus output and requires disclosure that content is AI generated.

### API mechanics

Bearer API key. `POST /api/v3/contents/generations/tasks` returns a task id;
`GET /api/v3/contents/generations/tasks/{id}` returns `status` in `queued`, `running`,
`succeeded`, `failed`, `cancelled`, a `content.video_url` **valid for 24 hours**, and
`usage.completion_tokens`, which is the billed quantity. A `callback_url` can be set on
the task. The API supports only API-key authentication, and nothing on the callback is
signed. Only successful generations are billed. Minimum token consumption applies to
Seedance 2.0 and 2.5 when the input includes video.

## Decision

Add BytePlus ModelArk as a fourth generation provider behind the existing money spine,
with no change to the ledger, the job state machine or the refund rules.

1. **Adapter.** `packages/adapters/byteplus.js`, plain `fetch` and Web Crypto like the
   others. `buildRequest` goes through `capabilityFor`, `checkInputs` and `shapePayload`
   from `lib/modelCapabilities.js` (ADR-0027), so every request is pinned to the unit its
   catalog row is priced at: 5 seconds, 16:9, 720p, text or single first-frame image,
   no video input, no extension, no editing. Inputs the row cannot express are refused
   before the debit. Never retry a submit automatically: an ambiguous timeout may already
   have billed (same rule as GrsAI).
2. **Completion is poll-first.** The BytePlus callback is unsigned, so it can only ever be
   a hint to re-read the task with our API key. It is not used in v1. Completion follows
   the GrsAI path instead: a sweep in `lib/byteplusSweep.js` modelled on
   `lib/grsaiSweep.js` reads SUBMITTED jobs, calls `fetchTask`, and hands the result to
   `completeJob` in `lib/providerCompletion.js`: copy to R2, `job_succeeded`, `job_stored`;
   or `job_failed` then `ledger_refund`. A refund happens only for a job that is FAILED,
   using the job row's user and credits. A job left SUCCEEDED without an asset is refunded
   by `sweep_stuck_jobs` as today.
3. **R2 copy allowlist.** `packages/adapters/r2Copy.js` gains a `byteplus` entry whose host
   list is filled in only after one live output has been fetched and its host recorded in
   the activating migration's header, exactly as kie's `.aiquickdraw.com` was. A redirect
   is refused, which would refund every job, so this is verified before activation.
4. **Catalog rows**, staged **inactive** by migration, priced at the pack rate using the
   ADR-0037 rule `credits = ceil(cost / 0.01796)`:

   | id | endpoint | cost recorded | credits | today |
   |---|---|---:|---:|---|
   | seedance-2.0-fast-byteplus | dreamina-seedance-2-0-fast-260128 | $0.35 | 20 | 28 on OpenRouter |
   | seedance-2.0-mini-byteplus | dreamina-seedance-2-0-mini-260615 | $0.23 | 13 | none |
   | seedance-2.0-byteplus | dreamina-seedance-2-0-260128 | $0.47 | 27 | none |
   | seedance-2.5-byteplus | dreamina-seedance-2-5-260628 | $0.69 | 39 | none |
   | seedance-1.0-pro-fast-byteplus | seedance-1-0-pro-fast-251015 | $0.10 | 6 | none |

   `provider_cost_per_unit` records the **pack** rate, and the migration header says so.
   The pack rate is only true while a pack has balance. See consequence 3.
5. **Schema.** `job_steps.provider` (migration 0091) is widened to include `'byteplus'`.
   `jobs.provider` and `model_catalog.provider` are free text and need no change.
6. **Account.** A BytePlus enterprise account in the UK company's name with organisation
   verification and a corporate tax ID. That unlocks 0% VAT at source, 600 requests per
   minute and 10 concurrent jobs on Seedance 2.x (individual accounts get 180 and 3), and
   the enterprise-only promotions. Packs are bought from that account; no savings plan,
   no order form, no reseller programme.
7. **Compliance controls, mapped to the codebase before activation.** Each of the four
   4.2.2 minimums gets a named home, recorded in this ADR when done:
   - *Identity verification*: confirmed email plus Turnstile at sign-up (ADR-0026) and,
     for any paid generation, a Stripe customer with a completed payment (ADR-0031). The
     ADR records this as our verification standard and BytePlus is asked whether it is
     sufficient.
   - *Security incident response process*: a short runbook under `docs/agents/` naming the
     on-call owner, the provider contacts, and the steps for suspected misuse or breach.
   - *Tiered violation handling with records*: the append-only `account_actions` log
     (ADR-0019, #97) already records Freeze and unfreeze. It gains `warning` and `takedown`
     action types with a job id, so every strike is traceable to the content.
   - *Rights in uploaded content including real-person imagery*: the upload path (ADR-0028,
     ADR-0056 quarantine) gains a one-time attestation that the user holds rights to and
     consent for any person in uploaded media, stored with a timestamp on the user row.
8. **Labelling.** Generated assets keep provider metadata untouched (the R2 copy is byte
   for byte) and the library shows an "AI generated" label on every asset. BytePlus's own
   optional visible watermark is left off.
9. **US end users.** Before activation, BytePlus is asked in writing whether the United
   States exclusion applies to end-user location. Until the answer is recorded here, the
   gateway routes requests whose `cf-ipcountry` is `US` away from BytePlus rows (they see
   the fal or kie twin, or a 451 if none).

### What is not decided here

- Retiring the OpenRouter Seedance 2.0 Fast row. It stays as the fallback until the
  BytePlus row has run clean for seven days and the pack-exhaustion rule below is in place.
- Any developer or partner API on top of BytePlus routes. That is resale under 4.2.3 and
  needs BytePlus's written authorisation first.
- Kling direct (same list price as fal, prepaid, expiring) and the AI Savings Plans
  (irrelevant below $7,000 per month). Both are rejected in the survey and not revisited.
- Seedance 1.5 Pro on kie. Retired upstream; not adopted.

## Consequences

1. New secret `BYTEPLUS_API_KEY` on `veyrnox-ai`. No webhook secret, because no callback
   is trusted. Outbound target is the single constant `ark.ap-southeast.bytepluses.com`.
2. Prompts and reference images for these rows are processed in Singapore under BytePlus's
   DPA. The privacy page's processor list must name BytePlus Pte. Ltd. before activation.
3. **Pack exhaustion moves the cost above the floor.** At list, Seedance 2.0 Fast costs
   $0.60 and needs 34 credits, not 20. The daily reconcile gains a `byteplus_pack_balance`
   check that reads the remaining pack quota from the Billing Center and fails when it
   covers fewer than 48 hours of trailing usage. Failing it is a page to the owner to
   re-purchase; if the pack hits zero the rows are deactivated by the same check rather
   than sold at a loss. Packs are non-refundable, so purchase size follows trailing usage,
   not optimism.
4. Output URLs expire in 24 hours. The sweep must copy to R2 on the first successful read;
   a job whose copy fails is retried within the window, then refunded.
5. Enterprise verification takes one to two working days and needs the business
   registration certificate. Nothing in this ADR can be tested against production pricing
   until it is done; the free Seedance 1.0 Pro quota (2M tokens) covers the first
   verification runs.
6. Margin at the floor is the same 50% contribution as every other row (ADR-0037). The
   lower cost is passed to the customer as a lower price, not kept.
7. The four compliance controls are product work, not adapter work, and they gate this
   provider whether or not the adapter is ready. They also raise our standing with every
   other provider whose terms say the same thing less explicitly.

## Implementation (2026-09-26)

Shipped, all rows inactive:

- `packages/adapters/byteplus.js`: `buildRequest` (record-pinned, prompt and optional
  https first frame into `content`), `submitTask`, `fetchTask`, `interpretTask`. Fixed host,
  bearer key, `redirect: 'manual'`, 64 KB response cap, no callback registered, typed error
  codes only; vendor payloads never leave the adapter.
- `lib/additionalModelCapabilities.js`: five `byteplus:*` records, 5s at 720p, aspect
  ratios 16:9, 9:16, 1:1, 4:3, 3:4, optional first-frame image capped at 4096 by 4096.
- `packages/provider-sdk/registry.js`: `byteplus` entry, key present only when R2 is
  configured (polling needs somewhere to copy the 24-hour output).
- `lib/byteplusSweep.js` plus the `byteplus` task in `worker.js`: same shape as the GrsAI
  sweep, 45-minute timeout, `.mp4` with `expectMp4`, 60 MB cap.
- `packages/adapters/r2Copy.js`: `byteplus` allowlist entry, deliberately empty.
- Migration `0145_byteplus_seedance_staged.sql`: the five rows inactive at 20, 13, 27, 39 and
  6 credits; `worker_task_health` CHECK widened; `refresh_recovery_health` expects the
  byteplus heartbeat only while a byteplus row is active.
- `scripts/verify-byteplus-endpoints.mjs`: plan and paid submit modes, reports output host,
  redirect behaviour and billed tokens times the pack rate against the recorded cost.
- Tests: `tests/byteplusAdapter.test.mjs`, `tests/byteplusSweep.test.mjs`, catalog list in
  `tests/modelCapabilities.test.mjs`, a refusal case in `tests/r2Copy.test.mjs`.
- `scripts/check-security.mjs` and `scripts/check-recovery-health.mjs` know the new secret
  and task name.

Two corrections to the decision text above, found while building:

- Decision 5: `job_steps.provider` is not widened. That table belongs to Auto Short, which
  does not use BytePlus in v1. Widen it in the migration that first routes a step there.
- Decision 7, rights in uploaded content: the gateway already requires `consent: true` on
  any request naming an upload and records it on the job through `job_consent_attested`
  (migration 0096). The control exists per job; what remains is the user-level attestation
  text and its link from the upload UI.

## Before activating any row

1. Enterprise account verified, corporate tax ID on file, `BYTEPLUS_API_KEY` set.
2. Written answer from BytePlus on end-user location and the US exclusion, recorded here.
3. Written confirmation from BytePlus that a consumer app with the controls in decision 7
   is a permitted "own use" platform under 4.2.3, recorded here.
4. The four controls in decision 7 shipped and named in this ADR.
5. Privacy page lists BytePlus Pte. Ltd. as a processor with the Singapore region.
6. One live generation per row through a `scripts/verify-byteplus-endpoints.mjs` modelled
   on `verify-kie-endpoints.mjs`, output host recorded, `usage.completion_tokens` times the
   pack rate matching the recorded cost within 5%, and the job reaching STORED.
7. Packs purchased for each row at a size covering at least 30 days of expected usage.
8. `byteplus_pack_balance` reconcile check green for 24 hours.
9. Flip `active` in a migration that also switches the OpenRouter twin off, with the
   evidence in its header.
