# Editor slice 0 spike (ADR-0080)

Measures whether Mediabunny 1.60.0 can compose a multi-clip timeline in the browser. **Not shipped, not imported by the app, no new
dependency** (`mediabunny` is pinned at 1.60.0 in the root `package.json` for the shipped editor). Results: [docs/editor/SLICE-0-RESULTS-2026-10-10.md](../../docs/editor/SLICE-0-RESULTS-2026-10-10.md).

## Run it

Needs `ffmpeg` and `ffprobe` on the path, Google Chrome, and `playwright-core` installed **outside** the repo (it is not a dependency):

```bash
mkdir -p /tmp/spike && (cd /tmp/spike && npm init -y >/dev/null && npm i playwright-core)
./scripts/editor-spike/make-fixtures.sh /tmp/spike/media
PLAYWRIGHT_CORE=/tmp/spike/node_modules/playwright-core \
  node scripts/editor-spike/run.mjs /tmp/spike/media /tmp/spike/out            # everything
# or pick scenarios: s1 s2 s3 s4 s5 s6 s7 s8
```

| Key | What it does |
|---|---|
| `s1` | 720p, 9.5 s, three clips, crossfade, letterboxed portrait clip, text, music bed. Full content checks |
| `s2` | 1080p, 55.5 s, ten clips (default encoder) |
| `s3` | Which files can be opened and decoded (MOV, WebM, HEVC, Opus-in-MP4, video-only, WAV) |
| `s4` | Cancel 0.8 s in |
| `s5` | A clip without an audio track |
| `s6` | `s1` after a warm-up export |
| `s7` | `s1` with `prefer-software` |
| `s8` | `s2` with `prefer-software` |

`HEADED=1` shows the browser window. Output files and `results.json` go to the output folder.

## Files

- `spike.mjs`: the engine code that runs in the page (decode, composite, mix, encode, cancel).
- `scenarios.mjs`: the timelines. They are test data, **not** the production timeline schema.
- `run.mjs`: static server, Chrome driver, memory sampler, and the ffprobe/ffmpeg checks.
- `slice1.mjs` + `slice1.html`: the slice 1 export check. Unlike the files above, it drives the **real** editor modules (`app/veyrnox/_lib/editorTimeline.mjs`, `editorMedia.mjs`, `editorExport.mjs`, `editorRender.mjs`, `editorPreview.mjs`, `videoEnhance.mjs`) in desktop Chrome and verifies the MP4 with ffprobe and ffmpeg: `PLAYWRIGHT_CORE=<dir> node scripts/editor-spike/slice1.mjs <media dir> <out dir>`.
- `make-fixtures.sh`: synthetic clips only (no real people or third-party media).
