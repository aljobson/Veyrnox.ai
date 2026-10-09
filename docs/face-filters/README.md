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
[ADR-0025](../adr/0025-media-authenticity-provider.md), status *Proposed* as of
2026-10-08. Do not start Track B implementation from the documents here.

## Where the build has got to

**As of 2026-10-08, `main` at `42150476`** (207 commits after the 2026-10-02
snapshot at `38ede60a`; checked against code, migrations, ADRs and
`wrangler.jsonc`, not against production).

Slices 1-4 landed in #187 and the upload spine is in the codebase:

- `presignPutUrl` in `packages/adapters/r2.js`
- `POST /api/v1/uploads`, with `lib/uploadSource.js`, `lib/resolveSource.js`
  and `lib/uploadSweep.js`. Magic-number check (`sniffType`) runs before a
  source is handed to a provider.
- `ALLOWED_INPUTS` carries `video_url` and the filter selectors
  (`makeup_style`, `intensity`, `target_age`, `preserve_identity`)
- Since the snapshot: the Studio uploads a start image straight to R2
  (ADR-0028, accepted 2026-09-22, #217), a job that carries a source must send
  `consent: true` (`consent_required` otherwise; recorded by migrations 0096
  and 0146), uploads are rate limited (ADR-0035, flag on in production) and
  swept at 24 hours, or within minutes once the job finishes. ADR-0044
  (reserved, bounded uploads) is still *Proposed* and
  `UPLOAD_INTEGRITY_ENABLED` is `false` in production.

Slice 0 is partly done: five of eight endpoints submitted real jobs, but fal
returns no cost per call, so `provider_cost_per_unit` still has to be read off
the dashboard. `scripts/.slice0-results.json` is not in the repository
checkout, so the cost reading is **unverified**.

**None of A1-A8 exists in the catalog.** No migration through 0227 mentions a
Track A endpoint, so Slice 5 has not started and nothing is active. Slice 6
(Studio Transform mode with `ModeToggle`, `UploadZone`, `BeforeAfter`) and
Slice 7 are not built; no such component exists in `app/`. What shipped
instead is adjacent: Library images as a start image (`source_assets`, #444),
a `/tools` page for models that start from your own file (#456), and the
existing image-to-image and video-to-video rows (upscale, background removal,
expand, Nano Banana Pro Edit, LatentSync lip sync).

Slice 8 is partly done: the age sweep and the consumed-source sweep exist and
run on the 5-minute cron (`worker.js`). Deletion on account closure is
**unverified** (no code found). Slice 9 (activation) has nothing to activate.

A7 and A8 remain blocked on PRD §6. Of its five conditions, the per-upload
attestation exists in a general form (above); output moderation, a takedown
route wired to the designated agent, shortened face-reference retention and a
published statement are not built. CSAM hash matching (ADR-0025 §8.1, product
plan D1) has no code and no chosen service, and it gates any public upload
surface. Track B (ADR-0025) is still *Proposed*; nothing is built.
