# Speech and catalog integration evidence — 11 October 2026

Status: implementation and browser qualification in progress. A helper test or a downloaded model does not establish automatic speech recognition in the deployed editor.

## Implemented contracts

`editorTranslation.mjs` translates caption cues through the browser's `Translator` API. Creation is initiated directly by a user action, while feature and language-pair availability are checked separately. Download and translation progress are reported; cancellation destroys the translator. The operation returns one complete result, keeps cue identity/timing/style and removes obsolete source-language word alignment. Unsupported browsers do not receive a cloud fallback. Four behavioral tests cover identity/timing preservation, invalid later output, cancellation and unavailable APIs; these do not measure the browser model's translation quality.

Chrome's [official Translator documentation](https://developer.chrome.com/docs/ai/translator-api) describes on-device language packs, user-triggered creation, availability and download progress. Its documented support is desktop browsers with the API, rather than all editor browsers.

`editorAssetPacks.mjs` and `AssetPackPanel.js` provide a usable, data-only local catalog extension. A version-1 manifest grants exactly `local-catalog`; it cannot execute code or access accounts, network, payments or project data. Assets declare local filenames, type/category/tags, SHA-256 and source/usage metadata. An explicit file selection and successful type/name/hash check precede normal editor ingestion. A pack can also be created from selected local files and downloaded as JSON. Limits are 40 items, 128 KiB JSON and 256 MiB of selected media, in addition to normal per-file/editor limits. Local media still requires relinking after a fresh project reopen. Four behavioral tests cover preserved metadata, digest mismatch, duplicate/path/script rejection and cancellation/bounds.

A recorded usage statement is supplied by the importer; it is not a provider entitlement. This contract does not imply that Epidemic Sound or GIPHY can be distributed by the platform.

`editorSpeechAudio.mjs` uses the existing audible timeline mix, including gain, mute/solo, fades, speed mapping, reversal and DSP. It reads existing local blobs and resamples to mono 16 kHz with an anti-aliasing filter; the initial bound is 120 seconds. Its existing mix-memory bounds remain in force. `editorSpeechTiming.mjs` accepts actual model word intervals only and maps them to editor frames. Missing, zero, overlapping or out-of-range intervals are refused instead of being replaced with estimated timings. Four meaningful tests check duration/stereo mixing, frequency suppression, cancellation/invalid samples and timestamp mapping/refusal. These tests do not run a recognition model.

## Pinned local recognition implementation

The isolated browser proof is in `/private/tmp/codex-editor-speech-spike`, using disposable synthetic speech rather than owner footage. Application dependencies, production flags and the application CSP were not changed to prepare this proof.

