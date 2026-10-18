# Cinema playback on mobile: what the code says (M9 spike, part 1)

**Status:** 2026-10-18. Read from `origin/main`, nothing run on a device. Part 2 (a real token against a real title, on a simulator and a phone) is still to do and is marked **not proved** below.

## What the server gives a native client

- **Anonymous catalogue:** `GET /api/cinema/titles?limit=&before=&before_id=&category=` returns `{ titles, categories, next, next_id }`, 24 per page by default, 50 at most, cursor by `published_at` plus id. `GET /api/cinema/titles/:id` returns one title. Cached publicly, no sign-in. Posters: `/api/cinema/posters/:id`.
- **Per-viewer title read:** `/api/v1/cinema/titles/:id` (Bearer) adds what this viewer may watch, episode by episode.
- **Playback token:** `POST /api/v1/cinema/play` with `{ content_id }` (Bearer, JSON). It returns `{ token, customer_code, expires_at, watch_session_id?, content_id }`. The token is an RS256 JWT bound to one Stream video uid, valid 15 minutes (`PLAYBACK_TTL_SECONDS = 900`, `lib/cinema/stream.js`). Only an entitled viewer gets one. Errors: `locked` (with `reason`: `free_ceiling` or `pass_ceiling`), `not_ready`, `content_not_found`, 503 `unlocks_not_open` or `playback_not_configured`, 429 `rate_limited`.
- **Heartbeat:** `POST /api/v1/cinema/play/heartbeat` with `{ content_id, seconds }` (1 to 60). The web sends it roughly every 30 s of visible playback. The server uses it for the free monthly ceiling and Pass metering; a `free_ceiling` or `pass_ceiling` reason in the answer means stop playback.
- **Audience signal (optional):** `POST /api/v1/cinema/audience` with `{ action: 'watch', session_id, ...ranges }` and an `idempotency-key` header, built from `watchCoverage` (full-second ranges, no seeking, at most 60 s per send). A failure must not stop playback.

## How the web plays it, and what that means for native

The web page sets an iframe to `https://customer-{customer_code}.cloudflarestream.com/{token}/iframe?preload=true` and drives it with Stream's JavaScript SDK (`window.Stream`) for `currentTime`, `paused` and media events. Renewal: mint a new token about 3 minutes before `expires_at` and resume at the saved time.

For a native player the same signed token can stand in for the video id in Stream's manifest path: `https://customer-{customer_code}.cloudflarestream.com/{token}/manifest/video.m3u8` (HLS). **Not proved:** I found no use of the manifest path anywhere in this repo, so whether this account's signed tokens work against it, and whether `expo-video` (AVPlayer on iOS, ExoPlayer on Android) plays it, needs a device test. Fallback if HLS fails: a `react-native-webview` loading the `/iframe` URL (works the same as the web page; costs a web view per player and a bridge for time and pause events).

## What this means for the feed

1. **One active player.** A vertical feed should hold one player, load the next title's manifest only on scroll settle, and never mint tokens for items that are merely on screen: each mint is a metered server call (rate limited, 429 `rate_limited`).
2. **Renewal during playback** has to swap the source without a visible gap: save position, mint, replace source, seek, resume.
3. **Metering is client-reported.** The heartbeat and audience calls must count only visible, playing time (pause on background, on seek, on screen off), or free-ceiling numbers drift.
4. **Free viewing only today.** Production has `CINEMA_VIEWING_ENABLED` and the free ceiling on, `CINEMA_UNLOCKS_ENABLED` and `CINEMA_SUBSCRIPTIONS_ENABLED` off. In that mode `play` serves free titles only and answers 503 `unlocks_not_open` for anything else. Paid unlocks and the Pass on mobile need an in-app purchase decision first (roadmap M12), and Apple 3.1.1 applies to any digital content unlock.
5. **Not signed in:** the catalogue is public but `play` needs a Bearer token, so signed-out users can browse and must sign in to watch.

## To prove before building the feed (part 2)

- Mint a token for one free title on staging and open `https://customer-<code>.cloudflarestream.com/<token>/manifest/video.m3u8` in `expo-video` on an iOS simulator and on an Android device. Record the result here, including startup time and whether a renewed token swaps cleanly.
- Confirm `playback_not_configured` does not occur on staging (needs `CINEMA_STREAM_SIGNING_*` and `CINEMA_STREAM_CUSTOMER_CODE` set there).
- Decide the feed source: `/api/cinema/titles` pagination as is, or a per-viewer `/api/v1/cinema/titles` call for access state per episode.
