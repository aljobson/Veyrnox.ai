# Advanced editor verification — 2026-10-10

This release builds the independent-track workspace behind
`EDITOR_MULTITRACK_ENABLED`; production activation is pending migration 0269
and a clean 24-hour reconciliation window. The full requested CapCut inventory
has remaining work, detailed in [the coverage table](CAPCUT-GAP-2026-10-10.md).
No CapCut code or assets were adopted.

## Real browser evidence

Driven in desktop Chrome on a separate local dev port using Reticle and native
input where browser audio activation required it. Temporary local wiring was
removed before the production build. Owner sessions were left untouched.

- Reticle proved local import and byte retention, source range insertion,
  overlapping video/audio tracks, independent duration, track hide/lock,
  waveform/thumbnail display, search, split/trim, copy/paste, groups moving
  together, duplicate/delete undo and mute/solo/track ordering.
- Reticle proved transform/crop/blend/mask controls, constant rate and audible
  playback, gain/fades/pan/EQ, extraction, keyframes, original titles/shapes,
  looks, templates, transitions and effects. A fresh-bundle reload confirmed
  that transparent shapes retain transparent edges under the vignette effect.
- Reticle proved two-cue SRT import, caption edits/style changes, transcript
  range deletion and SRT download availability. The downloaded SRT had the
  edited words and correct cue times.
- Reticle proved completed local exports and cover capture. Native downloads
  were inspected with ffprobe, and output frames were decoded to confirm
  expected video, title and graphic layers.
- With the advanced flag false, Reticle proved the old workspace imports a
  local video, plays decoded sound and exports a downloadable MP4. Its actual
  file has H.264 1280x720 at 30 fps for four seconds and AAC sound.

Saved flows are local evidence, not a claim that every flow has passed an
independent replay. Some checks had partial semantic coverage (for example,
presence of catalog controls); these do not establish all preset combinations.
Reticle unknown/no-fault results were not treated as passes. Tool limitations
around synthetic audio activation, negative state evidence and HUD behaviour
were reported to Reticle. Paid generation was not submitted: the local catalog
was unavailable, and the disabled price-unavailable state was proved instead.
Production cloud save/reload with v3 is pending activation and is not claimed.

## Decoded output files

| Case | Video | Sound | Actual file size |
|---|---|---|---|
| Original graphic/title MP4 | H.264, 1280x720, 30 fps, 6 s | None | 169,675 bytes |
| MOV | H.264, 854x480, 24 fps, 6 s | None | 83,567 bytes |
| 4K MP4 | H.264, 3840x2160, 60 fps, 6 s | None | 895,804 bytes |
| Video/audio/overlays MP4 | H.264, 1280x720, 30 fps, 6 s | AAC, 6.08 s | 4,211,845 bytes |
| Longer grouped edit MP4 | H.264, 1280x720, 30 fps, 76 s | AAC, 76.074667 s | 5,171,210 bytes |
| Old workspace MP4 | H.264, 1280x720, 30 fps, 4 s | AAC, 4.074667 s | 3,175,055 bytes |

PNG cover: 1280x720, 251,983 bytes. Sound duration includes AAC padding; no
claim of sample-exact container duration is made. Fixtures were synthetic;
longer real footage, multiple high-resolution layers, smaller machines and
other browsers still need qualification. Export settings have capability and
allocation guards; selecting 4K does not guarantee that every edit fits.

## Database and automated checks

All 246 migration files replayed on a disposable local PostgreSQL database.
The new six-case multitrack suite proves exact v3 save/restore, idempotent replay,
changed-payload conflict, typed rejection of malformed direct saves without
appending history, tenant isolation and private helper ACLs. Existing timeline,
project-document, write-cap and default-privilege suites also passed.

The full unit run passed 2,792 tests, with one existing skipped test and no
failures (2,793 total). The initial sandboxed runtime failed on a refused local
socket; the permitted run passed without weakening the test. Release lint,
type/security, migration-number/catalog, audit and Worker-build results are
added once their final runs finish.

## Activation sequence

1. Merge the reviewed release with production `EDITOR_MULTITRACK_ENABLED=false`.
2. The owner approves the `apply-migrations` workflow on main for 0269.
3. Read the applied migration time and reconcile for 24 hours with zero rows;
   a check before that deadline does not clear the window.
4. Enable the advanced flag in a focused release, keeping unrelated paid and
   upload flags unchanged. Verify the live editor; verify v3 save/edit/reload
   and history when the separate projects gate is clear.

The migration is backward compatible, so the prior workspace remains usable
through the observation window and if the advanced flag is rolled back.
