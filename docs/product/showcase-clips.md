# Landing showcase clips

The landing tiles (`FEATURE_CARDS`, `EFFECT_PRESETS` in `app/veyrnox/_lib/tokens.js`)
play a short muted loop on hover, focus, or when on screen (touch). Until a clip
is registered in `app/veyrnox/_lib/showcase.js`, a tile keeps its gradient and
makes no media request.

Clips are generated on Veyrnox with the model each tile advertises, so the page
shows what the product produces. Do not use footage from other generators or
from competitor sites.

## Spec

| | |
| --- | --- |
| Container | H.264 MP4 (`.webm` also allowed) |
| Size | 720p max, 3 MB max (`MAX_CLIP_BYTES`), no audio track |
| Length | 3 to 5 s, seamless loop preferred |
| Feature cards | 4:5 crop. Poster: first frame, JPG or WebP, under 80 KB |
| Preset tiles | 1:1 crop. Poster as above |
| Path | `public/showcase/<slug>.mp4` and `<slug>.jpg`, slug `[a-z0-9-]` |

Only a tile's bottom third carries text, so keep the subject in the upper two
thirds of the frame.

```bash
ffmpeg -i in.mp4 -an -vf "scale=-2:720,crop=576:720" -c:v libx264 -crf 28 -preset slow \
  -movflags +faststart public/showcase/wan-2-5.mp4
ffmpeg -i public/showcase/wan-2-5.mp4 -frames:v 1 -q:v 4 public/showcase/wan-2-5.jpg
```

## Shot list

| Tile key | Model | Shot |
| --- | --- | --- |
| `wan-2.5-kie` | Wan 2.5 | Slow push-in on a rain-lit neon street at dusk, one figure walking away |
| `nano-banana-kie` | Nano Banana | Product still: glass perfume bottle on wet stone, soft rim light (poster only is fine) |
| `kling-26` | Kling 2.6 Pro | Handheld tracking shot through a crowded market, shallow depth of field |
| `presets` | Any preset | Split-second before and after of one preset applied to the same subject |
| `ace-step` | ACE Step | Audio has no picture: animate a waveform-free abstract, or leave the gradient |

Preset tiles reuse the preset's own demo output. Generate each from the preset
it is named after so "RECREATE" is literally true.

## Adding a clip

1. Generate on Veyrnox, encode per the spec, drop both files in `public/showcase/`.
2. Add the entry to `SHOWCASE_CLIPS` (key = tile `key` or preset `name`).
3. `npm test`: `tests/showcaseClips.test.mjs` checks the path, the file, and the size cap.
