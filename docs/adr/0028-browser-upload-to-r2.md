# ADR-0028 — The browser uploads start images straight to R2

**Status:** Accepted 2026-09-22
**Related:** [ADR-0027](0027-model-capability-registry.md) (capability registry), CLAUDE.md "Web security" (CSP) and "Object storage (R2)"

## Context

Image-to-video and image-edit models need a start image. The server half was
already built: `POST /api/v1/uploads` signs a 15-minute PUT for one key under
`uploads/{auth_id}/` and one Content-Type, and the generations route resolves
a `source_key` (ownership, magic-number check against the declared type)
before minting the URL the provider fetches. Nothing in the client used it,
so Kling 3.0 i2v was live but unusable from the create page, and Nano Banana
Pro Edit could not be switched on.

The browser could not do the PUT anyway: `connect-src` allowed only `'self'`
and the Supabase project, and the bucket had no CORS rule.

## Decision

1. **Direct PUT, not a Worker proxy.** The upload route was designed so the
   bytes never pass through the Worker. Proxying would spend Worker CPU and
   request-size budget on up to 20 MB per image for no security gain: the
   signature already fixes the key, the type and the expiry.

2. **Widen `connect-src` by our own R2 S3 endpoint only**, both jurisdiction
   hostnames for the one account (`fb18d9f7052afbea5a5e0eae69948af2`), the
   same pair `img-src` and `media-src` already carry. No wildcard, no other
   account, no other vendor. `tests/securityHeaders.test.mjs` pins the list.

3. **Bucket CORS on `veyrnox-ai-media`:** origin `https://veyrnox.ai` only,
   method `PUT` only, header `Content-Type` only. GETs of results stay as
   plain `<img>`/`<video>` loads, which need no CORS.

4. **The create page shows the picker from the catalog.** `/api/catalog`
   publishes `capabilities.media` (ADR-0027); a model with an `image` slot
   gets a start-image field, and a required slot blocks Generate until one
   is chosen. The upload happens on Generate, before the debit, so a failed
   upload charges nothing.

## Consequences

- A page script can now send data to our own R2 endpoint. It cannot write
  without a URL signed by the gateway for that user's own key, and it could
  already read R2 through `img-src`; the exfiltration surface grows only to
  hosts we own.
- Each Generate with an image uploads a fresh copy. The route caps an account
  at 10 unconsumed uploads, and the sweep deletes them after 24h.
- Preview (`*.workers.dev`) origins are not in the CORS rule, so uploads only
  work on the production origin.

## Amendment 2026-09-22 — sizes, lengths, audio and two uploads per job

Models that bill by output size or length arrived (Topaz upscale, Bria
expand, LatentSync, Kling AI Avatar), so an upload's own size and length now
decide whether a request fits its price.

1. **The gateway reads them, never the client.** `resolveSource` reads the
   first 128 KB of an image or audio file (16 bytes of a video, plus ranged
   reads to its `moov` box) and derives pixel size (`imageDimensions`) or
   playing time (`lib/mediaLength.js`: WAV data/byte rate, MP3 Xing/VBRI
   frame count or constant bitrate, MP4 `mvhd`). Anything not in those bytes
   is null, and a model with a cap refuses a null (`source_size_unknown`,
   `source_length_unknown`) before the debit. An MP3 whose cover art is
   bigger than the read is refused rather than estimated.
2. **Caps live on the capability record** (`maxPixels`, `maxSeconds` per
   media slot) and are published in `/api/catalog` so the create page can
   show them.
3. **Audio uploads:** `audio/mpeg` and `audio/wav`, 20 MB each, recognised by
   their signatures (ID3 or an MPEG Layer III frame; `RIFF…WAVE`). The bucket
   CORS rule is unchanged: still `PUT` with `Content-Type` from
   `https://veyrnox.ai`.
4. **Up to two uploads per job** (`source_keys`), one per input field. Two
   uploads for the same field are refused.
5. **`jobs.inputs` stores `source_keys` (field → upload key)**, never the
   15-minute signed URLs, which go only into the provider request.
