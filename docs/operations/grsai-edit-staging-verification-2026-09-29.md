# GrsAI Nano Banana Pro Edit staging verification — 29 September 2026

## Deployment

- Source: merged PR #394, `1f2a4d0f1dbbd079ec52dd50310808d785d0eee5`.
- Worker: `veyrnox-ai-staging`.
- Deployed version: `026b3bbc-105c-43ac-9837-f325489608dc`.
- Prior version with the newly provisioned GrsAI secret:
  `138c8df3-ce65-4878-a07c-5f45b6fd65c9`.
- All 19 existing plain-text variables matched after deployment. GrsAI secret
  presence confirmed without reading its value. Access and Cinema settings retained.
- Worker build and deployment dry run passed. PR #394 CI and ledger acceptance passed.
- Migration 0165 applied to AI staging (`yrqzwqywxfesmbvhzjgj`), initially inactive.
- Balance and free-credit reconciliation each returned zero mismatches before testing.

## Live acceptance

- Job: `6131d1c9-cc3c-4533-ae2c-b974e7026a4f`.
- Provider task: `7-602f7997-229b-4269-b76e-ee07a6eae2b2`.
- Submitted: 2026-09-29 12:21:29 UTC through the authenticated staging create page.
- Source: synthetic ceramic-teapot JPEG from the earlier Flux test. One owned
  upload, rights attested, fixed 2K tier and 16:9 aspect selected by the UI.
- Prompt: change only the ceramic teapot to cobalt blue; preserve its shape,
  linen, lighting and composition; no text.
- Supplier task log: Success, 71 seconds, exactly 1,800 credits charged
  ($0.027027 at the purchased $5 / 333,000-credit rate).
- Veyrnox ledger: one `debit:generation`, delta -2, free_delta -2. Visible
  account balance changed from 48 to 46. Job inputs retain `source_keys` and
  do not contain `image_url` or its temporary signed URL.

- The normal five-minute scheduled sweep completed the job without a manual
  completion call. State: `STORED`, no error, at 12:25:11 UTC (about 3m42s after
  submission; supplier execution was 71s, with the remainder including polling).
- Asset: `74734a6f-7765-4f2d-afb5-5982d81895f3`; PNG, 2752 × 1536,
  2,001,012 bytes. The 2K designation is the provider tier.
- SHA-256: `16b52871dda5bd8ff300ee4dace85c7f82dea63b52315cbc9fcc88b87827b853`.
  The image downloaded through the authenticated library matched the stored hash.
- Visual inspection confirmed the blue teapot with the source composition,
  lighting and linen substantially preserved. Library showed DONE and AI GENERATED.
- Final reconciliation: zero balance mismatches, zero free-credit mismatches,
  exactly one ledger entry and a net debit of two credits for this job.

## Cleanup and scope

The staging model returned to inactive after the test. The source upload,
generated asset and append-only ledger remain as acceptance evidence, subject to
normal retention. No new API key was created or copied into documentation. No
production activation or production database change was performed.

This verifies one deployed success path including the normal polling sweep,
R2 copy and library download. Failure/refund/replay/storage-retry coverage comes
from PR #394's automated real-handler tests with simulated network boundaries;
no additional paid failure test was run. Production activation remains a separate
guarded migration through the owner-approved workflow.
