# TikTok first-review demo

TikTok requires the first review to demonstrate the real sandbox integration
on the domain in the submitted website URL. The production application is
7694954887725778951; its verification sandbox is 7694959047916800007.
The submitted website is https://veyrnox.ai. A workers.dev recording does not
meet the domain requirement. Manual posting through TikTok Studio does not
demonstrate Veyrnox's Content Posting API integration.

## Restricted sandbox on the production website

The public release list remains `youtube,linkedin`. The review pilot is closed
unless all of the following server secrets are installed:

- `TIKTOK_REVIEW_ENABLED`: exactly `true`.
- `TIKTOK_REVIEW_AUTH_IDS`: the explicitly approved tester's verified Auth UUID.
- `TIKTOK_REVIEW_CLIENT_KEY` and `TIKTOK_REVIEW_CLIENT_SECRET`: the existing
  verification sandbox credentials, kept separate from production credentials.

The review subject can connect TikTok, upload owned media and queue a transfer.
Other subjects cannot open TikTok or bypass disabled public device uploads.
Middleware verifies JWT identity before these routes, overwriting caller-supplied
identity headers. Existing ownership, limits and upload integrity checks apply.
Only `user.info.basic` and `video.upload` are requested; analytics and Direct
Post are excluded. A publicly released TikTok network always uses the production
client, even if review secrets are still present.

Review tokens have a bytea-compatible envelope around the existing encrypted
token. The envelope survives rotation and selects only sandbox credentials for
refresh, even after pilot closure or public activation. A mixed token pair or
missing sandbox credentials fails closed. No database migration is required.
TikTok photo dispatch rejects PNG, GIF and missing MIME metadata before provider
submission; use a verified JPEG or WebP. Native video dispatch is unchanged.

Before activation, read back existing production TikTok accounts and outstanding
targets. Do not mix connections from different apps. Obtain owner approval for
the exact tester, credentials installation and sandbox production callback.
Install the secrets without putting values into source, shell arguments, logs,
screenshots or the recording. Confirm both non-tester denial and tester readiness
on the running production app before recording.

Configure the sandbox website as https://veyrnox.ai and add
https://veyrnox.ai/social/connect/callback/tiktok to its Login Kit redirects.
Preserve staging's existing callback. Verify veyrnox.ai as a media domain in
the sandbox as well as in the production draft.

## Actual recording

Record the real Chrome window, including the address bar; exclude other windows
and notifications. Never substitute staged screenshots for actual interaction.
Keep each MP4/MOV below 50 MB. Hide credentials, signed media links, authentication
codes and unrelated account information. Pause recording during login if needed.

1. Show https://veyrnox.ai/app/publish and the available TikTok connection.
2. Start sandbox OAuth and show requested identity and inbox-upload permissions.
   The tester personally completes any new consent or security challenge.
3. Return to Veyrnox and show the connected creator's display name and avatar.
4. Select the approved JPEG/WebP, enter the approved demo caption, and show that
   TikTok delivers a draft to its inbox for the creator to finish.
5. Send exactly one inbox test using the normal composer. It spends no generation
   credits and must not automatically publish publicly.
6. Show the queued/processing state and then `delivered — finish in TikTok app`.
   Cron may take multiple five-minute ticks; wait for the real result.
7. Show TikTok Platform's notification that content from Veyrnox is ready. If the
   creator can display the phone draft, include that real completion UI too.
8. Show Veyrnox's disconnect control; reconnect afterward only if needed.

Inspect the finished recording for leaks and missing steps before upload. Upload
it into the prepared production draft, save the form, and submit for review only
after reviewing the final terms/attestations. Read back the submitted status.
Submission is not approval. The earlier public photo on @flav4636 was manually
posted through TikTok Studio and cannot stand in for this demo.

## After review

Keep TikTok out of public release until approval is explicitly confirmed. Once
accepted, close `TIKTOK_REVIEW_ENABLED`, disconnect the sandbox account, and let
outstanding sandbox targets settle before retiring sandbox credentials. Install
the production app credentials, reconnect with production consent, then perform
a controlled production inbox delivery before adding TikTok to the release list.

Requirements: [TikTok App Review Guidelines](https://developers.tiktok.com/docs/en/app-review-guidelines).
