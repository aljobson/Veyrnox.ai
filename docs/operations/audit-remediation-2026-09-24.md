# Audit remediation — 24 September 2026

These are prepared changes, not a claim that production has been remediated.
The original observations are preserved in audit-reports/2026-09-24.md. PRs
310–317 have not been merged and migrations 0128–0131 have not been applied by
this task. Stripe is the current checkout provider.

## Finding coverage

| Finding | Prepared change | Remaining closure evidence |
| --- | --- | --- |
| A01 account-cache privacy | #310 account-scoped cache, invalidation and identity boundary | Deployed multi-account logout/refresh/cross-tab smoke test |
| A02 storage budgets | #312 migration 0129 reserves slots and bytes atomically | Approved migration; real R2/browser checks; enable flag |
| A03 mutable presigned uploads | #312 signs length and conditional creation | Verify bucket CORS, File upload, wrong-length refusal and repeated PUT refusal; enable flag; let old URLs expire |
| A04 public reconciliation scans | #311 migration 0128 serves a bounded fresh snapshot | Approved migration and successful trusted cron refresh |
| A05 request body limits | #310 bounds body size and read time before app dispatch | Deployment and normal webhook delivery smoke test |
| A06 response body deadlines | #310 common HTTP/DB/range readers, R2 responses and Fal signing-key reads keep deadlines through full bodies | Deployment; bounded R2 response regression passes |
| A07 refund state | #310 copies refunded status into Credits enrichment | Deployment |
| A08 misleading autosave | #310 labels unsaved drafts honestly | Deployment |
| A09 incomplete billing history | #313 authoritative paginated credit statement and Top-ups | Deployment alongside account isolation; real-account owner-scoping smoke test |
| A10 account controls | #314 account page, password reauthentication, MFA, session revocation | Real email/MFA journey; device-by-device session inventory and automated data export/deletion remain out of scope. Links explicitly request help by email |
| A11 hidden expiry notice | #317 draft removes browser opt-in | Not before 2026-09-25 10:04:10 UTC AND verified clean 24-hour reconciliation window |
| A12 unused tracking persistence | #310 removes attribution capture and clears old values | Deployment and browser storage check |
| A13 shared stale legal date | #314 explicit per-document reviewed dates | Substantive legal/provider review remains separate |
| A14 modal keyboard behavior | #314 modal focus trap, inert background, focus restoration | Local mobile and keyboard checks passed; production smoke test |
| A15 uncached authenticated packs | #310 reuses cached catalog read | Deployment |
| A16 ignored reap mutation failures | #310 checks failed queue mutations | Deployment and monitoring |
| A17 recovery freshness/incidents | #316 migration 0131, heartbeats, snapshot, gated watcher | Approved migration; enable Worker flag; verify heartbeats; enable watcher; operator ownership |
| A18 legacy LemonSqueezy code | Retained pending historical-order decision | Aggregate read found two credited numeric legacy order IDs. Verify provider provenance and refund/dispute obligations before removing callbacks/secrets |
| A19 database advice | #315 migration 0130 adds five FK indexes | Approved migration; rerun advisor. Auth's fixed allocation of 10 connections requires capacity review before growth/compute changes |

## Merge and rollout order

Squash-merge only, recheck current heads and CI immediately before each merge.
Suggested order: #310, #311, #312, #313, #314, #315, #316. #317 stays draft until
its time and reconciliation gate is met. No auto-merge was armed by this task.

The branches were prepared independently on main a059c3. A local integration
branch (`codex/audit-integration`) combines all eight. #316 overlaps earlier
changes: retain both snapshot test commands in ledger-tests.yml, both disabled
flags in wrangler.jsonc, and both request-limit and recovery-health imports in
worker.js. The consumed-upload call must keep `(cfg, dbcfg, opts)` from #312
AND propagate failures from #316. Rebase/resolve #316 after the earlier PRs,
then rerun its CI; do not choose one whole side of those conflicts.

Migrations 0128–0131 must run on main through the owner-approved
apply-migrations workflow. Never apply production DDL from a local SQL client.
0129 and 0131 are dormant until their separate activation steps are met.
Do not turn on either flag just because the schema migration succeeded.

## Validation performed

Combined changes: 600 application tests passed, one existing opt-in test skipped;
238 database acceptance tests passed in an isolated local UTC database; all 124
schema migrations replayed successfully into a fresh database. Both snapshot
transactional suites passed, including repeat application, privilege checks and
stale-data refusal. A mocked combined Worker exercise verified independent task
success and that a reservation-cleanup failure is reported while other cleanup
still runs. Mobile billing and account dialog checks use intercepted API calls;
they do not prove live email, payment or provider behavior.

## Operational checks still required

Owner for each item is the repository owner or their explicitly designated
operator. Record evidence and date in the incident/release record; do not mark a
check complete from repository configuration alone.

- **V01 edge protection:** export/review actual Cloudflare zone rules, rate limits,
  worker routes and alternate hosts. Verify abusive unauthenticated traffic is
  bounded at the edge, and alternate Worker/preview hosts cannot bypass the
  intended controls. Use a staging rule test, not a production load test.
- **V02 recoverability:** verify the backup/PITR tier, retention and most recent
  successful backup. Restore into an isolated project, check reconciliation and
  owner access, measure recovery time and record the achieved recovery point.
  Review R2 lifecycle/retention against database restore requirements. A dashboard
  backup toggle alone is not a demonstrated restore.
- **V03 identity and keys:** inventory service/provider secrets without copying
  values into tickets. Record rotation owners and rehearse rotation in staging.
  Review browser token storage, CSP and device-session management together;
  the account controls PR does not migrate sessions to HttpOnly cookies.
- **V04 provider/payment/legal:** confirm Stripe webhook delivery and supported
  refund/dispute handling in test mode, and confirm the provenance and remaining
  liabilities of the two historical numeric orders before retiring LemonSqueezy.
  Review provider data use, subprocessors, consent and commercial claims with
  the accountable owner. Updating policy date metadata does not settle these.
- **V05 real journeys/performance:** in isolated staging, exercise signup/email,
  MFA, purchase, duplicate webhook, return recovery, generation, failure/refund,
  Library pagination/download/expiry and sign-out on mobile and desktop. Capture
  real timings/Web Vitals and provider receipts. Local mocked tests do not
  replace this; no paid generations or real purchases were made for this task.

## Upload activation proof

After 0129, verify exact-origin R2 CORS permits the signed headers, including
If-None-Match. Use a disposable account/object and the actual browser File PUT:
correct size must succeed; changed size must fail; reusing the URL must refuse
replacement. Verify capacity under concurrent outstanding URLs and that failed
R2 deletion retains its reservation. Record the evidence before a configuration
PR enables UPLOAD_INTEGRITY_ENABLED. Wait at least 15 minutes after deployment
for previously issued weaker URLs to expire. See ADR-0044.

## Recovery activation proof

After 0131, enable RECOVERY_HEALTH_ENABLED in a separate configuration PR.
Verify each required task succeeds and the trusted snapshot refresh runs. Then
set RECOVERY_HEALTH_WATCH_ENABLED, dispatch the watcher and verify its result.
Confirm the on-call operator receives an intentional staging failure; Actions
scheduling is not a guaranteed paging SLA. See docs/operations/recovery-health.md.
