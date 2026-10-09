# Publish production readiness — 9 October 2026

This activation change is a draft. Do not merge until the blocking gates below are resolved.

## Prepared release

Enable Publish and basic analytics on production, with YouTube as the sole released network. Calendar remains enabled. Device uploads, posting insights, extended networks and additional provider-consent scopes remain off. The first slice uses videos already available in the generation library. Weekly batch drafting/approval remains unavailable for the restricted platform release. No paid Publish billing is activated.

## Read-only production evidence

- Production Supabase: `xdxdzmsztyzbnzeforxx`.
- All 13 public `social_*` tables have RLS enabled and forced.
- All 38 matching public social functions deny EXECUTE to anon/authenticated. The 36 service entry/helper functions permit service_role; internal `settle_social_post` and `social_fail_inactive_targets` intentionally deny direct service execution.
- The live account-connection function retains the free one-account constant and concurrent-callback advisory lock.
- Production social accounts and post targets are empty. No existing queue is being changed.
- Observed live Worker version `c11b3ea5-99e1-4756-a77c-501ee06aa5a9` has Publish/analytics off and released networks `youtube`. Re-read before activation; other production work continues.
- Secret names confirm production YouTube client ID/secret, OAuth state signing, token encryption, media proxy and R2 credentials exist. Secret values were not retrieved. Presence does not prove credential validity.
- Live cron registration is confirmed as `*/5 * * * *` in the production Cloudflare dashboard. Ten displayed executions from 17:55:59 through 18:41:06 UTC on 9 October succeeded.
- The production `publish_sweep` heartbeat independently confirms `last_ok=true` and matching attempt/success at 18:41:07 UTC. The queue is empty; this proves the sweep runs, not a real upload or analytics collection.
- Production has 16 non-expired `video/mp4` assets belonging to STORED jobs. Object delivery still requires an authenticated owner check; Chrome was signed out when inspected.

## Google production setup

Project `veyrnox-publish-production` (41641120885), separate from staging. YouTube Data API v3 enabled. Web client callback is `https://veyrnox.ai/social/connect/callback/youtube`. Scopes match the adapter: `youtube.readonly`, `youtube.upload`. Branding uses Veyrnox Publish, support@veyrnox.com and production homepage/privacy/terms URLs.

Google OAuth audience is External / In production; this is not verification approval. Search Console confirmed domain ownership for support@veyrnox.com using the approved Cloudflare TXT record at approximately 17:38 UTC on 9 October. Keep the record. Google branding reported the domain not registered to the account before verification and explicitly required waiting 24 hours before retrying. Retry no earlier than 17:39 UTC on 10 October (18:39 UK).

## Blocking gates

1. Retry branding verification after the propagation interval; obtain branding approval/publication, then complete sensitive-scope verification. The demonstration recording and its accessible URL are not yet prepared. Scope justification draft exists locally, but no verification submission has been completed.
2. Confirm project quota and any applicable YouTube approval conditions. The current [videos.insert documentation](https://developers.google.com/youtube/v3/docs/videos/insert), checked 9 October, states unverified API-project uploads are not automatically restricted to private mode. Do not treat the older private-upload assumption as current policy or infer project approval from staging results.
3. Confirm production generation-library media can be read through the publishing path. Live cron registration and the Publish sweep heartbeat are now verified; R2 secret presence alone is insufficient for media acceptance.
4. Review/approve this concrete activation PR after CI/build checks pass and the preceding gates are resolved. Squash-merge and use deploy-production.yml, with its smoke checks and rollback.
5. Perform real production-account acceptance: connect, denied consent, analytics, disconnect/reconnect and token renewal; then separately approve exact video/title/description/channel/visibility for Post now and Schedule post. No production social account is connected yet. No public video was posted during preparation.

## Validation

- 360 Publish and brand tests pass (provider/database responses are stubbed).
- Full local unit suite: 2,328 pass, 1 skipped, 0 failures. The initial PR CI failure was the old production-off assertion; the release test now checks YouTube-only activation and that uploads/extended scopes remain disabled. Updated CI must still pass before merge.
- Security package type checking passes.
- Lint: 0 errors, 74 warnings on the current checkout.
- Production-identity Next.js and OpenNext Worker builds pass, including verification of all 10 Video Enhance assets.
- Wrangler production packaging dry run passes; this did not upload or deploy the activation.
- Live Publish accounts API returns 503 while the feature remains off.
- Earlier direct schedules API authentication/inspection problems were resolved by reading the production Chrome dashboard and database heartbeat. No trigger change was needed.
- The live media proxy rejects an invalid token with 404 `invalid_or_expired_token` and no-store headers, rather than exposing an object or returning a configuration error. This does not prove valid-token delivery; the YouTube sweep uses presigned R2 GETs and Range requests instead.

## Rollback

Revert the two activation flags through the normal production workflow. Turning Publish off does not cancel already queued posts: use the supported cancellation path after checking claim/provider state. Preserve credentials, database data and ownership TXT record.
