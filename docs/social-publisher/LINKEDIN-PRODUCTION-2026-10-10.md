# LinkedIn production readiness — 10 October 2026

LinkedIn is the next integration after YouTube. The existing adapter supports member-profile OAuth and one-image PUBLIC posts. Company Page publishing, video uploads and LinkedIn analytics are not implemented. Do not interpret company app verification as company Page publishing support.

## API readiness

Use supported Marketing API version 202609 for Images and Posts. The previous pinned version 202509 was retired on 15 September 2026. Source: https://learn.microsoft.com/en-us/linkedin/marketing/integrations/recent-changes . Adapter and OAuth tests use stubbed responses; this is not live provider acceptance.

## Provider setup

Existing staging app: Veyrnox Publish — staging, app 266600565. Share on LinkedIn and OpenID Connect products were provisioned. Last recorded company verification failed because the signed-in account could not verify the associated Veyrnox Page. A Page administrator must finish verification. No credentials were recorded as installed in either Worker.

Keep staging callback https://veyrnox-ai-staging.al-jobson.workers.dev/social/connect/callback/linkedin on the staging app. Configure a separate production app for https://veyrnox.ai/social/connect/callback/linkedin and confirm its Page association, products and granted scopes (openid, profile, w_member_social). Install LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET privately as Worker secrets; never put values in source, chat or this runbook.

## Acceptance and activation

1. Confirm provider setup and staging credentials, then connect a designated member account. Check denied consent, account slot limits and disconnect/reconnect.
2. Prepare an existing image and exact caption. LinkedIn posts from this adapter are PUBLIC; obtain explicit approval for the content and destination before any live post.
3. Verify Post now and scheduled delivery, recorded permalink, terminal status and duplicate prevention. Record failures and provider request IDs without tokens.
4. Install the separate production credentials and repeat connection acceptance using the production callback. Release only youtube,linkedin in PUBLISH_RELEASED_NETWORKS after acceptance; do not open other platforms.
5. Merge the activation change by squash, wait for guarded production deployment, then verify the UI and live flags. Keep the Google approval monitor active for YouTube.

Production LinkedIn remains not_released during this preparation. No live LinkedIn connection or post was made.
