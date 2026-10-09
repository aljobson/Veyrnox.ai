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
6. **A finished job's uploads are deleted within minutes.** The 5-minute
   cron (`sweepConsumedUploads`) deletes the `source_keys` of jobs that
   reached STORED, REFUNDED or FAILED in the last 30 minutes. Before this,
   used uploads stayed for the 24-hour age sweep and counted towards the
   10-per-account cap, so a user was blocked after about 10 jobs a day (5 lip
   syncs). The cap and the 24-hour sweep for abandoned uploads are unchanged.

## Amendment 2026-10-09 — a source's length is what a decoder plays

Models that take a user's audio or video are priced for a capped length
(`maxSeconds` in `lib/modelCapabilities.js`), and the provider bills for what
it decodes. `lib/mediaLength.js` read that length from fields that only
describe the file: a WAV's byte rate, an MP3's Xing frame count or first-frame
bitrate, an MP4's movie header. Whoever makes the file writes those fields. A
file could say ten seconds over an hour of audio, pass the cap, and be priced
as short. A fragmented MP4, which is what a browser records, read as 0 seconds.

The length is now taken from the same data a decoder plays from:

- **WAV:** the bytes after the data chunk's header, to the end of the file,
  over sample rate times frame size. The byte-rate field and the data chunk's
  declared size are not read. A compressed format (anything but PCM, float,
  A-law or mu-law) has no fixed frame size and is refused.
- **MP3:** every Layer III frame, counted. The whole file is read for this, at
  most the 20 MiB type cap. A Xing or VBRI count is not read. A Layer I or II
  frame, or a free-format one, makes the length unknown.
- **MP4:** the longest of the movie header, each track header and each track's
  time-to-sample table. Boxes are walked by their sizes, so a `mvhd` that is
  only bytes inside another box is not read. A fragmented file (`mvex`, or a
  `moof` anywhere at the top level), a movie box over 4 MiB, or a table that
  runs past its box is refused.

Refused means `source_length_unknown`, before any debit. Measured on real
files this agrees with ffprobe to within 0.13 s, always on the long side for
MP3 (encoder padding and the Xing frame are counted). A browser-recorded MP4
must be re-saved as a plain MP4 before it can be used.

This closes the length half of the gap only while the stored file cannot
change after it is measured, which is ADR-0044 (`UPLOAD_INTEGRITY_ENABLED`).
Whether a provider bills by decoded length, and what cap it applies itself,
was not measured.

## Amendment 2026-10-10 — refuse a file two readers would decode differently

The 2026-10-09 parsers took a length from what they read, but some files can be
read more than one way: a short measurement here, a long one in the decoder the
provider uses to produce (and bill) the output. Measured against ffmpeg/ffprobe
on crafted files, each case below read under one second here while a decoder
played tens of seconds to ten minutes. The parsers now refuse a structure they
cannot read a single way, before the debit (`source_length_unknown`,
`source_size_unknown`), rather than measure it. Well-formed files are
unaffected.

- **WAV:** a second format chunk (a reader may honour either), a format chunk
  shorter than its fields, a sample size that does not fit the format (A-law and
  mu-law are one byte; PCM and float must carry a real bit depth), and an
  extensible format whose SubFormat is absent or not a fixed-frame PCM, float,
  A-law or mu-law. The block-align field is no longer trusted to set the frame.
- **MP3:** an `ID3` tag header that is not well formed (version bytes `0xFF`, or
  size bytes that are not synch-safe) — a decoder that rejects the header reads
  those bytes as audio — and a file that is mostly bytes that are not frames,
  which a duration-estimating reader would time differently.
- **MP4:** a track with a sample table but no media header; a second sample
  table, or a single one placed off the canonical `mdia → minf → stbl` path,
  where a lenient reader finds a table this one does not; and an edit list that
  is anything but a single plain edit presenting no more than the media holds (a
  replay of several edits, a speed other than 1, an empty edit, or a segment
  longer than the media is refused).
- **JPEG (pixel size):** a marker that carries no length field — TEM, a restart
  marker, or SOI/EOI — before the frame header, or a segment length below two.
  Read as length-prefixed, such a marker moves the walk to wherever the uploader
  placed a second frame header, so the size the cap checks was not the size a
  decoder uses. A real photo has none of these before its frame header.

## Amendment 2026-10-10 — an MP3's length is counted from a stream

Counting every MP3 frame still needs the whole object, but it is no longer held
in one piece. The first ranged read is already in memory for the content and
size checks; the rest is streamed and each chunk is counted and dropped. One
measurement now holds at most one network chunk plus a frame-sized carry (under
2 KiB), not a 20 MiB copy, so the memory one request can demand does not grow
with the file and does not multiply when several measurements run at once in one
isolate. The per-user attempt limit (0113) and the 20 MiB per-object type cap
still bound the rest.

