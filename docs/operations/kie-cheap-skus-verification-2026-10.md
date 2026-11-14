# Kie cheap SKUs: staging verification, October 2026

Status: NOT RUN — preparation only, 2026-10-20.
Decision: [ADR-0238](../adr/0238-kie-cheap-skus-staged.md).

No provider call, activation or database migration was performed by the builder.
Unit tests use active in-memory catalog fixtures and fake networking. They are
not staging evidence. Record a staging job id, date, provider receipt, billed
credits, artifact and ledger evidence for every item below before activation.
Do not record credentials, signed URLs or private customer data here.

For each of `kling-3.0-i2v-720p-kie`, `seedance-2.0-mini-kie`,
`wan-2.6-flash-i2v-kie` and `seedream-5-flash-kie`:

- [ ] **NOT RUN:** Replay all migrations on a throwaway local database; verify
  four inactive rows and run `kie-cheap-skus-catalog.acceptance.test.ts`.
  Immediate replay and replay after fixture activation/repricing preserve values;
  unrelated catalog rows remain unchanged. Verify the real spend calculator.
- [ ] **NOT RUN:** Use separately authorized staging fixtures to submit through
  the generation gateway at the pinned tier; authenticate provider callback
  lookup and complete the job. Capture the submitted supplier model and pins.
- [ ] **NOT RUN:** Compare provider billed credits/receipt with the expected
  generation total: Kling $0.3500/5s, Mini $0.2050/5s, Wan $0.1000/5s,
  Seedream $0.0162/image. Verify no extra multiplication by billing seconds.
- [ ] **NOT RUN:** Confirm generated media is copied into R2 and the job reaches
  STORED with the expected type, output dimensions and duration.
- [ ] **NOT RUN:** Download/play the stored result from Library using the normal
  customer flow and confirm the output is usable.
- [ ] **NOT RUN:** Exercise an authoritative submission refusal and an
  authenticated provider failure; verify one full refund, including callback
  replay, and no refund on ambiguous submission or retryable storage failure.
- [ ] **NOT RUN:** Inspect ledger debit/refund entries and balance changes:
  Kling 22, Mini 13, Wan 7 and Seedream 1 credit per priced unit. No raw ledger
  writes; reconcile after the run.
- [ ] **NOT RUN:** Exercise every advertised aspect ratio, maximum prompt and
  forbidden tier/audio/negative-prompt controls; refusals must occur before debit.

Model-specific checks:

- [ ] **NOT RUN:** Kling Standard first-frame i2v uses supplier
  `kling-3.0/video` with `mode:'std'`, 720p, `sound:false`, one 5s shot. Compare
  existing Pro endpoint preflight, submission and callback lookup; Pro unchanged.
- [ ] **NOT RUN:** Seedance Mini text-to-video at 720p/5s with
  `generate_audio:false`. **Open question:** compare billed provider credits
  with `generate_audio` on and off in separately authorized provider staging
  probes. The staged gateway contract must continue refusing audio overrides.
- [ ] **NOT RUN:** Wan Flash honors `audio:false` for output and billed tier;
  confirm the $0.10 quote. Probe audio-on separately only if authorized.
- [ ] **NOT RUN:** Wan uploaded and Library sources: accept 256×256 at
  10,000,000 bytes; refuse smaller width/height, unreadable dimensions and larger
  files before debit. Confirm JPEG/PNG/WebP behavior with real stored files.
- [ ] **NOT RUN:** Seedream Flash returns one 1K PNG at the quoted image price.
- [ ] **NOT RUN:** Reviewer approves a separate activation migration after all
  evidence passes; owner approves the apply-migrations workflow (ADR-0023).
