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

## Cinema activation — 2026-09-26

After owner approval, local integration branch `codex/staging-cinema-validation`
combined PR #357 with PR #352 (resolved only the staging rate-limiter/cron
configuration overlap). Source `41744d6` deploys as staging Worker version
`cdd6fd77-febf-4b21-afc1-6fb63c93fbdf`. The seven flags from #352 and
`*/5 * * * *` cron are active on staging; production is untouched. The
Next/OpenNext bundle is unchanged from the verified audit deployment.

The existing support account completed Google OAuth successfully, and Cloudflare
Access authenticated the operator through its configured Cloudflare identity.
The admin Cinema page displays the signed-in account and correctly requires
a fresh authenticator check. No authenticator is enrolled, so the owner must
complete credential setup directly before administrator acceptance and creator
approval. No role was granted and no upload or billable test was started.

The creator UI additionally requires the browser-local
`veyrnox_social_cinema` preview preference. Public viewing, publishing, purchases
and monetisation remain off. R2 project-asset cleanup remains unconfigured.

## Staging approver provisioning — 2026-09-26

The owner completed authenticator enrolment and authorized proceeding after the
missing Cinema administrator role was identified. Applied the scoped operational
data migration `staging-cinema-approver-2026-09-26.sql` only to staging project
`yrqzwqywxfesmbvhzjgj`, after a successful transaction rolled back for validation.
The script checks the exact staging user/auth IDs and a verified TOTP factor,
locks the user, rejects incompatible or inactive memberships, and asserts one
affected membership. It is deliberately outside the shared schema runner.

Readback confirms `support@veyrnox.com` has an active Cinema administrator
membership. No public profile or creator role was created. MFA and Access remain
required. The browser now requests a fresh authenticator code because the
five-minute verification window has expired; successful queue access and creator
upload tests remain pending. Production and unrelated projects were untouched.

## Creator onboarding validation — 2026-09-28

The owner selected `al.jobson1@gmail.com` as the separate staging creator.
Google sign-in passed. The first profile POST returned `400 invalid_body`:
the shared body limiter could not reconstruct the framework request in the
Workers runtime. Commit `ed1e425` copies Fetch request fields explicitly instead
of relying on Request branding. Five body-limit regression tests, a local
workerd smoke check, lint and the staging Next/OpenNext build passed.
Deployed staging version `2501de45-919d-42c6-92f1-6358487c5dd0`.

The same browser submission then succeeded: profile `al_jobson_staging`, display
name `Al Jobson — Staging Test`. The creator application was submitted through
the UI and confirmed as waiting for review. No creator role was granted yet;
administrator review and upload lifecycle checks remain pending. Production and
unrelated databases remain untouched.

## Removal and replacement validation — 2026-09-28

The owner approved permanent removal of the six-second synthetic clip attached
to `Cinema upload test — 28 September` (content
`ab9ebab8-da24-4780-8e65-92b50ee24906`). The creator UI accepted removal and
blocked replacement while the original upload was `deleting`. The scheduled
worker claimed it at 07:55:37 UTC. Cloudflare's authenticated account video
inventory then showed zero videos, but the database did not complete removal.

The Stream adapter rejected empty HTTP 200 responses although the provider's
delete API returns void. Commit `ac360b2` accepts empty 200 success and retains
denial of ambiguous 404, auth errors, redirects and unsuccessful JSON responses.
This is a compatibility fix; the original provider response was not captured,
so its precise status/body remains unverified. Twelve targeted tests (including
workerd), lint and the staging build passed. Staging version:
`b6fe0d3f-4eb0-4c64-bac4-aad22863a944`.

After independent provider inventory confirmation, tested the existing
`finish_cinema_upload_removal` RPC in a rolled-back transaction, then reconciled
only upload `7ffba183-a3d1-4add-bb7c-2e605854b717` using its current claim and exact
content/provider IDs. This was manual operator reconciliation, not a successful
automatic deletion-completion test. Old upload readback is `deleted` and retains
its tombstone. The browser unlocked replacement upload. The same synthetic file
(`/tmp/cinema-staging-colour-test-0928.mp4`, 605471 bytes, six seconds, 360×640)
was submitted through the creator UI as a new upload
`348f3e56-fb2f-48fa-9e84-e07243587b80`. No publication was requested.
Browser refresh confirmed replacement processing complete, still private.
Automatic deletion completion after the patch, signed-webhook delivery,
missed-callback recovery and invalidation of a previously copied tus URL still
need distinct live evidence; this result does not claim those checks passed.

### Automatic removal retest — 2026-09-28, 08:55 UTC

With fresh owner confirmation, removed replacement upload
`348f3e56-fb2f-48fa-9e84-e07243587b80` through the creator UI. The scheduler
claimed it at 08:55:37.73265 UTC and completed deletion at 08:55:38.041196 UTC.
Read-only verification confirmed `state=deleted`, null Stream/upload references,
and the original content still present as `DRAFT`. No manual reconciliation or
database mutation was performed for this retest: automatic completion passed.

