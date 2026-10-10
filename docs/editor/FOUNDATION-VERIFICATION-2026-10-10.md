# Editor foundation verification — 2026-10-10

## Change and outcomes

Imports now use collision-resistant local media ids and retain a full valid source while fitting insertion to available edit time. Project media can be inserted again or removed; undo/redo retains bytes referenced by the bounded history. Titles determine edit duration, including a title-only video. Duplication preserves source range and volume. Audio extraction transfers volume and mutes the original.

The preview transport and MP4 export share a 48-kHz stereo mixer. Playback starts an AudioContext from Play and advances from its audio clock. Pause/edit/seek/relink cancel preparation and stop the source. Timeline trims support pointer and keyboard input, drag commits one undo entry, video clips reorder, and independent zoom/keyboard commands control editing.

Export commits a pending title draft and renders the synchronous current timeline. This fixes an observed regression where the inspector showed new words while the MP4 contained the previous title. Numeric progress and cancel discard a partial file. Decoder iterators and inputs are closed on completion, cancellation and failure; the preview decoder cache deduplicates concurrent creation and follows relink/history/disposal.

## Running-app evidence

An isolated Next development app was driven in desktop Chrome with agent-owned synthetic fixtures. The user's primary development process was left running. Temporary Reticle SDK/store registration and local socket CSP wiring were removed before the production build; no production policy or dependency change ships.

Reticle produced consequence verdicts (`verified: yes`) for:

- title-only duration; importing video/source bytes;
- undoing/redoing an import while retaining its file;
- audible playback with a running AudioContext, nonzero mixed PCM peak and stop at the last frame;
- one-frame keyboard trim, duplicate and undo;
- clearing stale selection after undoing a duplicate;
- extracted sound volume with the original muted;
- timeline zoom after real native input;
- pointer trim committing exactly one history step, and one undo restoring its range;
- a 70-second source retaining all 2100 source frames while only the remaining 1680 edit frames enter the timeline;
- dragging a video to reorder without changing its source range;
- completing an export with current draft words, and cancelling repeated full-length exports without a download or console error.

Actual browser downloads were decoded with ffmpeg/ffprobe. The title-only result has 90 H.264 frames at 30 fps, 1280×720, duration 3.000 s, with the last typed title visible. The video/audio result has 120 video frames, H.264 plus AAC stereo, the edited title visible and nonzero sound (peak approximately −16.66 dBFS). AAC container padding extends the four-second file slightly; the video remains 120 frames.

A three-step asserted Reticle flow, `editor-title-export-current-words`, records Add text → edit Words → Export. It carries the product intent that the last typed words belong to the title-only MP4. Raw verdicts, screenshots and downloads remain local verification artifacts.

## Findings and limitations

The first export inspection caught stale title words; the fix was re-driven and the decoded result checked. Undo initially retained a deleted duplicate's selection; the current undo/redo clears it. A preview cleanup issue under development effect replay was fixed and checked after a clean reload.

Two incorrect initial assertions expected text to commit before blur and used an inaccurate download-link name. Their failures are retained in the session and are not counted as passes. Reticle's synthetic targeted range keypress did not trigger native slider behavior; real input followed by a consequence assertion passed, and feedback was filed. Chrome extension file upload lacked file-URL permission, so Reticle imported the same agent-owned fixtures from its allowed project root.

This verifies the listed editing foundation on this desktop Chromium setup. It does not qualify new codecs, 4K, longer edits, real-footage performance on smaller machines, paid AI, multitrack documents or the rest of the [full feature scope](CAPCUT-GAP-2026-10-10.md).

## Automated checks

The complete regression suite passed: 2749 tests passed and one existing test skipped. Type checking passed. Repository lint passed with zero errors and 75 existing warnings; the changed editor files are linted separately. Production Worker build qualification is recorded in the release checks.
