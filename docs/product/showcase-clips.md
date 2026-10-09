# Landing showcase clips

Every landing feature card, every tile in the seven-template wall, all 22
public preset cards and the three model-category cards have viral previews. The owner requested footage from [SYNTX Trends](https://syntx.ai/trends)
and [Higgsfield](https://higgsfield.ai/) on 9 October 2026. This replaces the
previous requirement to use only clips generated on Veyrnox.

These clips are visual inspiration, rather than output from the model or
preset linked by the tile. Each tile displays a generic “Viral inspiration”
badge. The owner requested removal of visible SYNTX and Higgsfield labels and
page credits on 9 October 2026; provenance remains recorded here and in the
manifest. Model links, prompts and live credit prices still
come from the existing catalog and templates.

`app/veyrnox/_lib/showcase.js` maps all five `FEATURE_CARDS` keys and all
`PRESETS` ids to local videos, posters, original titles and source names.
`MODEL_SHOWCASE_KEYS` selects three of those clips for the Video, Image and
Audio cards in `/#models`. The shared `PresetCard` also brings the previews
to the studio Explore gallery. Each public preset uses a distinct clip; five
reuse the feature-card footage across pages.

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

| `editorial-flatlay` | Floating fall | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/d877f71c-d2f3-44df-9317-f3ce6889bcb6.mp4) | 0 s |
| `street-portrait` | Eyes in | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/dba03734-6e8a-4337-acb4-17ce943563d8.mp4) | 0 s |
| `packshot-studio` | Smash and grab | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c32886ee-2d15-4697-a366-041a9deaffe2.mp4) | 0 s |
| `try-the-look` | Incline | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/bade6252-7039-42eb-a50c-45c142c7f70f.mp4) | 0 s |
| `ugc-unboxing` | Selfception | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/6ef62a07-2609-4693-8225-e6263b76afab.mp4) | 0 s |
| `miniature-city` | Act natural | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/7a261cff-8d6c-4bab-84e7-515364061f3e.mp4) | 0 s |
| `product-hero` | Lacewalker | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/d806368c-0d8a-4a7b-b43a-8ff22fa64563.mp4) | 0 s |
| `noir-one-sheet` | Burning man | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/c370022d-d99a-4cff-bb35-9d73b7a3a95d.mp4) | 0 s |
| `saturday-cartoon` | Melting | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/f661157c-af00-46f7-8b7c-6a7ae711ef98.mp4) | 0 s |
| `anime-hero` | Crazy Frog Race | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/1yALI02uHd8mdSUDqWMWvFHagMDaKMbGr1ja55gB.webm) | 0 s |
| `photo-to-motion` | High flip | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/001156a7-cfdb-4e16-8f13-68c246ddc06c.mp4) | 4 s |
| `runway-walk` | Medieval Runway Look | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/Uz4mSaF5whThHf4UxXBl86UBGyelRKtdkn3PMtj5.webm) | 8 s |
| `anime-opening` | Keyboard Duo Swap | [SYNTX](https://r2.syntx.ai/ERP/media-library/trends/variants/uCxc5t2yK9MJEjxzKtevpNdeMw6yYQyIzxHJiqZY.webm) | 0 s |
| `portal-burst` | World morphing | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/950efc04-6ae6-4b31-bfa5-83c87244014c.mp4) | 2 s |
| `floating-castle` | Street colossus | [Higgsfield](https://cdn.higgsfield.ai/viral_hub/e0278141-12c9-4139-91eb-b4294d833ed9.mp4) | 2 s |

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
unique clips, source credits and coverage of every landing tile, public preset and model category. After a
replacement, also check the crop and hover/focus/touch behavior in a browser.

## The landing film

The fifteen-second product film under the hero is separate. It shows the
Generate button, credit statement and price list. Its source and render
instructions remain in `scripts/landing-film/README.md`.

## The breakthrough video

The owner selected [this public Facebook reel](https://www.facebook.com/reel/1376753811233996)
by Tim Gray on 9 October 2026, shared as
`https://www.facebook.com/share/v/1E6dPQfyKL/?mibextid=wwXIfr`.
Its title is “Make Viral Videos in 3 Clicks 💥”. The five-second clip shows a
LEGO superhero carrying a coffee cup out of a social-media post.

`BREAKTHROUGH_FILM` supplies the prominent portrait player immediately under
the hero. The complete clip is served from `/film/breakthrough-superhero.mp4`
as a silent H.264 file at 720 × 900, with no crop. Its poster is a frame at
2.2 seconds. The existing `FilmPlayer` supplies visible Play/Pause, pauses
off screen, leaves the poster still for reduced motion/data saver, and
fetches the file only when playback begins. It is labelled as viral
inspiration, without attributing it to a Veyrnox model.
