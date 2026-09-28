# Video Enhance: feasibility and validation

Status: local prototype implemented; production qualification pending. Updated 2026-09-27.

## Local prototype

The follow-up implementation uses MediaPipe Face Landmarker and a custom WebGL
bilateral smoothing filter. This permits local testing without a commercial
SDK key. It is an experimental baseline, not a claim of parity with Banuba or
DeepAR. Those remain alternatives if the baseline fails the quality gates below.

Implemented at `/app/enhance`: file validation, single-source original/canvas
comparison, adjustable smoothing, four colour looks, seek/play/pause,
cancelable frame-by-frame export with source audio, and local download.
The mask excludes the eyes, eyebrows and mouth and clears whenever tracking
returns zero or multiple faces. It is a landmark mask, not a semantic skin or
occlusion model; facial hair and hands covering a face need further evaluation.

Run from this checkout:

```sh
npm ci
npm run prepare:video-enhance
npm run dev -- --hostname 127.0.0.1 --port 3186
```

Open `http://127.0.0.1:3186/app/enhance` and choose **Enable local preview**.
This sets `localStorage.veyrnox_video_enhance=1` in that browser. Both the page
gate and engine require development mode. Production builds cannot enable this
prototype through localStorage. No catalog, debit, backend upload or Library
write is implemented. Current production CSP is unchanged; WASM compilation
works under the existing development policy only. Production requires a new
engine/CSP decision, and an approved storage and charging design if retained.

