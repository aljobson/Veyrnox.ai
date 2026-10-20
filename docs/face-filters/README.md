# Face Filters & Media Authenticity — spec set

**Status:** Updated 2026-10-20 against local `origin/main` at `4ccfbd2a1d4b39c8e20db9a0c5269ddab8f908bd`; the Face Filters sources are identical in this checkout (`cf1573bf`). Activation is **merged; production application not verified from the repo**.

For uploaded-video skin smoothing, see [Video Enhance validation](VIDEO-ENHANCE.md)
(2026-09-26), including the runnable local MediaPipe/WebGL prototype. The photo
retouchers below do not establish video support; production qualification remains
pending.

Six documents covering one feature, not the whole app. Read in this order:

| # | Document | Answers |
|---|----------|---------|
| 1 | [PRD.md](PRD.md) | What gets built, what is deliberately not, and what gates A7/A8 |
| 2 | [TRD.md](TRD.md) | Technical decisions with their rejected alternatives |
| 3 | [APP-FLOW.md](APP-FLOW.md) | Routes, upload, submit, poll, and every failure path |
| 4 | [UI-UX.md](UI-UX.md) | Tokens, three new components, copy and accessibility rules |
| 5 | [SCHEMA.md](SCHEMA.md) | Auth flow, every table filters touch, R2 key layout |
| 6 | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Ten slices, each with an exit gate |

Rendered with two interactive diagrams (credit ledger flow, generation webhook
sequence): https://claude.ai/artifact/Rjn2EPF72mgjgrKuuB9Wic

**Current catalog state (2026-10-20, `4ccfbd2a`):** 0356 stages A1-A5;
0357 activates A1 `face-retouch`, A2 `face-enhance`, A4 `face-makeup` and A5
`face-age`, each at 3 credits / $0.0400 recorded provider cost. A3 `face-relight`
stays inactive at 7 credits / $0.1000: the unpinned probe billed 2 MP ($0.20);
a run with the pinned 1000×1000 canvas is still required. A6 is not staged;
A7/A8 are absent and blocked by PRD §6. These are migration states, not a
production read. The web uses Studio models and the per-slot `SourcePickers`
upload field; **a Transform mode does not exist**. Web and phone Tools entries
come from the active catalog. The dedicated phone flow is
[planned until the build PR merges](../mobile/spec/FACE-FILTERS.md).

**Upload admission:** `lib/uploadAdmission.js` has no enrolled matching provider.
`UPLOAD_HASH_MATCH_REQUIRED` is absent from the production vars in the checked-in
`wrangler.jsonc` (default off), while `UPLOAD_INTEGRITY_ENABLED` and
`UPLOAD_REQUEST_RATE_LIMIT_ENABLED` are `"true"`. These are repository settings,
not verified deployed values. Requiring hash matching now fails closed:
`upload_admission_unavailable` at upload issuance, `source_not_admitted` when
resolving an uploaded source for a generation. This seam is not a scanner and
catalog activation does not establish that the public-upload admission gate is met.

## Scope of this set

These six document the Face Filters feature only. They are not the project's
top-level documentation — that is `CONTEXT.md` (vocabulary), `CLAUDE.md`
(standing rules), `docs/adr/` (decisions) and `docs/PHASE-1.md` (money spine
plan). Where this set repeats a rule from those, those win.

Track B (media authenticity) has its own decision record in
[ADR-0025](../adr/0025-media-authenticity-provider.md), status *Proposed* as of
2026-10-08. Do not start Track B implementation from the documents here.

## Where the build has got to

The upload spine (Slices 1-4, #187) is implemented in
`packages/adapters/r2.js`, `app/api/v1/uploads/route.js`, `lib/uploadSource.js`,
`lib/resolveSource.js` and `lib/generationSources.js`. Sources use an owned
`source_key` or slot descriptors; the gateway resolves and inspects the bytes,
then supplies the provider URL. A source requires `consent: true`; the server
records wording version `aup-2026-09-26` (0096 and 0146).

Slice 0's September timings and missing request-id evidence remain in
[IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). Migration 0357 now records
2026-10-20 billed evidence for A1/A2/A4/A5 at $0.04 each, superseding the old
blanket “prices unread” status. A3's pinned-payload billing remains unverified.
Slice 5 is complete for A1-A5 only. Slice 9's four-row activation is merged;
production application not verified from the repo. The reported successful
manual apply-migrations dispatch is not a production catalog read.

Slices 6-7's proposed `ModeToggle`, `UploadZone`, `BeforeAfter` and Library source
thumbnail are not implemented. The existing Studio per-slot upload field and
Tools directory serve the models; there is no Transform mode. A completed
output appears automatically in Library through `lib/falWebhookHandler.js` and
`job_stored` (0077); there is no extra save-to-Library request. Uploaded originals
are not available through job or asset reads.

Slice 8 is partial: `lib/uploadSweep.js` runs on the five-minute cron. Abandoned
uploads are eligible at 24 hours; consumed sources are removed on subsequent
runs after a terminal job, with a 16-minute job-age guard to outlive the PUT URL.
This is scheduled cleanup, not an exact deletion deadline. Account-closure
cleanup of uploads remains unverified.

A7/A8 remain blocked by PRD §6; the general attestation and provider safety
settings do not establish those gates. Track B verdicts remain unimplemented;
ADR-0025 is Proposed (existing provenance does not provide authenticity verdicts).
`tests/faceFilters.test.mjs` covers the staged rows, activation predicate,
selectors, fixed payloads and Tools grouping; `tests/uploadAdmission.test.mjs`
covers the flag and admission seams. Neither proves production activation,
matcher enrollment or real billing for A3's pinned canvas.
