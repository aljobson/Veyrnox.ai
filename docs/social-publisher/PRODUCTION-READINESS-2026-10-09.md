# Publish production readiness — 9 October 2026

Status update, 10 October 2026: the owner explicitly requested merging #749 before Google data-access approval. The earlier blocking-gate notes below are historical. Branding is verified; the Unlisted demo and scope justification have been submitted. Google still reports data access under review. Public activation does not constitute Google approval and retains the unverified-app warning and unverified-user cap.

## Prepared release

Enable Publish and basic analytics on production, with YouTube as the sole released network. Calendar remains enabled. Device uploads, posting insights, extended networks and additional provider-consent scopes remain off. The first slice uses videos already available in the generation library. Weekly batch drafting/approval remains unavailable for the restricted platform release. No paid Publish billing is activated.

## Production evidence

- Production Supabase: `xdxdzmsztyzbnzeforxx`.
- All 13 public `social_*` tables have RLS enabled and forced.
- All 38 matching public social functions deny EXECUTE to anon/authenticated. The 36 service entry/helper functions permit service_role; internal `settle_social_post` and `social_fail_inactive_targets` intentionally deny direct service execution.
- The live account-connection function retains the free one-account constant and concurrent-callback advisory lock.
- Production social accounts and post targets are empty. No existing queue is being changed.
- Observed live Worker version `c11b3ea5-99e1-4756-a77c-501ee06aa5a9` has Publish/analytics off and released networks `youtube`. Re-read before activation; other production work continues.
- Secret names confirm production YouTube client ID/secret, OAuth state signing, token encryption, media proxy and R2 credentials exist. Secret values were not retrieved. Presence does not prove credential validity.
- Live cron registration is confirmed as `*/5 * * * *` in the production Cloudflare dashboard. Ten displayed executions from 17:55:59 through 18:41:06 UTC on 9 October succeeded.
- The production `publish_sweep` heartbeat independently confirms `last_ok=true` and matching attempt/success at 18:41:07 UTC. The queue is empty; this proves the sweep runs, not a real upload or analytics collection.
- After explicit approval for one 9-credit generation, the signed-in owner's blue-cube test video reached STORED: job `b376c000-eae8-4105-b6b1-f5773264cc7e`, MP4, 225,544 bytes. Balance moved from 10 to 1 credit. No other users' media were accessed.
- The live authenticated asset endpoint returned 200 and its signed production R2 URL returned 206 with `Content-Range: bytes 0-225543/225544`. Chrome decoded 1366×768 video, duration 5.875 seconds, readyState 4, with no media error. This validates owner source delivery and byte-range reads; it does not exercise a YouTube upload or token renewal.

## Google production setup

Project `veyrnox-publish-production` (41641120885), separate from staging. YouTube Data API v3 enabled. Web client callback is `https://veyrnox.ai/social/connect/callback/youtube`. Scopes match the adapter: `youtube.readonly`, `youtube.upload`. Branding uses Veyrnox Publish, support@veyrnox.com and production homepage/privacy/terms URLs.

Production Cloud Console quotas checked under support@veyrnox.com on 9 October: video uploads 100/day and 100/minute; queries 10,000/day. All displayed usage was zero. No quota increase was requested. These are provider limits, not a guarantee of application throughput or verification approval.

Google OAuth audience is External / In production; this is not verification approval. Search Console confirmed domain ownership for support@veyrnox.com using the approved Cloudflare TXT record at approximately 17:38 UTC on 9 October. Keep the record. Google branding reported the domain not registered to the account before verification and explicitly required waiting 24 hours before retrying. Retry no earlier than 17:39 UTC on 10 October (18:39 UK).

## Blocking gates

