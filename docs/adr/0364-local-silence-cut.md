# ADR-0364 — A free silence cut that runs on the device (Smart Cut, no upload, no Credits)

- **Status**: **Proposed 2026-11-19.** Plan only: no code, no flag, no migration, no price, no model download. The owner accepts it by merging the change and answering the decisions at the end.
- **Related**: ADR-0331 (speech analysis and reviewable phone cuts: the server path this sits beside), ADR-0090 (local processing and local assets: the on-device captions this reuses the pattern of), ADR-0014 (floor pricing), `docs/editor/SMART_CUT.md` (planner, pacing presets, filler suggestions).
- **Origin**: a static study of another Android editor (2026-11-19, behaviour and architecture only; no code, assets, model files or copy are adopted) showed it trims pauses on the device and sends only the speech to a server. That is the one idea we do not have.

## Context

Smart Cut today always goes to the server. A person pays **5 Credits** (since 0566), the whole audio goes to a transcription processor (fal Scribe v2), and a clip may be at most 60 seconds (ADR-0331). That is the right path for fillers and retakes, which need words. It is more than the common case needs: most people who open Smart Cut want the dead air and long pauses gone, which needs only to know where speech is, not what was said.

What we already have:

- **A local speech worker on the web.** `app/veyrnox/_lib/localSpeechAssets.mjs`, `scripts/local-speech-worker.mjs` and `scripts/prepare-local-speech.mjs` run `whisper-tiny_timestamped` through transformers.js 3.8.1 in a Worker. Every asset is pinned by revision and SHA-256, served from our own origin (`public/editor-speech/<version>/`, built at prepare time, not committed), checked against a pinned manifest, and loaded under a locked CSP (`localSpeechWorkerPolicy`). The decoder alone is 30.7 MB. It powers local captions, bounded to 120 s (ADR-0090). None of this touches the Worker script, so the Cloudflare text-binding and bundle limits are not in play.
- **A deterministic planner** that turns speech intervals into reviewable cuts: pacing presets, 120 ms edge padding, the 10-section and 60-second caps, and a review screen with one Undo (`smartCutAnalysis.js`, `speechCut.ts`).
- **No on-device speech runtime on the phone.** `apps/mobile` has `expo-audio` and no ML runtime or PCM decoder, so the phone's Smart Cut is server-only.

The analysis contract (`parseSmartCutAnalysis`, version 1) is a **server** contract: it accepts only `fal-scribe-v2` and `fal-wizper`, requires non-empty text on every chunk, and is what `lib/speechAnalysis.js` persists. A silence-only result has no words and must not enter it.

## Decision (proposed)

Add a **local silence cut**: decode the clip's audio on the device, find speech with a voice-activity detector, hand the planner the speech intervals, and let the person review and apply them as today. No request, no Credits, no ledger, no upload. **Web first; phone later, after a measured spike.**

### Detector (web)

| Option | What it is | For | Against |
|---|---|---|---|
| **A. Silero VAD (ONNX), recommended** | a small voice-activity model run in a Worker through the onnxruntime-web WASM that transformers.js already ships | good on noise and music beds; about 2 MB (to be pinned and measured); runs well faster than real time | one more pinned model; licence to be confirmed at pin time (believed MIT) |
| B. Energy (RMS) threshold | plain code, no model | nothing to host; trivial | fooled by background noise and music; needs per-clip tuning |
| C. Reuse whisper-tiny timestamps | the model we already host | gives words, so fillers could work locally | 30 MB decoder, slow, and tiny drops hesitation sounds, so poor for exactly the fillers we want |

Recommend **A**, with **B** as the same-interface fallback if A fails the measurements below. Reject C for this feature.

### What it can and cannot do

Silence and pause removal only. **No fillers and no retakes**: they need words, so they stay on the server path. The screen must say so plainly and offer the server path (5 Credits) for them.

### Data shape

Do **not** widen the server contract. A new local-only record, `{ source: 'local-vad', assetId, duration, intervals: [{ start, end }] }`, is converted in memory to the planner's input with `timingQuality: 'interval'` and a plan warning ("This cut found speech, not words, so fillers and retakes are unavailable"). It is never sent to a server and never persisted by `lib/speechAnalysis.js`; a test pins that the persistence path rejects it.

### Switch and limits

- One key, `localSilence`, in the existing `EDITOR_RUNTIME_FLAGS` (no new Worker binding; absent means off; ships off).
- First bound: 120 s per clip, matching local captions, because the whole clip is decoded in memory. The planner's 10-section and 60-second output caps are unchanged. Pacing presets are shared with the server path.
- No Credits: no ledger, RPC, route or price. A clip over the bound says so and offers the server path where it applies.

### Phone

Deferred. A phone path needs a native audio decoder and an inference runtime that we do not ship, so it means new native dependencies, a new EAS build and a store build, and a binary-size cost nobody has measured. Plan a **spike** (separate, measured, owner-approved) that answers: can we decode a 60 s clip to 16 kHz mono PCM on both platforms, what runtime runs Silero (for example `onnxruntime-react-native`), what is the binary-size delta, and how long does a 60 s clip take on a mid-range phone. Until then the phone keeps the server path.

## Verification before anything ships

A fixture set of short recordings: quiet speech, music or noise bed, two accents, one non-English clip, deliberate dramatic pauses, and a whistled or laughing clip. Compare the VAD intervals with a Scribe-derived reference on the same clips. **Proposed acceptance bars, to be agreed:** at most 1% of words clipped; 95th-percentile boundary error 120 ms or better; a 60 s clip analysed in under 5 s on a 2020-era laptop; peak memory under 300 MB; the result identical across two runs. Also: CSP and integrity-check tests like the captions worker's, a test that the persistence path rejects local records, and an i18n pass for the new strings in all 11 locales.

## Risks

- **Browser audio decoding differs** (Safari and Firefox handle `decodeAudioData` and WebCodecs differently): decode through one tested path and fail with a clear message.
- **Whole-clip memory:** the 120 s bound and a 16 kHz mono copy keep it small; large source files may still fail to decode, which must read as "try a shorter clip", not as a blank error.
- **Model licence and provenance:** pin by revision and SHA-256 like the captions model; confirm the licence text before the first commit that adds it.
- **A free path that is good enough could reduce paid analyses.** That is a pricing decision, not an engineering one, and it is on the list below.

## Decisions for the owner

1. **Web first, phone after a spike?** (Recommended: yes.)
2. **Free for everyone**, or limited to a plan? (Recommended: free; it costs us nothing per use.)
3. **Model choice:** Silero VAD (A) with an energy fallback (B). (Recommended.)
4. **Acceptance bars** in "Verification": agree or change them before the build starts.
5. **Spike budget for the phone:** approve an investigation that may conclude "not worth a native build".

## Out of scope

Fillers and retakes without a server round trip; changing the 5-Credit server price; any change to the server analysis contract or the ledger.
