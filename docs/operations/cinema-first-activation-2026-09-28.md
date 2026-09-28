# Cinema first activation

Owner authorized Cinema activation and signed off the versioned rights, purchase consent, cooling-off and withdrawal/suspension wording in the rollout conversation. On 28 September the owner explicitly waived the project requirement for written Stripe acceptance. This does not represent acceptance by Stripe.

This change enables the master, profile, creator application/content/upload, recovery/removal, publishing and viewing controls. Paid Unlocks, Cinema Pass subscriptions and monetisation remain disabled in this first activation stage. Existing browser preview preferences still gate creator UI. The existing five-minute production scheduler handles upload recovery/removal.

## Before merging

- Provision and verify the owner-designated production Cinema administrator with existing Cloudflare Access and fresh TOTP enforcement. Production currently has no Cinema administrator; support@veyrnox.com has verified TOTP, pending owner designation.
- Complete submission, independent administrator review, and viewer playback acceptance. Staging creator upload, replacement, automatic removal and scheduled recovery have evidence in the staging operational record; these do not prove publication or the production entitlement path.
- Confirm production request-body fix PR #368 is deployed and migrations/reconciliation are current.

## Verification and rollback

After deployment, confirm the public catalogue responds successfully, unauthenticated privileged routes remain denied, and only approved public titles appear. Verify signed playback and private-media denial. Restore these nine controls to false and redeploy to roll back activation; do not delete content or reverse financial data as a configuration rollback.
