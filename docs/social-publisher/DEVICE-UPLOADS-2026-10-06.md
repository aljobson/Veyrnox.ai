# Publish device uploads — 6 October 2026

The owner can upload their own media without first generating content. The Publish
composer has an Upload from device control, progress/cancel, previews, automatic media
selection and a reusable uploads list. A social account is needed only to schedule.
There is no credit debit or automatic publication during upload.

Limits: JPG, PNG and WebP up to 20 MiB; MP4 up to 100 MiB; ten files and 200 MiB per
account. Remove unused uploads to recover capacity after the upload link expires.
Files used by drafts, scheduled or in-progress posts must wait until the post finishes
or is canceled. Finished posts retain metadata receipts after their uploads are removed.
Completed uploads remain stored until removed; unfinished uploads expire after 24 hours.

## Activation

1. Merge the change and apply migration 0209 through the normal migration workflow
   (production requires the owner's run approval). Verify staging independently.
2. Check the actual staging bucket permits the exact staging origin, PUT,
   Content-Type and If-None-Match. Preserve existing CORS rules and origin policy.
3. Enable PUBLISH_UPLOADS_ENABLED on staging after the migration. Keep production off.
4. In the owner's browser, upload an image and an MP4, reload and select them again.
   Check that a second PUT to the signed key fails with 412, forged MIME bytes cannot
   complete, and unfinished files never become selectable. Confirm cleanup succeeds.
5. Schedule only an explicit owner-approved post. YouTube currently publishes publicly.

The local browser preview uses test data; it does not prove real R2 CORS or a live upload.
The database acceptance tests verify storage limits under concurrent requests, ownership,
ready-state/media-type checks, dispatch metadata, removal races and cleanup eligibility.
The route tests verify signature headers, completion size/magic checks and private previews.
The temporary preview page is excluded from the PR. See ADR-0061 for the storage design.

Staging bucket CORS was read on 6 October: `veyrnox-ai-staging-media` permits the
exact staging origin, GET/HEAD/PUT, and Content-Type/Range/If-None-Match. No remote
CORS change was needed. Actual browser-to-R2 transfer remains an activation check.