The setup script copies the pinned `@mediapipe/tasks-vision` 1.0.1 WASM runtime
from node_modules and downloads Google's version-1 Face Landmarker model,
checking SHA-256 before use. Assets are served from the same local origin and
ignored by Git. npm records the SDK as Apache-2.0; see the
[Face Landmarker guide](https://developers.google.com/edge/mediapipe/solutions/vision/face_landmarker/web_js)
and [model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Face%20Mesh%20V2.pdf).
Keep licensing notices with assets if distributing a future release.

The browser processes the selected clip without sending it to a provider.
The initial setup downloads software/model assets only. Export uses pinned
`mediabunny` 1.60.0 (MPL-2.0) and WebCodecs, processing every decoded frame
through the same renderer with source timestamps. Compatible primary audio is
copied; otherwise the library can transcode it. MP4 is preferred, with WebM as
a fallback when all primary tracks can be preserved. Unsupported audio fails
the export rather than silently disappearing. Opus audio is explicitly rejected
until its end-padding regression is fixed; AAC and silent clips remain supported. Encoding speed does not control
the output timeline. Descriptive metadata is removed. See the
[Mediabunny conversion API](https://mediabunny.dev/guide/converting-media-files).

## Product scope

Let a creator select their own short video, adjust natural skin smoothing and
colour presets, compare original and processed playback at the same timestamp,
then export with the original audio. Initial benchmark target: one face,
5–15 seconds, MP4, 720p/1080p, portrait and landscape. These are proposed
limits, not capabilities already shipped. Keep facial geometry unchanged.

This extends Track A. The existing A1 retouchers process images; A6 relights
video. Neither establishes a working video skin-smoothing product. Applying
an image generator independently to every frame is not an accepted substitute:
temporal stability and preservation of the subject would remain unproven.

## Evidence collected

During provider discovery, only public documentation and schema GET requests were used. No media was
uploaded, no paid generations submitted, and no production settings changed.
Documentation support is distinct from a successful processing benchmark.

| Candidate | Verified evidence | Decision for this feature |
|---|---|---|
| fal `image-editing/retouch` | Live request schema requires `image_url`; no `video_url` | Keep for photo retouch; not a video engine |
| fal `retoucher` | Live request schema requires `image_url`; no `video_url` | Same |
| fal `id-v2v/relight` | Requires `prompt`, `video_url`, and `image_url`; describes the image as the restyled first frame | Generative relighting, not validated natural skin smoothing |
| fal `lightx/relight` | Requires `video_url`; default `relit_cond_type=ic` has a documented conditional requirement for `relight_parameters` | Relighting candidate only; generic submission is not a verified working payload |
| Banuba Face AR Web | Documents video Blob/URL input and video Blob output; beauty product documents smoothing | First benchmark candidate; no measured result, price or licence confirmed |
| DeepAR Web + Beauty | Documents custom video element input, recording and adjustable smoothing | Alternative; Beauty is separately licensed; audio/browser limitations need tests |

fal schemas were fetched directly on 2026-09-26. Reproduce without a key:

```sh
node scripts/verify-filter-endpoints.mjs --only=retouch,retoucher,relight-video,lightx-relight
```

The probe's ignored JSON file records schema availability, input names and
required fields, not measured cost or output quality. Passing this probe does
not justify catalog activation. Light-X's conditional requirements are described
in schema prose and need an endpoint-specific payload before a paid test.

Sources checked:

- [fal retoucher](https://fal.ai/models/fal-ai/retoucher)
- [fal image retouch schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fimage-editing%2Fretouch)
- [fal retoucher schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fretoucher)
- [fal ID video relight schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Fid-v2v%2Frelight)
- [fal Light-X schema](https://fal.ai/api/openapi/queue/openapi.json?endpoint_id=fal-ai%2Flightx%2Frelight)
- [Banuba API overview, Web section](https://docs.banuba.com/far-sdk/tutorials/development/api_overview/)
- [Banuba beauty capabilities](https://www.banuba.com/facear-sdk/beauty-ar)
- [DeepAR Beauty introduction and licensing](https://docs.deepar.ai/deepar-beauty/introduction/)
- [DeepAR Web recording and video input API](https://docs.deepar.ai/deepar-sdk/deep-ar-sdk-for-web/api-reference/classes/DeepAR.html)

## Commercial SDK alternative

If comparing a commercial SDK, benchmark Banuba Face AR Web first because its documented inputs and outputs
match post-processing uploaded clips. This is a provisional engineering choice,
not a purchasing recommendation or production provider selection. Banuba's
mobile Video Editor SDK is a different product; do not assume it supplies a
Next.js web editor.

Prototype processing locally in the browser using a selected file. Avoid camera
and microphone access. Confirm SDK asset hosting, runtime network traffic,
licensing and the actual output codecs during the benchmark. A local file input
alone does not prove that an SDK sends no telemetry or media off-device.

DeepAR's recording API accepts an explicit audio track. Its `recordAudio` option
captures microphone audio and overrides that track, so it must not be used for
preserving uploaded audio. The docs describe WebM output on Firefox and an
Android audio-recording limitation. These require device tests or a separate
audio muxing path; do not advertise universal MP4/audio support in advance.

The current Transform upload path accepts MP4 up to 100 MiB. Social Cinema's
larger Stream uploads are a separate publishing workflow and do not provide a
retouch engine. WebM SDK output would need conversion or a deliberately scoped
change to the upload and validation contract before Library storage.

Browser SDK processing does not fit the existing assumption that every filter
is a fal queue job. Before integrating, write an ADR covering preview/export
execution, authoritative completion, Library storage and the charging boundary.
Never debit credits on an untrusted browser report that an export succeeded.
SDK licence costs also need a cost model before proposing catalog credits.
Reusing upload infrastructure does not resolve these questions.

## Benchmark and exit criteria

Use owned or explicitly permitted footage. Keep raw face clips out of Git.
Record the engine/build, effect version, device, browser, input properties,
settings, elapsed time, output properties and the review outcome for every run.
All criteria below are proposed launch gates, not observed results.

| Test | Required result |
|---|---|
| Strength 0, low, medium, high | Strength changes are visible and monotonic; zero disables smoothing |
| Facial detail | Eyes, brows, lips, hair and facial geometry stay intact; no obvious waxy skin at low/medium settings |
| Movement | Speaking, blinking, head turns and hand occlusion show no visible flicker, mask slip or altered identity at normal speed |
| Coverage | Review multiple skin tones, facial hair, glasses, daylight and dim lighting; record failures separately |
| No face / face lost | No whole-frame blur or stale face mask; explain unsupported clips |
| Multiple faces | Reject or clearly document behaviour for the initial single-face version |
| Audio | Original content retained; audio/video alignment within 50 ms at both start and end |
| Timing | Export duration differs by no more than one source frame; inspect for dropped/duplicated frames |
| Playback comparison | Seek/pause/play stays aligned within one source frame; only one audio source plays |
| Format | Confirm output codec/container and orientation on Chrome, Safari/iOS and Android Chrome; test Firefox separately |
| Lifecycle | Cancel/reselect/unmount releases decoder, GPU, audio and object-URL resources |
| Performance | Record processing time and memory for 5/10/15-second clips; establish supported devices from measurements |

Build order after a successful benchmark:

1. Decide engine licence and export architecture with measured costs.
2. Integrate single-file input and an actual smoothing preview behind a feature flag.
3. Add colour presets and synchronized original/result comparison.
4. Implement original-audio export, format handling and Library persistence.
5. Verify credits, failure handling and production readiness before activation.

## Outstanding release work

### Local verification, 2026-09-26

- `npm test`: 781 passed, 1 skipped, no failures (782 total).
- `npm run build`: passed. Existing warnings in unrelated routes remain.
- Scoped ESLint and `21st review`: passed; the latter reported zero findings.
- Codex's Chromium in-app browser loaded the real SDK/model, decoded local files,
  displayed synchronized source/canvas previews, and downloaded real MP4 output.
- Generated 640×360, five-second test pattern with a 440 Hz tone: no face found,
  smoothing disabled, Warm preset export succeeded. `ffprobe` found H.264 video
  and AAC audio. Both start at zero; durations were 5.073033s video and 5.076500s
  audio. The audio had nonzero signal (mean -21.2 dB).
- A five-second, 640×416 static portrait fixture from
  [NASA image S90-45845](https://www.nasa.gov/former-astronaut-eileen-collins/)
  tracked one face; smoothing at 30% and 100% rendered and export succeeded.
  This was a technical test fixture, not an endorsement or moving-face benchmark.
  The resulting H.264 video lasted 4.938s and AAC audio 5.095021s. The recording
  therefore does **not** pass the one-frame duration/alignment launch gates.
- Two enlarged copies of the same portrait were detected as two faces and
  smoothing was disabled. Smaller faces were not detected, also leaving smoothing
  disabled. This is evidence of a detection-size limitation, not full coverage.
- Cancel during export restored controls and displayed `Export cancelled.` with
  no download link. Source replacement released the previous processing instance.
- At 390px viewport width, document width was 390px; comparison panels stack.

Local screenshots and downloaded test outputs are retained under
`.scratch/video-enhance/` in the implementation worktree. They are not committed
or published. Fixture source images and unmodified test clips are in `/tmp`.
The SDK logs a CPU-delegate informational line to the console error stream,
which Next's development overlay counts as an issue; no initialization failure
was observed. Safari, Android and moving faces remain untested.

### Timestamp export verification, 2026-09-27

The real-time recorder above was replaced; its measurements are historical.
The full suite passed: 782 tests passed, 1 skipped, zero failures. Production
build and scoped ESLint also passed. The same real-file check rejects the old
portrait export (56 of 150 source frames), demonstrating the regression.

- Both the moving test pattern (Warm) and portrait (30% smoothing) exported all
  150 frames. Source-relative frame timestamps, audio/video starts and durations
  matched within 1 ms; both tracks were exactly 5.000 seconds long.
- Decoded PCM SHA-256 matched the source for both AAC fixtures, confirming no
  introduced silence, re-recording or sample loss for this copied-audio path.
- In this Chromium environment the selected video encoder was VP9 in MP4.
  The portrait's non-square input pixels were normalized from 640×416 with SAR
  624:623 to 642×416 square pixels. Broad player compatibility remains untested.
- Cancel restored controls, reported `Export cancelled.` and exposed no download.
- Exported portrait pixels were inspected; the output is rendered video, not a
  timing-only or blank-container result.

Reproduce the real-file regression check (requires ffmpeg/ffprobe):

```sh
node scripts/check-video-enhance-export.mjs /path/to/source.mp4 /path/to/export.mp4
```

This strict fixture check requires copied audio, checks every video timestamp,
track offsets/durations, frame count and decoded audio content. It is not a
quality judgment or proof for every browser/codec. The fixtures and new outputs
are retained in `.scratch/video-enhance/` locally.

### Additional container checks, 2026-09-27

Full suite after the codec guard: 783 passed, 1 skipped, zero failures.
Production build, scoped ESLint and whitespace checks passed.

- Silent variable-frame-rate MP4: 10 fps for the first two seconds, then 30 fps.
  All 110 frames retained, timestamps and duration within 1 ms, no audio track
  added. Five-second duration preserved.
- MP4 with verified 90° display-rotation metadata: all 150 frames retained,
  source audio identical after decoding, timestamps and duration within 1 ms.
  Output normalizes rotation into 360×640 pixels with no rotation metadata.
  Source and output first frames were visually compared for direction and crop.
- WebM with Opus: video frame timing was preserved, but MP4 conversion added
  648 decoded mono samples (13.5 ms at 48 kHz). Source PCM was 480,000 bytes;
  output PCM was 481,296 bytes. End-padding handling is not qualified. Export
  now rejects Opus before conversion and gives a clear AAC/silent-clip alternative.
  This is an outstanding codec limitation, not a claim that the bug was repaired.
  Browser verification confirmed the message with no download, followed by a
  successful AAC export after changing sources.
- A reproducible synthetic-fixture generator and a corrected silent-clip result
  message were added. The generator includes the Opus rejection fixture.

```sh
node scripts/prepare-video-enhance-fixtures.mjs
```

This uses ffmpeg with `-display_rotation` support (tested with ffmpeg 8), writing
only synthetic clips (including an Opus rejection case) under ignored `.scratch/video-enhance/fixtures/`. Select
these files in the editor, download each result, and run the real-file checker.
No personal footage is bundled or uploaded.

### Opus investigation, 2026-09-28

Opus remains rejected. Two proposed replacements were tested on the original
five-second WebM fixture and removed after failing sample-level verification:

| Trial | Decoded mono samples at 48 kHz | Result |
|---|---:|---|
| Source | 240,000 | Reference |
| Original compressed-packet conversion | 240,648 | 648 extra ending samples; source-length prefix was identical |
| Browser decode → AAC encode | 243,712 | Additional delay/padding; failed alignment |
| Packet-copy cap at audible duration | 239,688 | 312 samples lost at the end |
| Packet-copy cap including Opus pre-skip | 240,648 | Correct container duration did not enforce decoded trimming |

The last trial reported a 5.0065s audio track, but decoded to 5.0135s. Container
duration alone is not a fidelity check. Successful support needs an audio path
that preserves decoder priming and ending trim in actual playback/decoding.
Neither unsuccessful alternative remains in application code.

The regression checker now handles WebM files lacking per-stream duration and
explicitly compares decoded PCM byte counts before hashes. It rejects the
original Opus output with `481296 !== 480000`, while rotated AAC and silent VFR
fixtures still pass. All nine scoped Video Enhance tests pass. This investigation
does not qualify stereo Opus, nonzero audio offsets, discontinuities, or any new
browser/device. No new production capability was enabled.

Diagnostic source/output files are retained locally in
`.scratch/video-enhance/opus-investigation/` and are not release deliverables.

### Load-time export compatibility, 2026-09-28

The editor now inspects the primary audio codec as a clip loads. Opus displays
an accessible **Preview only** notice beside a disabled **Export unavailable**
button. Playback, seeking and adjustments remain available. Selecting a supported
clip clears the notice. A failed media inspection also disables export with an
explanation; the existing export-time check remains as a second guard.

Verification: the real Opus fixture showed the notice without attempting export;
Warm and playback worked. Switching to the AAC fixture removed the notice and
re-enabled export. Headless checks also accepted AAC and silent clips and rejected
unreadable media. Ten scoped tests, scoped ESLint, production build and whitespace
checks passed.
No Opus fidelity limitation was relaxed.

### Remaining gates

Representative owned/consented moving footage is still needed for the full
quality matrix. A commercial SDK licence is needed only if that alternative is
chosen. No licence purchase, vendor outreach or provider media upload has been
performed. Browser/device qualification, occlusion handling, export fidelity,
production CSP, Library persistence and any commercial pricing remain pending.
The production customer-facing feature is not enabled.
