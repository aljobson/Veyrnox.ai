# Library and editor qualification — 11 October 2026

The owner asked to test all features and make the Library include device files and generated assets. This record separates measured behaviour from remaining qualification. No full CapCut parity or complete clean reconciliation window is claimed.

## Library correction

The editor picker combines original device files, generated images/video/audio, saved editor renders and saved Film Studio masters. Older generations use the server's keyset cursor instead of stopping at the first recent page. Unavailable sources produce a retry message; expired media is omitted and authentication failures remain explicit. Owned saved video downloads verify their permitted storage host, size and SHA-256 before insertion.

Device originals are decoded, SHA-256 identified and stored in IndexedDB, separated by account or signed-out browser scope. The Library page can add video/images/audio and reopen them in the editor after reload. Limits are 100 files and 500 MiB per scope. These bytes stay in this browser: they are not cloud uploads, may be cleared by browser storage eviction, and are unavailable on another device. Keep original files. Storage failure still permits a temporary editor import with an explicit message. Signing out/account changes clear private editing state. Existing project media-upload, paid Cinema and native publishing gates are unchanged. No database migration, provider job or price is added.

The signed-out Library previously opened a login dialog because its navigation account summary requested authentication. Account-only reads now wait for a signed-in actor; original device files work without forced login.

## Measured results

The release regression run passed 3,214 tests with one existing skip and no failures. The production Next build passed using the supported Webpack option (the isolated local checkout shares installed dependencies by symlink). CI independently builds from a clean dependency install.

| Area | Evidence | Scope/limit |
| --- | --- | --- |
| Generated Library image | Actual signed-in production image inserted into editor | Existing live generated-image path; no new paid job |
| Unified source listing | Six focused regression tests include all four sources, older pages, warnings/auth failures, stable v3 recovery, owned bytes and cross-account guards | New source combinations have contract tests; production cloud picker recheck follows deployment |
| Device Library | Actual browser video/image/audio persisted across reload; all three reopened into the appropriate editor tracks. Explicit Reticle state/text consequences passed | Local fix before release; browser-only storage |
| Playback | Normal browser Play advanced and reached final frame 179 | Leased automation did not unlock AudioContext; its stalled check remains a failure, not a pass |
| Timeline | Trim, split/Undo/Redo, duplicate/Undo, extra track, clip track assignment, lock/unlock and mute/unmute produced explicit state consequences | Six-second original synthetic footage |
| Visual controls | Horizontal flip, scale, circular mask, feather, mask keyframe, brightness/exposure, fade animation and vignette were applied | State assertions and composed export; broader artistic quality not established |
| Audio/captions/graphics | Original Glass shimmer audio, two SRT cues, manual cue, star element and title inserted | Actual browser state/visible consequences |
| Export | Actual MP4 download fully decoded: H.264 640×360, 30 fps, 180 pictures; stereo AAC 48 kHz, 285 packets; 177,377 bytes | Six-second composed video; AAC tail reaches 6.08 seconds. Long footage/mobile remain unqualified |
| Person finishing | Production face/body/lighting results each fully decoded: 60 H.264 pictures at 1280×680/30 fps plus AAC. All decoded PCM matched original SHA-256 | Bounded 2D region processing; see person finishing record for limits |
| Cloud projects/fonts/folders | Earlier signed-in production save/edit/save/reload/reopen, version history and original/font relink passed, with backend readback and decoded export | Recorded in production activation evidence; no new hosted Reticle verdict |
| Private renders, brand/review | Earlier production immutable private Library playback, brand persistence and comment resolve/reopen passed; specifically approved fixture cleanup completed | Production activation evidence |
| Camera controls/high-resolution export | Earlier live direction/pace/quote/preflight and short decoded 2K/MOV and 4K/60fps MP4 passed | No paid trajectory/output-quality qualification |

Reticle used temporary local instrumentation connected to the actual timeline store. It was removed before release. Failures/unknowns remain in the private verdict file, including mistaken predicate types and preparation attempts; only explicit passing consequences count. Hosted production SDK attachment remains unavailable. Real browser and backend/media evidence provide the hosted checks instead.

## Remaining qualification

Successful native caption translation remains unavailable on this browser. Singing/lyric alignment, speech accuracy across speakers/languages/noise, complex footage and small/mobile devices still need representative quality journeys. Provider camera/avatar/lip-sync results and billed costs were not tested with paid jobs. Licensed stock/music/GIF rights and TikTok Ads account/contracts remain unresolved. Native social destinations are disabled and were not published to qualify them. FAL vocal separation preparation has not yet been migrated, released or output-qualified. A six-second synthetic export does not establish that every feature works on every real video.

See [production activation](PRODUCTION-ACTIVATION-2026-10-11.md), [controls](CONTROLS-VERIFICATION-2026-10-11.md), [completion staging](COMPLETION-STAGING-2026-10-11.md), [camera](CAMERA-VERIFICATION-2026-10-11.md) and [person finishing](PERSON-FINISHING-2026-10-11.md) for detailed earlier journeys and limits.
