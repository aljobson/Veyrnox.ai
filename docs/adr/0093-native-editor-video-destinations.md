# ADR-0093: native editor video destinations

## Decision

Implement real video transport for Instagram Reels, Facebook Pages and TikTok inbox delivery through the existing owned Social Upload/generated-asset and explicit Publish scheduling flow. `PUBLISH_VIDEO_DESTINATIONS_ENABLED` is a separate server opt-in and stays false in production and staging until qualified; it does not enable uploads, release networks or grant provider permissions. The browser receives deployed media capabilities rather than inferring readiness from a logo. Native video is advertised only with the exact opt-in, an HTTPS public host without credentials, port or fragment, and a nonempty media-proxy secret; the secret is never returned to the browser. YouTube retains its existing independent path.

Instagram Login uses the existing `instagram_business_basic` and `instagram_business_content_publish` permissions. Create a REELS container from our signed media proxy, checkpoint its ID, poll `status_code`, and publish only after FINISHED. Persist the existing service-only submission marker before `media_publish`. An already PUBLISHED container without a saved post ID, or any lost publish response, requires reconciliation rather than another public post. A confirmed ID may survive an unavailable permalink read.

Facebook uses a selected Page token with CREATE_CONTENT/MANAGE and the existing `pages_show_list`, `pages_read_engagement`, `pages_manage_posts` permissions. Mark before the `/videos` `file_url` request, checkpoint the returned video ID and poll the documented VideoStatus ready confirmation after an accepted `published=true` request. An unknown submission is never resent. Worker scheduling controls when the initial request occurs; provider-side scheduling, ads and paid boosts are outside this change.

TikTok uses the current approved-mode contract, `video.upload`, and `/v2/post/publish/inbox/video/init/`. Only `source_info` is sent for video inbox uploads; this endpoint does not accept our photo caption/Direct Post privacy payload. An owned HTTPS proxy URL must be verified in the developer app and remain accessible for the full one-hour fetch window (the proxy covers the bounded two-hour poll window). Completion remains `delivered`, with no invented public permalink. The creator must finish caption, AI disclosure and posting in TikTok. Scheduling means scheduling inbox delivery, not automated public posting. Migration 0287 adds only TikTok to the existing service-only submission marker allowlist, retaining claim fencing and explicit ACLs.

Provider calls use fixed API hosts, validated IDs, bounded timeouts and manual, unfollowed redirects compatible with the Worker runtime. Polls retain their initial timestamp and have a finite outer bound. Fresh video requests fail closed when the opt-in is disabled; accepted continuations can be reconciled without starting another upload. Existing format inspection, rights confirmation, actor-owned media lookup and explicit Post now/Schedule remain required. File-format inspection is not moderation approval; provider processing and content policies still apply.

## Qualification and external gaps

No code or secret presence proves app review, permission grants, verified-domain ownership or actual video acceptance. Instagram requires a Professional Business/Creator account and the appropriate access level/review for customers beyond app roles. Reels require MP4/MOV, front moov/no edit lists, H.264/HEVC progressive 4:2:0, 23–60 fps, width at most 1920, 3 seconds to 15 minutes and platform audio/bitrate bounds. Facebook requires eligible Page access and approved permissions. TikTok requires app approval/user grant for video.upload, verified owned URL prefix/domain and its pending-share quota; video bounds include 23–60 fps, both dimensions 360–4096 and at most ten minutes. Unsupported provider files fail honestly; no silent reformatting is claimed.

TikTok Ads uses a separate Marketing API app and advertiser authorization. This repository has no advertiser account selection, advertiser-scoped token lifecycle, creative-asset persistence or campaign approval model. Organic Content Posting tokens cannot be reused. Advertising is therefore unavailable; no fake advertiser controls or paid action are added. A later reviewed implementation must add those actor-scoped contracts before an upload-asset handoff or campaign creation can be live.

## Sources checked 11 October 2026

- [Instagram Login content publishing](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/content-publishing/)
- [Instagram media/Reels specifications](https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media/)
- [Facebook Page videos reference](https://developers.facebook.com/docs/graph-api/reference/page/videos/)
- [Meta VideoStatus reference](https://developers.facebook.com/docs/graph-api/reference/video-status/)
- [Meta Video API publishing](https://developers.facebook.com/docs/video-api/guides/publishing/)
- [TikTok Upload Video](https://developers.tiktok.com/docs/en/content-posting-api-reference-upload-video)
- [TikTok media transfer](https://developers.tiktok.com/docs/en/content-posting-api-media-transfer-guide)
- [TikTok Marketing advertiser authorization](https://business-api.tiktok.com/portal/docs/marketing-api-authorization/v1.3)

## Verification

On 11 October 2026, 118 focused/native and existing publishing regression tests passed. New coverage includes exact video envelopes, checkpoint/poll progression, finite polling, refused claims and ambiguous responses or lost result checkpoints without duplicate sends. A disposable local migration replay twice, in a rolled-back transaction, passed service-only ACLs, caller-owned upload selection, wrong/null/stale claim refusal, one-time marking, preserved legacy networks and distinct delivered settlement. Browser verification must stop before creating a post. Hosted qualification and the migration/24-hour rollout remain separate from implementation; no provider post, production SQL or paid action is performed during verification.
