# Veyrnox.ai audit remediation — 2026-09-26

These changes address the ten findings from the repository and staging audit.
Application code changes await review and deployment. The separate staging
Cloudflare Access application is created; production remains unchanged.

| Finding | Remediation | Status |
| --- | --- | --- |
| Staging CSP names production Auth | Select the exact Auth origin from the build environment | Implemented |
| Stream adapter uses unsupported Workers redirect mode | Manual redirects with redirect responses rejected | Implemented; exercised in workerd |
| Staging admin rate-limit binding missing | Separate staging ADMIN_EDGE_RATE_LIMITER binding | Configured in source |
| Staging admin Access configuration missing | Separate staging Access application created; own audience in staging vars | Configured; Worker deployment pending |
| Signature-only images pass inspection | Require readable image dimensions | Implemented; bounded metadata checks, not full decoding |
| R2 inspection reads unbounded | Range size, response length, 206/Content-Range and deadline checks | Implemented |
| No cumulative project storage quota | Database-enforced organisation byte, object and pending-upload caps | Migration 0151 |
| Rejected/abandoned assets persist | Leased cleanup with confirmed deletion before quota release | Migration 0151 and Worker cron handler |
| Inspection requests unthrottled | Authorize and consume ten-per-minute actor quota before storage reads | Migration 0151 and inspection API |
| Timestamp-only Cinema pagination skips ties | Timestamp plus title ID cursor, retaining timestamp precision | Migration 0151, API and UI |

## Rollout requirements

- Apply migration 0151 before deploying the API. Verify any preceding migration
  gaps on AI staging first. Production migrations remain subject to ADR-0023's
  protected workflow and owner approval.
- No flags, cron schedules, production configuration or hosted databases were
  changed by this remediation. PR #352 handles staging Cinema activation.
- Cleanup requires project APIs enabled, staging R2 credentials and a scheduled
  trigger. This change adds the handler, not the cron schedule. Until those
  prerequisites are present, cleanup does not run.
- Staging Access application `2e23f05d-0385-415f-b88c-196c3822086f` covers
  `/app/admin*`, `/api/v1/admin/*` and `/api/admin/*` on the staging Worker
  hostname. The owner confirmed the existing admin policy for
  `support@veyrnox.com` and `al.jobson@21stclick.co.uk`. Its separate audience
  is recorded only under staging vars. No production policy was edited.
- Perform authenticated staging smoke checks after migration and deployment.
  No live media upload, provider spend, production deployment or unrelated
  Supabase project access is part of this remediation.

## Validation

Fresh local PostgreSQL replay passes all 144 migrations, including 0150 from
main and 0151. Fourteen project-asset integration checks and Cinema publication
checks pass, including inspection throttling, cleanup retry leases, stale-claim
rejection, storage limits and equal-timestamp pagination. All 238 ledger
acceptance tests pass with Node and PostgreSQL set to UTC, matching CI. The
initial local ledger run exposed an existing DST-dependent assertion with the
Europe/Madrid timezone; no ledger code was changed.

Lint reports no errors and nine existing warnings. Security type checks and the
80-module client credential boundary check pass. The Stream adapter regression
also constructs its requests in the actual Workers runtime.

After incorporating main, the unit suite passes 770 tests with one existing
skip. The staging Next/OpenNext Worker build also passes.

Anonymous HTTP checks after creating Access: all three admin route families
redirect (302) to `fancy-lake-7c60.cloudflareaccess.com`; `/app/projects`
continues returning 200. Authenticated admin acceptance awaits the Worker
configuration deployment and an operator session.
