# Landing showcase clips

The landing tiles play a short muted loop on hover, focus, or when on screen
(touch, one at a time, stopped at 5 s). Until a clip is registered in
`app/veyrnox/_lib/showcase.js`, a tile keeps its gradient and makes no media
request.

Clips are generated on Veyrnox with the model each tile advertises, so the page
shows what the product produces. Do not use footage from other generators or
from competitor sites, and do not put real people, brands or readable text in a
prompt.

## Which tiles get a clip

Only tiles that are backed by something real.

| Tile | Clip? | Why |
| --- | --- | --- |
| Feature card `wan-2.5-kie` | Yes | Wan 2.5, video |
| Feature card `kling-26` | Yes | Kling 2.6 Pro, video |
| Feature card `presets` | Yes, from a real preset | See below |
| Feature card `nano-banana-kie` | No | An image model. `MediaTile` needs a video, so it keeps its gradient |
| Feature card `ace-step` | No | Audio has no picture |
| The 15-tile "Big-budget effects" wall (`EFFECT_PRESETS`) | **No, not yet** | See the caveat below |

### Caveat: the effects wall is not backed by real presets

`EFFECT_PRESETS` (INCLINE, STUDIO SLIDE, LACEWALKER, ...) lists 15 effects, and
none of them exists in `PRESETS`, which has 7: CCTV NIGHT, SUNSET DRIFT, NEON
ALLEY, WARM PORTRAIT, FILM PORTRAIT, TALKING HEAD, CLEAN CUTOUT. The wall's
tiles say "RECREATE" and link to `/presets`, where those effects are not
offered. Eight of the names also match effect names on a competitor's homepage
exactly (INCLINE, STUDIO SLIDE, ACT NATURAL, LACEWALKER, WILD RIDE, FLOATING
FALL, EYES IN, CUTOUT).

Do not register clips for the wall until it is rebuilt from `PRESETS`: it would
add video to effects the product cannot deliver. The rebuild is a content
decision, tracked separately from this PR.

## Spec

| | |
| --- | --- |
| Container | H.264 MP4 (`.webm` also allowed) |
| Size | 720p max, 2 MB max (`MAX_CLIP_BYTES`, aim for 1 MB), no audio track |
| Length | 3 to 5 s. Touch devices stop playback at 5 s, so nothing past that is seen |
| Feature cards | 4:5 crop. Poster: first frame, JPG or WebP, under 80 KB |
| Path | `public/showcase/<slug>.mp4` and `<slug>.jpg`, slug `[a-z0-9-]` |

Generate in **portrait (9:16)** where the studio offers it, at 720p. Only a
tile's bottom third carries text, so keep the subject in the upper two thirds.
Pick slow, continuous motion; a hard cut or a fast pan reads badly in a small
looping tile.

Encode a 9:16 source to the 4:5 tile (crops the top and bottom, then scales):

```bash
ffmpeg -i in.mp4 -an -vf "crop=iw:iw*5/4,scale=576:720" -c:v libx264 -crf 28 -preset slow \
  -pix_fmt yuv420p -movflags +faststart public/showcase/wan-2-5.mp4
ffmpeg -i public/showcase/wan-2-5.mp4 -frames:v 1 -q:v 4 public/showcase/wan-2-5.jpg
```

A 5 s 9:16 source comes out around 300 KB. A landscape source cannot use this
command (the crop needs a source at least as tall as it is wide).

## Prompts

Costs are the live catalog prices at the time of writing (5 s, 720p). Budget for
2 to 3 takes each; the 10 sign-up credits will not cover it.

### `wan-2.5-kie` : Wan 2.5, 19 credits per take

> Slow push-in along a rain-soaked side street at dusk. A lone figure in a dark
> coat walks away from the camera under a tilted umbrella. Pink and teal neon
> signs ripple in the wet asphalt, steam rises from a grate, soft haze in the
> distance. Shallow depth of field, anamorphic bokeh, smooth camera motion,
> cinematic. No text, no logos, no readable signs.

Keep the figure small and in the upper two thirds of the frame.

### `kling-26` : Kling 2.6 Pro, 17 credits per take

> Handheld tracking shot moving alongside a woman weaving through a crowded
> night market. Paper lanterns overhead, steam from food stalls, warm tungsten
> light against cool blue shadows. She glances toward the camera once, smiles,
> then keeps walking. Shallow depth of field, natural motion blur, 35 mm film
> look. No text, no readable signs, no logos.

Generated people must not resemble a real person; discard a take that does.

### `presets` : use the real preset, cost shown on the card

Run one of the presets that actually exists, from `/presets`, and use its
output. NEON ALLEY (Kling 2.6 Pro, 17 credits) or CCTV NIGHT (Wan 2.5, 19
credits) suit a cinematic tile, and the gallery marks both as having cached
demos. Because the tile links to `/presets`, showing a real preset's output
keeps the promise honest.

## Adding a clip

1. Generate on Veyrnox, encode per the spec, and put both files in `public/showcase/`.
2. Add the entry to `SHOWCASE_CLIPS` (key = the feature card's `key`).
3. `npm test`: `tests/showcaseClips.test.mjs` checks the path, the file, the
   extension of each field, and the size cap.
4. Look at it in a browser on a mouse device (hover) and on a phone (in view).
