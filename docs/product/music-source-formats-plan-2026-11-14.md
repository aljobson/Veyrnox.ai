# Music source formats: FLAC and MP3 (plan, 2026-11-14)

Status: plan only. Nothing here is built. Decisions marked **Owner** need a yes before work starts.

## The problem in one paragraph

A Music song's file is stored in the format its provider returned, and nothing converts it. ACE-Step returns WAV, ACE-Step 1.5 returns FLAC (seen live on staging, 2026-11-14), Stable Audio Cover returns MP3 (we ask for it), and local renders write WAV. Each editing feature accepts only some of those formats, so whether an action works depends on how the current version was made, which the person cannot see.

## What works today (after 0506 and 0510)

| Current version made by | Stored as | Download | Cover, Extend, Replace, Add section, Target stems | Stems, Track add | Local renders |
|---|---|---|---|---|---|
| ACE-Step | WAV | WAV | yes | **no** (MP3 only) | yes |
| ACE-Step 1.5 | FLAC | FLAC (0506) | **no** | **no** | **no** |
| Cover | MP3 | MP3 | yes | yes | **no** (WAV only) |
| Extend, Replace, Add section | WAV | WAV (0510) | yes | **no** | yes |
| Local render | WAV | WAV | yes | **no** | yes |

The SQL gates sit in 0462, 0479–0482 and 0487–0489 (19 checks): `mime_type IN ('audio/mpeg','audio/wav')` for most editing, `audio/mpeg` only for Stems and Track add. Local renders read WAV only (`lib/musicWavRender.js`).

## What the providers accept (public fal schemas, 2026-11-14)

| Feature | Endpoint | Input formats stated |
|---|---|---|
| Stems | `mureka/api/song/stem` | MP3 or M4A, up to 10 MB |
| Track add | `mureka/api/files/upload` | not stated; Mureka's docs elsewhere say MP3/M4A |
| Target stems | `fal-ai/sam-audio/separate` | WAV, MP3, FLAC |
| Extend, Add section, Replace | `fal-ai/ace-step/audio-outpaint`, `audio-inpaint` | not stated |
| Cover | `fal-ai/stable-audio-3/.../audio-to-audio` | not stated |

## Options

### A. Convert once, when the file arrives (recommended)
When a provider returns FLAC, decode it to 16-bit PCM WAV in the Worker before storing, so every Music file is WAV or MP3 from then on. FLAC is lossless, so nothing is lost.

- Unblocks ACE-Step 1.5 for every feature that takes WAV today, and for local renders.
- Cost: a FLAC decoder in the Worker. The Worker is near its 59,000 KiB cap (raised on 2026-11-13); a pure-JS or WASM FLAC decoder adds roughly 30–150 KiB. A 60 s stereo 44.1 kHz WAV is about 10 MB, inside the 20 MiB upload cap used by the source inspector.
- Download: 1.5 songs would then download as WAV; the FLAC option from 0506 would only apply to files stored before the change.
- **Owner**: is storing WAV for 1.5 (about 1.7× the FLAC size) acceptable for R2 cost?

### B. Accept FLAC as an editing source, per provider
Add `audio/flac` to each gate only after a one-off live run proves that provider takes FLAC. Target stems is documented as accepting it; the ACE-Step and Stable Audio endpoints are not.

- No decoder, no bundle growth.
- Cost: one paid staging run per provider (about 2–4 credits each), and local renders still cannot read FLAC.

### C. Stems and Track add on WAV sources
Mureka takes MP3 or M4A only. Making Stems and Track add work on WAV versions needs an MP3 or M4A encoder in the Worker (larger than a decoder, and lossy), or an encoding step at a provider.

- **Owner**: is "Stems and Track add work only on Cover outputs" acceptable for launch? If yes, the dialog should say so and the action should be hidden on other versions, instead of failing at the quote with `format_unavailable`.
- Today the song page has no control to make a Cover version current, so in practice these two features are reachable only right after a Cover.

## Recommended order

1. **Now, small:** hide Stems and Track add on versions that are not MP3, with a line saying they need an MP3 version (Cover makes one). Removes the dead end.
2. **Decide:** option A or B for ACE-Step 1.5.
3. **If A:** pick a decoder by size and licence, measure the Worker bundle, add the decode in the fal webhook path for `ace-step-1.5` only, and prove it on staging with one 1.5 generation (6 credits).
4. **Later:** option C only if Stems and Track add on generated songs matters for launch.

## Related follow-ups found on the way

- Replace: paid takes are stranded if the dialog closes before a take is committed. The version list needs a "use this take" control, and the song data needs each take's generation request id. UI work, needs the design goal criteria.
- Track add: if fal rejects the upload at submit, the 6-credit track debit waits 15–25 minutes for the stuck-job sweep instead of being refunded with the upload.
- Target stems: WAV versions between 20 and 25 MiB are refused at quote with a duration error, although Music stores WAV versions up to 25 MiB.
- Publish: any unique-key clash returns `HANDLE_TAKEN`, including an idempotency-key race.
