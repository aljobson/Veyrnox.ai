# ADR-0091 — Isolated local automatic captions

Status: implementation and integrated verification in progress. Independently gated by request-time `EDITOR_LOCAL_INFERENCE_ENABLED`; production remains off.

## Decision

Recognize the actual audible timeline mix on the user's device. Use the existing export mixer for mute/solo, gain, fades, rate curves, reverse and audio processing, then low-pass and resample the bounded edit to mono 16 kHz. The initial maximum is 120 seconds. Existing decode/mix memory bounds apply. Silence and invalid samples are refused before inference.

Run Whisper tiny's quantized timestamp-capable ONNX conversion through the browser-only Transformers.js 3.8.1 distribution in a dedicated URL module Worker. No Node inference dependency, remote model host, paid provider, microphone permission or audio upload is introduced. The user triggers the roughly 65 MiB model download and sees processing/cancellation status. CPU work can take minutes; results require review, particularly lyrics, music, noise and accents. Cancellation, account/edit changes and unmount terminate the Worker; completed cues are inserted atomically and remain editable/undoable. Missing, overlapping or sub-frame word intervals are rejected, never replaced with estimated automatic timings.

The Worker has its own exact-response CSP allowing WebAssembly evaluation and script/connect access only within this immutable same-origin asset prefix. HTML retains its nonce policy and no WebAssembly allowance is added to the page. Single-thread, non-proxy ONNX avoids nested Worker or cross-origin isolation exceptions. No browser/FS application model cache stores audio. Ordinary HTTP caching of immutable public model assets remains possible.

Asset inventory `scripts/local-speech-assets.json` pins every source revision, archive integrity, byte count and SHA-256. Preparation verifies the npm tarball before streaming known members; model download bytes are checked before writing. The decoder exceeds Cloudflare's per-asset 25 MiB bound, so preparation emits two ordered fragments below the limit. Both fragments and their reassembled complete model are checked in builds and the browser. A generated manifest SHA-256 is embedded into the Worker. Post-OpenNext verification checks the exact file set, notices, Worker source, manifest, every asset and complete decoder. Assets are generated and excluded from Git.

## Provenance and licence

The fixed [upstream Whisper tiny model card](https://huggingface.co/openai/whisper-tiny/blob/a8d76517e6d65d92771752dbbf5e9c0a1a5b3a0d/README.md) declares Apache-2.0. The fixed [timestamp conversion card](https://huggingface.co/onnx-community/whisper-tiny_timestamped/blob/517244293732ee2d58139af5814231b7e6830a0d/README.md) identifies that base model and introduces no separate licence. Preserve both cards and the Apache licence with the converted weights. This is provenance from the named original and conversion; it does not imply permission to copy another product's proprietary model.

Preserve the Transformers.js package Apache licence, ONNX Runtime's [MIT licence](https://github.com/microsoft/onnxruntime/blob/89f8206ba4/LICENSE) and full [third-party notices](https://github.com/microsoft/onnxruntime/blob/89f8206ba4/ThirdPartyNotices.txt) for its bundled WASM revision. The downloaded runtime and existing converted model byte sequences are preserved; this application creates their delivery fragments and its own Worker/adapter.

Primary contracts: [Transformers.js word timestamps](https://huggingface.co/docs/transformers.js/v3.8.1/api/pipelines), [local-only environment controls](https://huggingface.co/docs/transformers.js/v3.8.1/api/env), [ONNX web deployment](https://onnxruntime.ai/docs/tutorials/web/deploy.html), [Worker response CSP](https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Using_web_workers#content_security_policy), [Cloudflare static asset limit](https://developers.cloudflare.com/workers/platform/limits/#static-assets).

## Evidence and remaining qualification

In a disposable native Chrome probe using the same pinned runtime, model bytes, verified decoder fragments and isolated Worker-response CSP, a real 3.990625-second synthetic spoken fixture produced “Hello world, this video editor creates captions on your device.” in 53,360.9 ms with ten measured word chunks spanning 0–3.82 seconds. Parent task drove the browser and observed cancellation/restart. This demonstrates actual model inference, rather than a mocked recognition response. Only English speech on this fixture is qualified so far; it establishes no accuracy threshold for other languages, singing or arbitrary speakers.

The integrated editor journey, real caption insertion, cancellation, public asset headers, production build asset verification and Reticle verdict must be recorded before declaring the feature complete. Provider catalog licences, remote voice/avatar entitlements and paid production gates remain separate.
