# Landing showcase clips

Every landing feature card and every tile in the seven-template wall has a
viral preview. The owner requested footage from [SYNTX Trends](https://syntx.ai/trends)
and [Higgsfield](https://higgsfield.ai/) on 9 October 2026. This replaces the
previous requirement to use only clips generated on Veyrnox.

These clips are visual inspiration, rather than output from the model or
preset linked by the tile. Each tile displays a source badge, and each grid
links to both source sites. Model links, prompts and live credit prices still
come from the existing catalog and templates.

`app/veyrnox/_lib/showcase.js` maps the five `FEATURE_CARDS` keys and seven
`WALL_PRESETS` ids to local videos, posters, original titles and source names.
The other templates in the full `/presets` gallery are outside this landing
manifest.

## Imported previews

The table records the original public asset and the start of the five-second
excerpt. No audio is retained.

| Tile | Original preview | Source asset | Start |
| --- | --- | --- | --- |
| `wan-2.5-kie` | High flip | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/001156a7-cfdb-4e16-8f13-68c246ddc06c.mp4) | 4 s |
| `nano-banana-kie` | Medieval Runway Look | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/Uz4mSaF5whThHf4UxXBl86UBGyelRKtdkn3PMtj5.webm) | 8 s |
| `kling-26` | World morphing | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/950efc04-6ae6-4b31-bfa5-83c87244014c.mp4) | 2 s |
| `presets` | Street colossus | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/e0278141-12c9-4139-91eb-b4294d833ed9.mp4) | 2 s |
| `ace-step` | Keyboard Duo Swap | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/uCxc5t2yK9MJEjxzKtevpNdeMw6yYQyIzxHJiqZY.webm) | 0 s |
| `cctv-night` | Shadow Warriors | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/v0IWqxKDem6ob6kWb4WEfa5uEaeCiT5izzJ66fVb.webm) | 2 s |
| `sunset-drift` | Wild ride | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/8cd9e3fc-8e4f-4071-abff-8934f3381507.mp4) | 1 s |
| `neon-alley` | Storm Starring | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/sKDvnDudRdlWCuHRBLBzPR4WBnsYDcxk1wVgazUr.webm) | 18 s |
| `warm-portrait` | Studio slide | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c129fb83-2014-4a37-a3f8-6c7dfeab0254.mp4) | 0 s |
| `film-portrait` | Epic Train Doorway Scene | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/D32W06o9qJoCOHnFxtLC6BH9Lvftpyaf6sD75RBD.webm) | 6 s |
| `talking-head` | Fat Parkour | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/xAXfvbGmMPLFCk6AHfqkew9D5k2KomNk3fVZdZZo.webm) | 8 s |
| `clean-cutout` | Cutout | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/a64711ac-93b8-46ee-a9ce-37ee5c18e148.mp4) | 1 s |

## Playback and budgets

- MP4, H.264, 24 fps, maximum 720 pixels on either side, no audio track.
- Five seconds per clip; each video stays under `MAX_CLIP_BYTES` (2 MB).
- Representative JPG posters, each under 80 KB.
- Files live in `public/showcase/`, so the existing same-origin CSP applies.
- Desktop previews play on hover or keyboard focus while visible.
- Touch previews play one at a time while visible and stop within five seconds.
- Reduced motion, data saver and slow touch connections keep the poster still.
- Videos use `preload="none"`; playback failures keep the poster.

The existing `MediaTile` crops with `object-cover` into each tile's layout.
Encode at the source aspect ratio so the same preview can fit portrait,
landscape or wide tiles without distorting the subject.

```bash
ffmpeg -ss START -i original -t 5 -an \
  -vf "scale=w='min(720,iw)':h='min(720,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2,fps=24" \
  -c:v libx264 -crf 27 -preset slow -pix_fmt yuv420p -movflags +faststart \
  public/showcase/SLUG.mp4
ffmpeg -ss POSTER_TIME -i public/showcase/SLUG.mp4 -frames:v 1 -q:v 4 public/showcase/SLUG.jpg
```

`tests/showcaseClips.test.mjs` checks local paths, file existence, budgets,
unique clips, source credits and coverage of every landing tile. After a
replacement, also check the crop and hover/focus/touch behavior in a browser.

## The landing film

The fifteen-second product film under the hero is separate. It shows the
Generate button, credit statement and price list. Its source and render
instructions remain in `scripts/landing-film/README.md`.
