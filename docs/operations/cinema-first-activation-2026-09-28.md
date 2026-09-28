# Cinema first activation

Owner authorized Cinema activation and signed off the versioned rights, purchase consent, cooling-off and withdrawal/suspension wording in the rollout conversation. On 28 September the owner explicitly waived the project requirement for written Stripe acceptance. This does not represent acceptance by Stripe.

This change enables the master, profile, creator application/content/upload, recovery/removal, publishing and viewing controls. Paid Unlocks, Cinema Pass subscriptions and monetisation remain disabled in this first activation stage. Existing browser preview preferences still gate creator UI. The existing five-minute production scheduler handles upload recovery/removal.

## Before merging

- Verify production browser access with existing Cloudflare Access and fresh TOTP enforcement. The owner designated support@veyrnox.com; PR #371 / migration 0153 provisioned this exact identity through successful apply-migrations run 36403474637. A subsequent production query confirmed role administrator and account_status active. Verified TOTP was a migration prerequisite.
- Complete submission, independent administrator review, and viewer playback acceptance. Staging creator upload, replacement, automatic removal and scheduled recovery have evidence in the staging operational record; these do not prove publication or the production entitlement path.
- Production request-body fix PR #368 is deployed (run 36402044533 succeeded). Migrations through 0153 are applied; reconciliation reported zero across all four drift counts on 28 September. Recheck freshness at activation.

## Verification and rollback

After deployment, confirm the public catalogue responds successfully, unauthenticated privileged routes remain denied, and only approved public titles appear. Verify signed playback and private-media denial. Restore these nine controls to false and redeploy to roll back activation; do not delete content or reverse financial data as a configuration rollback.
