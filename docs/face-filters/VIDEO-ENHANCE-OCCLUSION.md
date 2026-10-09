# Video Enhance occlusion evaluation

Tested 2026-09-28 in local macOS 27.0 arm64 / in-app Chromium, Next development
mode, runtime `1a76094`. Result: **sampled full-cover loss/recovery observed;
partial-occlusion quality remains unqualified**. Production stays disabled.

## Fixture and provenance

[People Covering the Face of a Woman](https://www.pexels.com/video/people-covering-the-face-of-a-woman-9463674/)
by Ron Lach, under the [Pexels License](https://www.pexels.com/license/).
The source page supplied the [original MP4](https://videos.pexels.com/video-files/9463674/9463674-uhd_1440_2732_25fps.mp4).
It is 17.08 seconds, 1440×2732, 25 fps, silent. No endorsement is implied.

The fixture uses its first 15 seconds, scaled to 1012×1920, H.264 CRF18, silent:

```sh
ffmpeg -i original.mp4 -t 15 -vf scale=-2:1920 -c:v libx264 -crf 18 -an fixture.mp4
```

The hands cover the eyes and mouth at the beginning, reveal the face, then
cover it again. The subject has a vertical makeup stripe. Some hand regions
are already out of focus in the source, limiting texture comparisons.

## Observations

Natural look, smoothing 30%. Browser UI observations were sampled roughly every
500 ms plus automation overhead. These are displayed tracking states, not an
all-frame landmark trace or a precise transition-time measurement.

| Displayed source times | Observed preview status |
| --- | --- |
| 0.0 initially, then 0.2–1.2 s | No face; smoothing paused |
| 1.7–10.8 s | One face; smoothing active |
| 11.3–14.9 s | No face; smoothing paused |

At 10.8 seconds the source still has a visible face but a hand covers part of
the eye/forehead area. Tracking continuing here does **not** mean the hand is
excluded from the face mask. The current renderer has no hand/hair segmentation.

The 30% export and a matching 0% smoothing control each retained all 375 frames,
source-relative timestamps/durations within 1 ms, and no added audio.
Side-by-side stills at 10.8 and 12 seconds showed no obvious gross alignment
error. Softness during full coverage is also visible in the no-smoothing export;
these stills do not establish how much comes from source focus, rendering or
encoding, nor do they establish preservation of hand texture.

## Product guidance and remaining gate

The preview now explicitly advises that smoothing can affect hands or hair over
the face and recommends turning smoothing off for those clips. This is guidance,
not automatic occlusion protection. Browser verification confirmed the text.

The gate remains open for full-resolution temporal review across varied subjects,
severe profiles, hair and partial occlusion. Before a smoothing release, qualify
a conservative fallback or occlusion-aware masking against such cases. Do not
infer semantic hand protection from a single-face landmark result.

[Measurement metadata and hashes](video-enhance-occlusion-2026-09-28.json) retain
source/output identity and sampled status observations. Licensed diagnostic media
remain local in ignored `.scratch/video-enhance/severe-occlusion/`, not in Git
or the deployed runtime inventory.


## Matched-frame review and comparison videos, 2026-09-29

Reviewed historical exports, not newly generated outputs of the latest branch.
The portrait output is the third in-app Chromium export from the responsiveness
run; the covered-face outputs are the original 2026-09-28 0%/30% pair above.

Paired portrait stills at 2, 6 and 8 seconds show head tilt/downward motion and
facial hair. Skin texture is softer in the export, particularly on the forehead
at 6 seconds. Eye, mouth and beard boundaries show no obvious gross displacement
in these samples. The portrait has no matching 0% export in this comparison, so
re-encoding differences cannot be isolated from smoothing. These poses do not
qualify severe side-profile behavior.

Paired covered-face stills at 1.8 seconds (revealed face) and 11.2 seconds (hand
covering the eyes) show no obvious gross geometry displacement. Soft hand detail
is visible in both the 0% and 30% outputs. A 30% output still at 10.4 seconds also
shows the approaching hand. These observations do not establish hand preservation,
hair exclusion, or smooth transitions between tracking states.

Two synchronized side-by-side review MP4s were prepared locally, preserving both
panels' dimensions. Each contains 375 frames at 25 fps over 15 seconds:

- `portrait-comparison.mp4`: input left, 30% export right, 3840×1080.
- `occlusion-comparison.mp4`: 0% control left, 30% export right, 2024×1920.

They live with lossless extracted stills under ignored
`.scratch/video-enhance/quality-review-2026-09-29/`. Frames are joined on their
source timeline with `setpts=PTS-STARTPTS` and `hstack`, then encoded using
libx264 CRF16. That extra encode makes the videos review aids, not lossless
texture evidence. The original files and PNGs remain available for that purpose.

The [review manifest](video-enhance-quality-review-2026-09-29.json) records file
hashes, exact inspected timestamps and artifact dimensions. Sampled inspection
and prepared continuous comparisons do not close the temporal-quality gate.
Severe profiles, hair across the face and a broader subject set are still needed.
No application code, production activation or release decision changed.
