# Creative feature example media provenance

Stage A1, created 2026-11-21. These four stills are original Veyrnox compositions, generated locally with no third-party media. No network downloads, provider/model calls, credit spend or dependency installs were used for this stage. The dark palette and mint accent follow `app/globals.css` (`--vx-base`, `--vx-panel`, `--vx-border`, `--vx-fg`, `--vx-accent`).

| File | How made | Tools | Date | Rights | Dimensions | Bytes |
| --- | --- | --- | --- | --- | --- | --- |
| `public/examples/ai-avatar-generator.webp` | Locally cropped and framed the existing fictional Mara portrait with original geometric orbit lines. Source: `public/avatars/fictional/mara.png`; provenance below. | Python 3, Pillow 12.3.0 (ImageOps, ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 34,646 |
| `public/examples/text-to-speech.webp` | Original abstract text lines, arrow and mathematical waveform, drawn from shapes. No actual speech or product UI claim. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 8,638 |
| `public/examples/ai-voice-cloning.webp` | Original paired mathematical waveforms in contrasting cards; no recorded voice or person. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 14,098 |
| `public/examples/product-image-generator.webp` | Original generic bottle, blank geometric label, box and plinth, drawn from shapes; no branded product. | Python 3, Pillow 12.3.0 (ImageDraw, WebP encoder) | 2026-11-21 | Original Veyrnox; generated locally with no third-party media | 1280×720 | 11,554 |

The existing [fictional portrait manifest](../../public/avatars/fictional/manifest.json), dated 2026-10-24, records that the portraits were generated specifically for Veyrnox with OpenAI image generation, used no Lipsync.video or third-party portrait assets, and depict fictional adults. A1 only reads and composites the existing Mara asset; it makes no new image-generation calls. These are illustrative compositions, not evidence of output from the currently selected live workflow models.

Recreate from this checkout with `python3 scripts/create-still-examples.py`. This deterministic script uses only local Pillow operations and writes the five WebPs. It asserts each file is below 200,000 bytes. No fonts, stock images, competitor media or showcase clips are used.

Web URLs are `/examples/<slug>.webp`; mobile URLs are `https://veyrnox.ai/examples/<slug>.webp`. **Deploy the web assets before shipping a mobile build that uses these URLs.** Nothing is deployed by this work order.

The shared example note is localized as an illustrative-example disclaimer, rather than attributing every example to Veyrnox: the 13 deferred entries below still use their original external URLs. Both registries and all their existing posters are unchanged for these entries:

- `talking-avatar`
- `ai-human-generator`
- `ai-influencer-generator`
- (`lip-sync` is already local since PR #2584 and is not deferred.)
- `ai-talking-photo-generator`
- `singing-photo` (separate session)
- `avatar-dialogue`
- `video-dubbing`
- `talking-cartoon`
- `talking-animals`
- `ai-baby-podcast`
- `ai-ad-clone`
- `product-avatar`
- `product-video-generator`

These entries are exceptions, not covered by the original-media rights statement above. The web and mobile media allowlist tests explicitly enumerate them; shrink those lists as subsequent stages land. Keep the existing CSP origin until the remaining external media has been replaced.
