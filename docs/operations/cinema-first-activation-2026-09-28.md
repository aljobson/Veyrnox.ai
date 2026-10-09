# Cinema first activation

Owner authorized Cinema activation and signed off the versioned rights, purchase consent, cooling-off and withdrawal/suspension wording in the rollout conversation. On 28 September the owner explicitly waived the project requirement for written Stripe acceptance. This does not represent acceptance by Stripe.

This change enables the master, profile, creator application/content/upload,
server-mediated transfer, recovery/removal, publishing and viewing controls.
Paid Unlocks, Cinema Pass subscriptions and monetisation remain disabled in
this first activation stage. Existing browser preview preferences still gate
creator UI. The existing five-minute production scheduler handles upload
recovery/removal.

## Before merging

- **Server-mediated replacement is integrated.** PR #379 merged as `f184ece`.
  Controlled live staging acceptance passed on 28 September: a 40,878,277-byte
  video paused at 38%, resumed from confirmed offset 20,971,520 and reached
  ready; a separate incomplete upload paused at 25%, rejected further transfer
  after removal with `upload_removed`, and was deleted by scheduled cleanup
  (`checked:1, removed:1, failed:0`). Browser reservation responses exposed no
  provider grant value. The draft was preserved and the deleted upload retained
  no Stream reference or transfer claim. Legacy exposed grants remain
  quarantined.
- **Production schema is ready.** Owner-approved workflow run `36565296704`
  applied `0163_audit_media_controls`, `0164_cinema_proxy_transfers` and the
  unrelated inactive catalogue migration `0165_grsai_nano_pro_edit_staged`.
  Its ledger check accounted for all 136 applied migrations.
- **The clean window remains a merge gate.** The 24-hour production window
  begins at the successful apply on 29 September 14:02 UTC and cannot pass
  before 30 September 14:02 UTC. Every `reconcile-watch` run in that interval
  must succeed with zero balance, free-credit, Top-up and failed-refund drift.
  Record the final run before marking this PR ready.
- Verify production browser access with existing Cloudflare Access and fresh TOTP enforcement. The owner designated support@veyrnox.com; PR #371 / migration 0153 provisioned this exact identity through successful apply-migrations run 36403474637. A subsequent production query confirmed role administrator and account_status active. Verified TOTP was a migration prerequisite.
- Staging submission, independent administrator publication and authenticated browser playback passed on 29 September. The support account approved synthetic title `ab9ebab8-da24-4780-8e65-92b50ee24906`; the review queue cleared, the title appeared in the catalogue, and the embedded player advanced to 6 seconds of 6. This verifies the support-session viewer path, not anonymous/non-administrator playback or production entitlement behavior.
- Production request-body fix PR #368 is deployed (run 36402044533 succeeded).
  The latest `main` deployment and the production Access redirects for
  `/app/admin/cinema`, `/app/admin/cinema/submissions` and
  `/api/v1/admin/cinema/submissions` were verified on 29 September. The public
  catalogue still failed closed with `503 viewing_not_open`.

Staging signing credentials were installed and the app signing helper produced a
valid HLS request (signed 200, unsigned 401). The support account's replacement
MFA was verified before the publication decision. The visible account menu
confirmed support@veyrnox.com despite its Al Jobson display name. Publication
and browser playback evidence is also incorporated into PR #379. Production
sign-in and a fresh MFA challenge remain deployment acceptance checks.

## Cutover sequence

Cloudflare Stream has one webhook subscription per account and it currently
points to staging. After the clean window passes and before merging this PR:

1. Inspect the current subscription and require the exact staging URL before
   replacing it.
2. Set it to
   `https://veyrnox.ai/api/webhook/cinema-stream` and pipe the returned signing
   secret directly into the production Worker's
   `CINEMA_STREAM_WEBHOOK_SECRET`. Never print or persist the value.
3. Confirm production still answers `viewing_not_open`, then merge this PR by
   squash so the normal production deployment enables the reviewed flags.
4. Run the production checks below. Do not enable Unlocks, subscriptions or
   monetisation as part of this activation.

## Verification and rollback

After deployment, confirm the public catalogue responds successfully,
unauthenticated privileged routes remain denied, and only approved public titles
appear. Verify signed playback and private-media denial. Complete one
server-mediated upload, pause/resume, publication, viewing and removal lifecycle
with production test accounts before broad use.

For rollback, first disable new uploads, proxy transfers, enrollment, content
mutations, publishing and viewing. Keep recovery/removal and the production
webhook active while any production upload is incomplete or deleting. Disable
those workers and consider returning the account-wide webhook to staging only
after the production queue is empty. Do not delete content or reverse financial
data as a configuration rollback.
