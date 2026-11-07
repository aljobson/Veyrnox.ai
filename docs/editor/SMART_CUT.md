# Smart Cut — timed transcription and silence removal

**Status:** server and phone implementation draft built; flags OFF, model inactive, migrations unapplied. Regression suites are added; database execution and reserved fal admission integration remain unverified; see [speech-cut ADR](../adr/0000-mobile-speech-cut.md).
**Extends:** [Clip Editor PRD](./PRD.md) and [captions addendum](./CAPTIONS.md).

## Product slice

The first speech-aware slice is intentionally narrow:

1. Analyse each selected clip into a versioned, provider-neutral timed transcript.
2. Keep transcript-backed ranges and remove pauses of at least 0.75 seconds.
3. Add 120 ms of context at each kept edge, merge overlaps, and reintroduce the shortest pauses when needed to stay inside the existing 10-section limit.
4. Stop at the Clip Editor's existing 60-second output limit.
5. Let the user preview every boundary and apply the resulting ranges to the existing trim/stitch renderer.

This slice does not score faces, delivery, framing, or technical quality. It does not align alternate takes to a script, so a transcript-backed section cannot be swapped onto an unanalysed take.

## Boundary contract

`app/veyrnox/_lib/smartCutAnalysis.js` owns schema version 1:

```json
{
  "version": 1,
  "assetId": "job UUID",
  "duration": 8.04,
  "provider": "fal-scribe-v2",
  "transcript": "Full normalized transcript",
  "language": "en",
  "chunks": [
    { "start": 0.18, "end": 1.04, "text": "First phrase" }
  ]
}
```

Provider output is untrusted. Asset id, source duration, timestamp bounds, text sizes and chunk counts are checked before a record can reach the planner. Invalid or mismatched analysis fails closed.

## Provider decision and paid probe

Use `fal-ai/elevenlabs/speech-to-text/scribe-v2` as the primary timed-speech provider. A bounded 2026-11-06 probe ran against synthetic Veyrnox-owned MP4 fixtures through a temporary remote Worker that could read the existing production `FAL_KEY` secret without printing it. Nothing was deployed and the preview Worker was stopped after the probe.

Scribe accepted the MP4s directly, returned word-level timestamps, returned an empty transcript with `words: []` for silence, and exposed a clean 1.80 s between-word pause as a 0.74→2.54 timestamp gap. Four requests covering 18.8 input seconds completed in 2.36–2.94 s each. At the documented `$0.008/min` rate, the probe cost was about `$0.0025` in total.

| fixture | request id | latency | observed result |
| --- | --- | ---: | --- |
| continuous speech | `01a1b0a8-2014-79d0-a319-700f8eab686f` | 2660 ms | correct transcript and word timestamps |
| pause inserted inside a word | `01a1b0a8-22d2-7033-b71b-07eeffba36e8` | 2936 ms | one word stretched over the artificial pause; not a valid cut boundary |
| four seconds of silence | `01a1b0a8-21f0-71a3-a166-e20b88820462` | 2784 ms | empty text, zero language probability and no words |
| clean pause between words | `01a1b0a8-7f65-7e83-9de7-575b13226050` | 2359 ms | 1.80 s word gap, suitable for deterministic silence removal |

`fal-ai/wizper` is retained only as a normalized compatibility input, not as the production choice. Three matching probes completed in 2.39–2.95 s, but its chunk output hid the clean pause inside one broad segment and it hallucinated `"you"` on a silent clip. It therefore cannot be the sole silence signal. Request ids: `01a1b0a6-734a-7021-bfa4-51354fb7277b`, `01a1b0a7-2ab1-7cb3-a7be-27c3804ebba6`, and `01a1b0a7-2e0c-7d70-a19d-0749cc64f1c8`.

This probe resolves direct MP4 acceptance, the response shape needed by the normalizer, useful pause precision, silent-input behavior, representative short-clip latency and the first cost bound. It does **not** resolve 15/60-second latency, webhook verification, music-only, multiple speakers, non-English speech, unusual codecs, or failure/refund behavior. Production submission remains off until those cases and the job lifecycle are covered.

Official candidate documentation:

- <https://fal.ai/models/fal-ai/wizper/api>
- <https://fal.ai/models/fal-ai/elevenlabs/speech-to-text/scribe-v2/api>
- <https://fal.ai/models/fal-ai/silero-vad/api>

## Production architecture

Analysis is a separate, explicit user action—not a side effect of opening Smart Cut.

1. An authenticated `POST /api/v1/editor/speech-analyses` accepts only `{source:{type:'job',jobId}, duration, expectedCredits, idempotencyKey}` for owned stored jobs. Project assets and local-device clips are excluded.
2. Read quota covers quote/status/replay. New admissions verify ownership, persist a bounded server probe and compare duration and catalog price before generation quota and one ledger debit.
3. One queued analysis step per unique source receives a short-lived presigned R2 URL. Signed webhooks normalize the provider payload into the versioned contract. The persistence envelope—not the browser contract—stores it against `(user_id, asset_id, source_fingerprint, schema_version)` and verifies that fingerprint before returning the analysis.
4. The client polls the owner-only analysis/by-key endpoints (three-minute phone deadline). Completed records are returned only to their owner; raw provider payloads and signed URLs never reach the browser.
5. Planning is deterministic and free: the phone derives ranges locally and applies them to its timeline as one Undo entry. Export/render remains the editor's separate action.
6. Definitive failure refunds once. Ambiguous submission waits for a signed callback or the speech-specific 15-minute timeout; it never triggers immediate resubmission or refund. Rendering remains a separate confirmed charge because the user can review or abandon the plan before creating a video.

The source fingerprint must change when the stored object changes, preventing a transcript from being reused against different bytes with the same logical id. Analysis retention follows the source Asset; deleting the source deletes its transcript and timed chunks.

## Privacy and observability

- The confirmation screen must say that audio is sent to the selected transcription processor and link to the applicable privacy disclosure.
- Do not log transcript text, provider URLs or raw payloads. Operational events may include provider, duration bucket, language code, chunk count, latency and typed failure code.
- The analysis response must be `Cache-Control: no-store` and bounded to the fields in the versioned contract.
- Keep script text and editing notes browser-local unless the user explicitly includes them in a future analysis request.

## Follow-on slices

1. Schema/RPCs and money acceptance tests exist in 0451/0452 and `packages/db/speechAnalysis.acceptance.test.ts`. Execution needs an owner-provisioned local database. Direct `ledger_debit` is refused by reserved-only fal policy; the proposed admission-flow deviation needs owner review before launch.
2. Submission, signed webhook dispatch, metadata-only deduplication, refunds and recovery have injected node:test regression coverage. Live failure webhooks remain unprobed.
3. Extended provider probe for long clips, additional languages/codecs and signed webhook failures.
4. Phone quote/confirmation, progress, reviewable silence/retake suggestions and atomic Apply remain flag-off, with planner parity and installed test-renderer coverage. The host waived ARTEMIS exploration; device layout/accessibility checks remain unperformed.
5. Script-to-transcript alignment and alternate-take comparison.
6. Optional filler-word suggestions; never remove uncertain words without review.
