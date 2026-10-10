# TikTok production setup — 10 October 2026

The TikTok app is created but not approved or released. Production remains
limited to YouTube and LinkedIn. Existing production TikTok credentials have
not been replaced with the new app credentials.

- Organization: Veyrnox, `7694952684033672200`.
- App: Veyrnox Publish — production, `7694954887725778951`, Production Draft.
- Sandbox: Veyrnox Publish verification, `7694959047916800007`.
- Production domain `veyrnox.ai` verified using an additional Cloudflare TXT
  record; the previous TikTok verification record was preserved.
- Sandbox uses the staging website and
  `https://veyrnox-ai-staging.al-jobson.workers.dev/social/connect/callback/tiktok`.
- Sandbox Login Kit and Content Posting API configured with `user.info.basic`
  and `video.upload`. Direct Post and optional analytics scopes stay off.
- Existing Veyrnox logo uploaded to the sandbox; configuration applied.

## Staging ownership proof

TikTok issued `tiktokfwvnBoxpz3ZWurswkdt9XEAhnNmYpCNJ.txt` for the staging URL
prefix. This public verification file is served from `public/`; it is ownership
proof, not an OAuth client secret or an access token. After staging deployment,
verify the exact root URL answers with the unchanged downloaded file, then
complete verification in this sandbox's URL properties.

## Remaining acceptance and release steps

1. Verify the staging URL prefix after this file deploys.
2. Add a consenting TikTok creator account as a sandbox target user.
3. Install sandbox client key/secret only in the staging Worker, with explicit
   approval. Preserve other bindings and verify staging deployment.
4. Connect that creator in Veyrnox staging, then obtain approval for one image
   transfer. Confirm TikTok inbox receipt and Veyrnox delivered status.
5. Record the actual sandbox end-to-end flow; TikTok requires an MP4/MOV demo
   of all requested products/scopes for a first app review. Do not submit an
   unrelated or simulated video as evidence.
6. Complete production icon/configuration and upload the approved demo. Obtain
   approval before submitting the product/scope review request.
7. Once TikTok actually approves the app, install production credentials,
   prepare the network release change, and run controlled production acceptance.

The existing adapter supports one AI-labelled photo in MEDIA_UPLOAD mode.
It delivers a draft to the creator's TikTok inbox; the creator finishes posting
in TikTok. It does not directly publish videos or publicly post automatically.
35 focused TikTok OAuth/adapter/analytics tests passed against stubbed responses;
real TikTok connection and delivery are still pending.