The browser distribution is [`@huggingface/transformers` 3.8.1](https://huggingface.co/docs/transformers.js/v3.8.1/api/pipelines), Apache-2.0, obtained from its pinned npm tarball. Its standalone distribution includes ONNX Runtime Web and a single-thread WASM runtime, so no server inference dependency is needed on the Worker import graph.

| Asset | Bytes | SHA-256 |
|---|---:|---|
| transformers.min.js | 888173 | aa5002b70e789798da263f5f99c62bd3e8fcd0c119258a493c40c180648365fa |
| ort-wasm-simd-threaded.jsep.mjs | 44484 | 08fb86ec433c78bfb032c5d84a68b8e8e5a8d81268fa39e24314179a5767a5b9 |
| ort-wasm-simd-threaded.jsep.wasm | 21596019 | c46655e8a94afc45338d4cb2b840475f88e5012d524509916e505079c00bfa39 |
| encoder_model_quantized.onnx | 10097109 | d4397fbfed1975bb5dd1bedb748808367331c85293f54cbc927774728daec2b2 |
| decoder_model_merged_quantized.onnx | 30730264 | ced2053c1aa8ff7048927197416a5c169f50010e7b280e5d564b46a991fca011 |
| decoder part 0 | 16777216 | 4d47f37ac703ebf80538706fefe53734f95a39a0aa2fc14aa3121192f919a90e |
| decoder part 1 | 13953048 | eedf3e1f21d1bb6339526a5f483ca6d0b3521fa2e3574c1ba11d07fb1ab4e8b1 |

Models and tokenizer/config files come from [onnx-community/whisper-tiny_timestamped commit 517244293732ee2d58139af5814231b7e6830a0d](https://huggingface.co/onnx-community/whisper-tiny_timestamped/tree/517244293732ee2d58139af5814231b7e6830a0d). Its conversion card identifies `openai/whisper-tiny` as the base model, but states no separate conversion licence. The [original model card at a8d76517e6d65d92771752dbbf5e9c0a1a5b3a0d](https://huggingface.co/openai/whisper-tiny/tree/a8d76517e6d65d92771752dbbf5e9c0a1a5b3a0d) declares Apache-2.0. Upstream OpenAI Whisper code is separately MIT. The generated asset set retains the Apache package licence, both model cards, ONNX Runtime MIT licence and complete third-party notices at its fixed WASM revision. No separate provider entitlement is inferred from the conversion filename.

The decoder exceeds the [25 MiB Cloudflare static asset limit](https://developers.cloudflare.com/workers/platform/limits/#static-assets). The preparation and post-build verification scripts verify its original digest, produces two at-most-16-MiB chunks and verifies both chunk digests. A documented [`env.customCache.match`](https://huggingface.co/docs/transformers.js/v3.8.1/api/env) returns their reconstructed, verified `Response` to the model loader. Remote models, runtime CDNs and remote inference are disabled. The largest required single asset is 21,596,019 bytes.

A dedicated same-origin module Worker can use a CSP on its own script response while the page's policy remains unchanged. [MDN documents this separate worker execution policy](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy). The Worker script and connect sources name only the immutable speech asset prefix; `wasm-unsafe-eval` applies only to that exact worker response. No JavaScript `unsafe-eval`, inline code, remote origins, nested workers, microphone permission, COOP/COEP or auth exceptions are introduced. Single-thread execution avoids shared-memory policy changes. Cancellation terminates the worker, with account/edit generation checks discarding stale results. The disposable native Chrome probe produced the exact spoken sentence “Hello world, this video editor creates captions on your device.” with ten real word chunks from 0–3.82 seconds in 53,360.9 ms. Cancellation and restart were observed; all model/runtime requests used the local origin. This qualifies one English fixture, without establishing quality for singing or every language. The integrated editor Reticle verdict and deployed header/asset checks remain required.

Fresh preparation from the pinned sources verified 23 static assets totalling 68,104,854 bytes, with a largest asset of 21,596,019 bytes. Ten additional focused tests cover actual timestamp acceptance/refusal, bounded PCM-only Worker messaging, atomic cancellation, silence, runtime failure, scoped CSP, corruption, unexpected files and incorrect decoder reassembly. The client/component add an explicit user-triggered model download, language selection and atomic cue insertion; production uses the independent `EDITOR_LOCAL_INFERENCE_ENABLED` gate. See [ADR-0091](../adr/0091-isolated-local-speech-recognition.md).

## Provider gaps with inspected primary contracts

- Existing Kling 3 image-to-video already declares required `image` as `start_image_url` and optional `endImage` as `end_image_url` in `lib/modelCapabilities.js`. Migration 0085 reactivated its catalog row. The completion branch now exposes Start/End frame Library choices with explicit bounded source descriptors (ADR-0094); the picker uses image semantics for both slots. Current live model/catalog qualification still decides availability and pricing. BytePlus's existing contract has optional first image only and explicitly does not provide end-frame/extension editing.
- The existing `veed/subtitles` path returns a styled MP4, not editable words or a transcript. Its invoice qualification is recorded as incomplete in `CAPTIONS.md`; it cannot be used to claim free automatic word transcription.
- [Epidemic Sound's current Partner API documentation](https://developers.epidemicsound.com/docs/) requires access and distinguishes prototype access from production/commercial licensing. Production use is governed by a Partner API agreement and order form. No such credentials/entitlement was inspected for this rollout. A local imported catalog does not grant those rights.
- [GIPHY's current integration requirements](https://developers.giphy.com/docs/api/) require client requests, branding, restrictions on mixing results, and written approval for partner caching. Importing provider media into an editable/exportable local project is not assumed authorized by a standard API key. No GIPHY integration approval was inspected.
- A general speech model may recognize sung vocals, but this is not evidence of reliable lyrics alignment or vocal isolation. Qualify real synthetic singing, keep correction available and label failures honestly. No new paid lyrics/voice/avatar call or fabricated catalogue price was added.


## Existing voice and avatar routes exposed in the editor

The parent task inspected the live public production catalog on 11 October 2026. It reported the four Fal speech rows and both Fal avatar/lip-sync rows below. The terminal read available to this subtask returned HTTP 403, so the live result is attributed to that browser inspection rather than inferred from migrations or provider-key presence. No `FEI` provider identifier exists in the inspected registry. KIE speech contracts exist separately; they are not interchangeable with Fal voice identities, and absent live rows are not fabricated into the picker.

| Model ID | Registered provider contract | Inspected live catalog | Existing bound/inputs |
|---|---|---|---|
| `elevenlabs-tts-turbo` | Fal ElevenLabs Turbo 2.5 | Present, parent browser inspection | Up to 1000 spoken characters; existing provider voice/defaults |
| `elevenlabs-dialogue` | Fal ElevenLabs dialogue v3 | Present, parent browser inspection | Up to 1000 script characters and four `Name: line` speakers; existing Aria/Roger/Sarah/George mapping |
| `inworld-tts` | Fal Inworld TTS | Present, parent browser inspection | Up to 2000 spoken characters; existing defaults |
| `minimax-speech-2.6-hd` | Fal MiniMax Speech 2.6 HD | Present, parent browser inspection | Up to 1000 spoken characters; URL output pinned |
| `qwen-3-tts-voice-design` | Fal Qwen 3 TTS Voice Design | Not present in the inspected live catalog; staged by 0235 | Up to 1000 spoken characters plus required voice description up to 500; no voice recording/cloning slot |
| `elevenlabs-tts-turbo-kie` | KIE ElevenLabs Turbo 2.5 | Not present in the inspected live catalog | Up to 1000 spoken characters; existing Rachel voice pin |
| `elevenlabs-dialogue-kie` | KIE ElevenLabs dialogue v3 | Not present in the inspected live catalog | Up to 1000 script characters and four speakers; separate KIE voice IDs |
| `kling-avatar-v2` | Fal Kling AI Avatar v2 Standard | Present, parent browser inspection | Required owned photo and speech audio at most 10 seconds; existing direction prompt |
| `latentsync` | Fal LatentSync | Present, parent browser inspection | Required owned video and speech audio, each at most 40 seconds; no prompt |

`GenerationPanel` has separate voiceover and avatar modes, both using only actual live ungated catalog rows. Public capability metadata now carries the registry's numeric input bounds, fixing the prior speech mismatch where the editor normalized an omitted bound to 2000 despite a 1000-character gateway limit. Voiceover output can be added to an editable audio track. Avatar mode selects an owned Library photo/video and an owned Library speech recording, states each source's inspected duration limit, and requires the existing rights and identifiable-person consent statement. Generated voiceover can be selected after its normal job has completed in the Library. Every source uses the explicit actor-owned and byte-inspected descriptor contract from ADR-0094; preview URLs never become provider inputs.

Avatar and lip-sync output follows the source audio, so this mode offers no invented output-duration selector and sends no `duration_seconds` quantity. It quotes one existing catalog unit under the registry's already bounded contract; no provider price, activation, voice entitlement or discount is invented. Source changes/model changes reset permission confirmation, and source-only LatentSync sends an empty declared input object rather than leaking a hidden prompt. Root task retains the mounted panels while switching editor tabs, preserving accepted-job polling and Library recovery.

The current [Kling avatar schema](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard/api) and [LatentSync schema](https://fal.ai/models/fal-ai/latentsync/api) confirm separate photo/video and audio fields. Ninety-nine focused speech/audio/Auto Short/generation/source/editor tests passed, including real source-container inspection behind mocked transport. They do not establish a paid model-output or hosted deployment qualification. The draft picker/permissions journey requires the root task's Reticle verdict; real provider execution/billed-cost evidence remains separate and was not performed by this subtask.
