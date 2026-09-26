# Veyrnox.ai audit remediation — 2026-09-26

These changes address the ten findings from the repository and staging audit.
Application code commit `da374b5` is deployed to AI staging; the PR remains
open for review. Staging Access is configured; production remains unchanged.

| Finding | Remediation | Status |
| --- | --- | --- |
| Staging CSP names production Auth | Select the exact Auth origin from the build environment | Implemented |
| Stream adapter uses unsupported Workers redirect mode | Manual redirects with redirect responses rejected | Implemented; exercised in workerd |
| Staging admin rate-limit binding missing | Separate staging ADMIN_EDGE_RATE_LIMITER binding | Configured in source |
| Staging admin Access configuration missing | Separate staging Access application created; own audience in staging vars | Configured and deployed to staging |
| Signature-only images pass inspection | Require readable image dimensions | Implemented; bounded metadata checks, not full decoding |
| R2 inspection reads unbounded | Range size, response length, 206/Content-Range and deadline checks | Implemented |
| No cumulative project storage quota | Database-enforced organisation byte, object and pending-upload caps | Migration 0151 |
| Rejected/abandoned assets persist | Leased cleanup with confirmed deletion before quota release | Migration 0151 and Worker cron handler |
| Inspection requests unthrottled | Authorize and consume ten-per-minute actor quota before storage reads | Migration 0151 and inspection API |
| Timestamp-only Cinema pagination skips ties | Timestamp plus title ID cursor, retaining timestamp precision | Migration 0151, API and UI |

## Rollout requirements

- Staging migrations 0141–0151 are applied. Production migrations remain
  subject to ADR-0023's protected workflow and owner approval.
- No flags, cron schedules or production configuration were changed. Only
  the AI staging database was migrated. PR #352 handles Cinema activation.
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
continues returning 200. Authenticated admin acceptance still requires an operator session.

## Staging deployment — 2026-09-26

Deployed source `da374b555357f568516ba651a44578cda26972c3` directly to
`veyrnox-ai-staging`, version `4c8a59c8-a43f-4160-830a-75253b273004`.
PR #357 was deliberately left open because merging main triggers production.
The previous staging version is `b7131270-1230-40b2-b6a9-0ddacc0aa464`.

Applied the unchanged committed migrations 0141 through 0151 to verified AI
staging project `yrqzwqywxfesmbvhzjgj`. The migration ledger confirms all eleven.
All Cinema tables and project asset tables have ENABLE/FORCE RLS. The four new
0151 public RPCs have an empty search path and their expected restricted ACLs;
anonymous execution is denied. The compound catalogue RPC returns an empty
catalogue successfully. Balance, free-credit and top-up reconciliation each
return zero mismatches. No live business-operation fixtures were created.

The security advisor reports expected no-policy informational findings on
RPC-only tables and the intentionally authenticated inspection quota function
([advisor guidance](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)).
That function verifies `auth.uid()` and live project membership before changing
quota state. Existing anonymous metadata RPC advisories and disabled leaked
password protection remain outside this rollout
([password protection guidance](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection)).

The staging Next/OpenNext build passed. Wrangler's framework auto-detection
failed to preserve a deployment message containing spaces; no upload occurred.
Deploying the built Worker with `--env staging --no-autoconfig` succeeded and
confirmed the staging rate limiter, Access audience and Supabase bindings.

Live smoke checks: `/` and `/app/projects` return 200 with nonce CSP, staging
Supabase only and private/no-store caching; anonymous `/api/v1/workspaces`
returns 401/no-store; all three admin route families redirect to the Access
team domain. No production deployment, flags or cron activation, R2 provisioning,
paid upload or authenticated operator acceptance is claimed. Cleanup remains
inactive until staging R2 credentials and a cron are configured.