1. Retry branding verification after the propagation interval; obtain branding approval/publication, then complete sensitive-scope verification. The demonstration recording and its accessible URL are not yet prepared. Scope justification draft exists locally, but no verification submission has been completed.
   Public disclosures are complete: PR #757 squash-merged as `1a75ff5fc737320e565d1f24c31ea070de00d67a`. Production deployment run `37978982569` passed, including live smoke checks. Chrome verified the public homepage's Veyrnox Publish section and the linked YouTube privacy section on 9 October at approximately 19:22 UTC. The policy explains consent, channel/statistics data, encrypted tokens, selected-video transfer, disconnect and retention, and Limited Use. These disclosures do not constitute Google approval.
2. Confirm project quota and any applicable YouTube approval conditions. The current [videos.insert documentation](https://developers.google.com/youtube/v3/docs/videos/insert), checked 9 October, states unverified API-project uploads are not automatically restricted to private mode. Do not treat the older private-upload assumption as current policy or infer project approval from staging results.
3. Source-media delivery, byte-range reads, live cron registration and the Publish sweep heartbeat are verified. End-to-end provider delivery remains part of post-activation acceptance below.
4. Review/approve this concrete activation PR after CI/build checks pass and the preceding gates are resolved. Squash-merge and use deploy-production.yml, with its smoke checks and rollback.
5. Perform real production-account acceptance: connect, denied consent, analytics, disconnect/reconnect and token renewal; then separately approve exact video/title/description/channel/visibility for Post now and Schedule post. No production social account is connected yet. No public video was posted during preparation.

## Validation

- 360 Publish and brand tests pass (provider/database responses are stubbed).
- Full local unit suite: 2,328 pass, 1 skipped, 0 failures. The initial PR CI failure was the old production-off assertion; the release test now checks YouTube-only activation and that uploads/extended scopes remain disabled. CI and the Cloudflare build pass on `9f80d4fa7e1e396d4f505f36be364d845de54db9`; this documentation update requires its own current-head checks before merge.
- Security package type checking passes.
- Lint: 0 errors, 74 warnings on the current checkout.
- Production-identity Next.js and OpenNext Worker builds pass, including verification of all 10 Video Enhance assets.
- Wrangler production packaging dry run passes; this did not upload or deploy the activation.
- Live Publish accounts API returns 503 while the feature remains off.
- Earlier direct schedules API authentication/inspection problems were resolved by reading the production Chrome dashboard and database heartbeat. No trigger change was needed.
- The live media proxy rejects an invalid token with 404 `invalid_or_expired_token` and no-store headers, rather than exposing an object or returning a configuration error. This does not prove valid-token delivery; the YouTube sweep uses presigned R2 GETs and Range requests instead.

## Rollback

Revert the two activation flags through the normal production workflow. Turning Publish off does not cancel already queued posts: use the supported cancellation path after checking claim/provider state. Preserve credentials, database data and ownership TXT record.

## Latest pilot acceptance

The production pilot is provisioned through a Worker secret with public Publish
still disabled. Migration 0241 is applied with the approved 0238–0241 batch.
The approved YouTube tester connected successfully; the owner-selected Tokyo
alley video was uploaded with Private visibility. Studio confirmed Private,
and the worker recorded published, one attempt and no error after processing.
Google branding is verified and published. Sensitive-scope verification is
still pending the actual English consent/use recording and reviewer URL.

Deployment secret-loss protection is prepared in #775 and pilot analytics
collection in #776; neither is claimed deployed in this record. Analytics,
refresh, scheduling and disconnect acceptance remain to complete. Earlier
evidence in this document is historical and does not supersede these results.
This activation PR remains draft until Google data-access approval and the
remaining acceptance checks are complete.


## Owner-authorized activation, 10 October 2026

The owner explicitly requested merging #749 while Google review is pending. Reviewer demo: https://youtu.be/nSokLHt_C3Q (Unlisted). Google confirms receipt; homepage and branding complete, remaining review stages in progress. PRs #775 and #776 are merged and deployed. Production private upload and live analytics succeeded; disconnect/reconnect preserved post history. Scheduling and token refresh have not been claimed as fully verified end to end. The earlier draft-only instructions are superseded by this owner authorization. YouTube is the only released network.
