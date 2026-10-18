# ADR-0134 — Mobile: quick edit (M10 slice 1)

**Status:** Proposed 2026-10-18
**Related:** [ADR-0106](0106-mobile-app.md) (the app); [ADR-0128](0128-mobile-ai-sharing-consent.md) (AI-sharing consent); [ADR-0132](0132-mobile-translations.md) (strings); the M10 plan in `docs/mobile/ROADMAP-2026-10-17.md`

## Decision

A **Quick edit** screen (Home, then `/edit`) lets a person join up to 10 finished videos from their Library, trim each one, put them in order and add captions, then see the price and confirm. It adds no server route and no flag: it sends the same `POST /api/v1/generations` the web's clip editor uses, with `model_id` `clip-edit` and `inputs.clips` (`asset_id`, `in_s`, `out_s`) and optional `inputs.captions.preset`.

## How it works

1. **Videos.** The Library list is filtered to finished videos. Adding one asks for its file link and reads the real length with a hidden, muted player (`LengthProbe`); the app never guesses a length. A video that cannot be read says so and is not added.
2. **Trim and order.** Start and end move in 0.5 s steps, kept at least 0.5 s apart and inside the video. The limits mirror the server's (10 clips, 60 s in total, no empty result) and are checked before anything is sent; the server stays the authority.
3. **Price.** The server's own quote is used: the same request with `confirmed_credits: 0` is refused with the real price (`credit_confirmation_mismatch`, `expected_credits`) and charges nothing. The Review screen shows that number; Confirm sends the same request pinned to it. If the price moved, the new one is shown and the person confirms again. The app never works out a price.
4. **One key per edit.** The idempotency key is kept for the same clips and captions, so the quote and the send are one request and a retry is charged once. It is held in memory only: it does not survive an app relaunch.
5. **Consent.** The AI-sharing sheet (ADR-0128) is asked before the first send, as for Create. A refusal says nothing was sent and nothing was charged.
6. **Errors** are mapped to plain English by code (bad range, too long, different shapes, file gone, captions off, no credits, no connection). Nothing from the provider is shown.

## Amendment 1: the server's length first

The server now reports a finished video's real length (`GET /api/v1/jobs/:id/media-info`, PR #1289, read from the stored file's own headers). Adding a clip calls it first (`fetchClipLength`): no file link, no player, no wait. Any failure (404, 400 not a video, 422 unreadable, 429, 503, offline) or a value that is not a positive number returns nothing and the hidden player reads the length as before. Nothing is charged by this call.

Proved on the simulator against the mock: with a length from the server, only `media-info` was called; with a 422, the asset link and the video were fetched and the player read the length. Not proved: the real route, or the rate limiter's 429 and 503 behaviour.

## Proved, and not

Proved on the simulator against the mock server only: the Home link; the empty state; adding a video and reading its real length (8 s) from a real file; trimming; the consent sheet; the quote screen (3 credits); confirming (one 3-credit charge, then the job screen). Unit tests cover range maths, validation, the request body, the quote and every error code.

Not proved: any real server. The mock's clip-edit rule and price are stand-ins. **Not run:** joining several videos, captions on a device, a video with a different shape, and the 409 repeat-price path against a real server. Reading a length from a real Cloudflare Stream or R2 link was not tried.

## Follow-ups

- A server-side check that the route accepts a Bearer client with no `Origin`, and that `clip_not_video` and `clip_unreadable` come back as listed.
- Stem splitting and slow motion are not in this slice; they need their own routes confirmed.
- New strings are in `docs/mobile/I18N-NEW-KEYS.md` for the localization process (English only until then).
