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
CORS change was needed. Real browser-to-R2 transfer was verified below.

## Staging acceptance — 6 October 2026

Migration `0209_social_device_uploads` was applied to staging project
`yrqzwqywxfesmbvhzjgj`. `PUBLISH_UPLOADS_ENABLED=true` was deployed to staging
Worker version `f4147d72-fc63-42f4-911a-97b97d9f60ea`; production remains off.
The deployment preserved the live staging public settings, existing secrets and
five-minute cron instead of replacing unrelated staging settings from the repository.

The real browser revealed a duplicate Content-Type header: XHR appends repeated
values, so `video/mp4, video/mp4` invalidated the R2 signature. The client now sends
the type once. The regression fixture includes the real reservation's Content-Type
header and models XHR's append behavior.

Verified with synthetic PNG and one-second MP4 fixtures in the owner's signed-in
staging browser: direct R2 transfers, completion, previews, automatic selection,
reload and selecting the saved MP4 again. Credit balance stayed at ten; no social
post was created. Reusing the image's signed PUT with the same bytes returned 412.
Text bytes declared as PNG returned 400 and never became selectable; the client
queued that reservation for removal.

All five acceptance reservations were marked deleting and their disposable R2
objects were deleted through the operator CLI. Metadata capacity remains held until
the signed PUT windows expire (latest 06:03:53 UTC), after which the five-minute cron
can release it. The live cron's final release has not yet been observed; the database
and sweep tests cover this ordering. Do not describe manual fixture removal as proof
of automatic cleanup.

Validation: 1,622 unit tests passed, one skipped; all 23 targeted upload tests passed;
the changed client passed lint; the staging Worker build and deploy passed. The
unchanged migration previously passed all 344 database tests and fresh replay of
all 209 migrations in PR #607.
