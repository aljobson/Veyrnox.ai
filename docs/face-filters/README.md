# Face Filters & Media Authenticity — spec set

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

## Scope of this set

These six document the Face Filters feature only. They are not the project's
top-level documentation — that is `CONTEXT.md` (vocabulary), `CLAUDE.md`
(standing rules), `docs/adr/` (decisions) and `docs/PHASE-1.md` (money spine
plan). Where this set repeats a rule from those, those win.

Track B (media authenticity) has its own decision record in
[ADR-0025](../adr/0025-media-authenticity-provider.md). Do not start Track B
implementation from the documents here.

## Where the build has got to

Slices 1-4 landed in #187 — the upload spine exists:

- `presignPutUrl` in `packages/adapters/r2.js`
- `POST /api/v1/uploads`, with `lib/uploadSource.js`, `lib/resolveSource.js`
  and `lib/uploadSweep.js`
- `ALLOWED_INPUTS` now carries `video_url` and the filter feature selectors
  (`makeup_style`, `intensity`, `target_age`, `preserve_identity`)

Slice 0 is partly done: five of eight endpoints have submitted real jobs
(`scripts/.slice0-results.json`), but fal returns no cost per call, so
`provider_cost_per_unit` still has to be read off the dashboard. **No catalog
migration until that exists** — which is what keeps Slice 5 shut.

Still ahead: Slice 5 (catalog rows, inactive), Slice 6 (Studio Transform mode),
Slice 7 (before/after and Library), Slice 8 (upload retention), Slice 9
(activation). A7 and A8 remain blocked on PRD §6.