The browser changed accounts while waiting and subsequently displayed
`An approved Cinema creator account is required`; therefore this retest's final
UI reset was not verified. The previous replacement test already demonstrated
that confirmed deletion unlocks the upload form. Signed webhook delivery,
missed-callback recovery and stale tus URL invalidation remain separate checks.

### Scheduled upload recovery — 2026-09-28, 09:05 UTC

Switched from the administrator back to the approved test creator. Confirmed
the post-deletion UI presented an empty upload form. Uploaded the same synthetic
six-second clip through the UI; new upload
`fcabe0a4-7c1f-4baf-9b70-1134da6bad2e` initially remained `processing`.
No manual Refresh status action was used while awaiting completion (the upload
component performs its normal initial refresh at the end of the transfer).

The scheduled recovery claimed this upload at 09:05:38.071431 UTC, observed
`ready` at 09:05:38.107 UTC and completed its check at 09:05:38.395067 UTC with
`recovery_failed=false`. Dimensions 360×640, duration six seconds. This verifies
automatic recovery independently of manual refresh. A bounded 180-second
Wrangler observation emitted no `cinema.stream_webhook` events; absence of a
captured event does not establish why no callback completed. Signed-webhook
delivery remains unverified. The clip is retained as a private test draft.

### Stream webhook destination correction and live callback — 28 September

The account webhook GET revealed the production destination
`https://veyrnox.ai/api/webhook/cinema-stream`. With explicit owner approval,
changed the account-wide subscription to
`https://veyrnox-ai-staging.al-jobson.workers.dev/api/webhook/cinema-stream`.
Read-back confirmed the destination (modified 2026-09-28 09:23:13 UTC).
A signed probe confirmed the existing staging signing secret matched; no
Worker secret update, deployment, or production database change was required.

A fresh private draft, **Cinema webhook test — 28 September**, received the
six-second synthetic colour clip. Content ID:
`61034c7c-3e39-437e-bc57-04e70af4b04d`; upload ID:
`804d6343-0405-48b0-82c7-b694ebe11cf4`.
Live Worker logging was first verified with an unsigned diagnostic request.
The real provider callback then logged `cinema.stream_webhook`, HTTP 200,
code `ok`, request `b24b7666-2f5d-4007-ab38-cd3c97c6714c`.
Read-only staging SQL confirmed `ready`, observed at
2026-09-28 09:26:31 UTC, with both recovery timestamps NULL. No manual
status refresh or synthetic signed callback was used for this new upload.
This verifies automatic provider callback delivery independently of scheduled
recovery. The test draft and video remain private and retained.

### Live pause/resume validation — 28 September

The six-second clip completed before pause could be exercised; it is not
counted as a pause/resume pass. Temporary browser network emulation was reset
to normal. A larger synthetic test-pattern MP4 (20 seconds, 40,878,277 bytes)
was uploaded to private draft **Cinema resumable transfer — 28 September**,
content `3fc13f06-8910-4603-8c48-68ffb399f855`.
The creator UI displayed 89% progress when Pause was pressed and confirmed
`Upload paused. Select the same file and resume.` Read-only SQL confirmed
upload `9e8b096c-541b-497e-b774-9a407b1b5029` remained `uploading`.
Resume upload with the same selected file completed successfully; the page
confirmed processing complete. Read-only SQL returned exactly one upload for
this content, the same ID now `ready`, observed at 10:07:17 UTC, with recovery
timestamps NULL. No duplicate reservation, manual SQL mutation or publication.
Screenshots: `/tmp/veyrnox-upload-paused.png` and
`/tmp/veyrnox-resume-complete.png`. The test clips remain private and retained.

The remaining distinct live lifecycle check is invalidation of a previously
copied tus upload URL after confirmed removal. Permanent removal needs fresh
owner confirmation at the action.

### Captured tus URL after removal — 28 September (gate unresolved)

Created **Cinema stale upload URL test — 28 September**, content
`c11a95e5-eb5f-45ef-9fb2-da5485c7f58b`, upload
`8878ea62-6bb3-41d2-b788-eba8121927ab`. Captured its original tus URL in
memory; the transfer completed before Pause could be pressed. Before removal,
HEAD returned HTTP 200 with upload offset and length both 40,878,277 bytes.
After explicit owner confirmation, permanent removal was requested through UI.
The scheduler claimed deletion at 10:30:37.956345 UTC and completed it at
10:30:38.331363 UTC. Read-only SQL confirmed deleted state and cleared provider
and upload references. The UI unlocked the replacement upload form.

However, HEAD on the same previously captured URL still returned HTTP 200
with the same offset/length after confirmed deletion. A zero-byte PATCH at the
completed offset returned HTTP 400. That rejection is inconclusive: a completed
upload/empty PATCH can itself be rejected, independently of deletion. Do not
claim bearer-grant revocation passed, or infer that video data can be restored.
The remaining gate needs a paused, incomplete tus grant with a known-valid
remaining chunk, tested after deletion. No wider upload enablement or production
promotion follows from this result. URL values were not printed or saved to a
regular file; temporary FIFO pipes were removed after each diagnostic request.
