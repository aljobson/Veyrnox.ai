# Face Filters & Media Authenticity — spec set

Six documents covering one feature, not the whole app. Read in this order:

| # | Document | Answers |
|---|----------|---------|
| 1 | [PRD.md](PRD.md) | What gets built, what is deliberately not, and what gates A7/A8 |
| 2 | [TRD.md](TRD.md) | Six technical decisions with their rejected alternatives |
| 3 | [APP-FLOW.md](APP-FLOW.md) | Routes, upload, submit, poll, and every failure path |
| 4 | [UI-UX.md](UI-UX.md) | Tokens, three new components, copy and accessibility rules |
| 5 | [SCHEMA.md](SCHEMA.md) | Auth flow, every table filters touch, R2 key layout |
| 6 | [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) | Ten slices, each with an exit gate |

Rendered with two interactive diagrams (credit ledger flow, generation webhook
sequence): https://claude.ai/artifact/MBM7MwPKeEXuY6T1X6SVdh

## Scope of this set

These six document the Face Filters feature only. They are not the project's
top-level documentation — that is `CONTEXT.md` (vocabulary), `CLAUDE.md`
(standing rules), `docs/adr/` (decisions) and `docs/PHASE-1.md` (money spine
plan). Where this set repeats a rule from those, those win.

## Status

Every document is Draft, 2026-09-18. Nothing here is implemented. Two gates
block Slice 1: no upload path exists (`/api/v1/get_upload_url` is 410 Gone;
`packages/adapters/r2.js` has no presigned PUT), and no candidate fal endpoint
has been called, priced, or verified.
