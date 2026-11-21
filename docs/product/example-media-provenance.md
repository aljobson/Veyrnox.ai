# Creative feature example media provenance

Stage A1, created 2026-11-21. These five stills are original Veyrnox compositions, generated locally with no third-party media. No network downloads, provider/model calls, credit spend or dependency installs were used for this stage. The dark palette and mint accent follow `app/globals.css` (`--vx-base`, `--vx-panel`, `--vx-border`, `--vx-fg`, `--vx-accent`).

| File | How made | Tools | Date | Rights | Dimensions | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| `public/examples/ai-avatar-generator.webp` | Locally cropped and framed the existing fictional Mara portrait with original geometric orbit lines. Source: `public/avatars/fictional/mara.png`; provenance below. | Python 3, Pillow 12.3.0 (ImageOps, ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 34,646 |
| `public/examples/text-to-speech.webp` | Original abstract text lines, arrow and mathematical waveform, drawn from shapes. No actual speech or product UI claim. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 8,638 |
| `public/examples/ai-voice-cloning.webp` | Original paired mathematical waveforms in contrasting cards; no recorded voice or person. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 14,098 |
| `public/examples/talking-objects.webp` | Original illustrated mug with a face and speech bubble, drawn from geometric shapes. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 12,940 |
| `public/examples/product-image-generator.webp` | Original generic bottle, blank geometric label, box and plinth, drawn from shapes; no branded product. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 11,554 |

The existing [fictional portrait manifest](../../public/avatars/fictional/manifest.json), dated 2026-10-24, records that the portraits were generated specifically for Veyrnox with OpenAI image generation, used no Lipsync.video or third-party portrait assets, and depict fictional adults. A1 only reads and composites the existing Mara asset; it makes no new image-generation calls. These are illustrative compositions, not evidence of output from the currently selected live workflow models.

Recreate from this checkout with `python3 scripts/create-still-examples.py`. This deterministic script uses only local Pillow operations and writes the five WebPs. It asserts each file is below 200,000 bytes. No fonts, stock images, competitor media or showcase clips are used.

Web URLs are `/examples/<slug>.webp`; mobile URLs are `https://veyrnox.ai/examples/<slug>.webp`. **Deploy the web assets before shipping a mobile build that uses these URLs.** Nothing is deployed by this work order.

## Stage A2: twelve original videos (2026-11-21)

Generated on the Veyrnox account with its own models, from original inputs only; no competitor media, showcase clips or stock footage. Spend: 378 credits in total (7 stills at 2, 9 avatar clips and 2 image-to-video clips at 32, 1 lip-sync at 12), inside the owner-approved cap of 600. The owner confirmed rights to the inputs and the acceptable use policy in chat before any upload or spend. Output was transcoded locally with ffmpeg to H.264 (High) and AAC, 960 to 1280 px, `+faststart`, each under 800 KB, with a JPEG poster from a single frame.

| Slug | Model | Source image | Speech |
| --- | --- | --- | --- |
| `talking-avatar` | kling-avatar-v2 | fictional portrait `kenji` | built-in macOS voice (Samantha) |
| `ai-human-generator` | kling-avatar-v2 | fictional portrait `ellis` | macOS voice (Daniel) |
| `ai-influencer-generator` | kling-avatar-v2 | Nano Banana still, fictional adult | macOS voice (Samantha) |
| `ai-talking-photo-generator` | kling-avatar-v2 | fictional portrait `nia` | macOS voice (Karen) |
| `avatar-dialogue` | kling-avatar-v2 | Nano Banana still, two fictional adults | macOS voice (Samantha) |
| `talking-cartoon` | kling-avatar-v2 | Nano Banana still, original fox mascot | macOS voice (Daniel) |
| `talking-animals` | kling-avatar-v2 | Nano Banana still, tabby cat | macOS voice (Samantha) |
| `ai-baby-podcast` | kling-avatar-v2 | Nano Banana still, fictional baby | macOS voice (Daniel) |
| `product-avatar` | kling-avatar-v2 | Nano Banana still, fictional presenter, unbranded bottle | macOS voice (Samantha) |
| `ai-ad-clone` | kling-3.0-i2v | Nano Banana still, unbranded bottle | none |
| `product-video-generator` | kling-3.0-i2v | same bottle still, different motion prompt | none |
| `video-dubbing` | latentsync | our own `lip-sync.mp4` (PR #2584), re-encoded without an edit list | macOS voice (Paulina, Spanish) |

The remaining competitor-hosted example is `singing-photo` (separate session, needs a vocal file we own). `lip-sync` is local since PR #2584.

Web URLs are `/examples/<slug>.mp4` and `.jpg`; mobile URLs are `https://veyrnox.ai/examples/...`. Deploy the web assets before a phone build uses them.

The shared example note is localized as an illustrative-example disclaimer. It shows only beside non-local examples, so after A2 it appears only for `singing-photo`, the single entry that still uses its original external URL (separate session; it needs a vocal file we own). The media allowlist tests enumerate that one exception; remove it when its replacement lands, then remove the CSP origin and update the security-header assertions.

## Open rights question: speech in the A2 clips

Ten of the twelve A2 clips carry speech made with the built-in macOS voices (see the table). Apple's macOS licence limits System Voice output to personal, non-commercial use, so publishing these clips as product examples needs either a separate grant or replacement with a licensed or owned voice. This is a pending owner decision; the picture, motion and lip sync are original, but the audio track is the open item. Regenerating those ten with a licensed voice costs about 32 credits per clip plus the speech.
