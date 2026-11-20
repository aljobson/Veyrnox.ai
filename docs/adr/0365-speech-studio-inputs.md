# ADR-0365: Speech studio controls reach their provider

Status: implemented, pending independent review

## Context

Text to speech sent `tts_voice` and received `inputs_key_not_allowed:tts_voice`
before any credit was spent. The global allowlist omitted all six TTS controls
and all four Dialogue studio cast controls. Their model records also omitted
them, so extending only the allowlist would silently discard the choices.

## Decision

The global gate and the MiniMax speech-2.6-hd capability share these rules from
`lib/speechInputs.js`. Server constants have no dependency on the web client;
tests compare the lists to the web exports to prevent drift.

| Input | Allowed values |
| --- | --- |
| `tts_voice` | The studio's 17 voice IDs |
| `tts_language` | The studio's 18 language values, including `auto` and `Chinese,Yue` |
| `tts_emotion` | neutral, happy, sad, angry, surprised, fearful, disgusted |
| `tts_speed` | Finite number, 0.5–2 |
| `tts_volume` | Finite number, 0–10 |
| `tts_pitch` | Integer, -12–12 |
| `dialogue_voice_1` through `dialogue_voice_4` | Aria, Roger, Sarah, George |

Bad values return `400 inputs_invalid:<key>`. Numeric strings are not coerced.
Globally valid speech controls sent to a model that does not declare them
return `400 inputs_key_not_allowed:<key>` before debit, free-job admission or
provider submission. The ordinary attempt rate-limit RPC still precedes that
model guard. Other shared create-page controls retain their existing drop behavior.
In particular, MiniMax still drops `voice_description`.

Only MiniMax speech-2.6-hd declares the six TTS controls. It consumes their web
names and builds `voice_setting` (`voice_id`, `speed`, `vol`, `pitch`, `emotion`)
and `language_boost`. Omitted controls remain omitted so fal defaults apply.
The studio permits volume zero; fal requires at least 0.01, so volume is mapped
to `max(0.01, tts_volume)`. Zero therefore means fal's minimum volume, not silence.
The prompt-only payload remains unchanged, including `output_format: 'url'`.

Only fal's ElevenLabs eleven-v3 dialogue record declares the cast controls.
Distinct, contiguous choices apply to speakers in first-appearance order;
unused voices complete the order. Duplicates or gaps return `dialogue_invalid`.
No cast choices preserve the existing Aria, Roger, Sarah, George order.
The kie dialogue record rejects cast keys; Dialogue studio selects the fal model.

The ten speech controls carry `hidden: true`: `/api/catalog` (`publicCapabilities`)
omits them, so the public model pages and the phone's fact rows do not list
studio-only controls (raw voice ids, four identical cast rows). They stay
declared on the records, so the models accept them. `number` rules exist for
other callers but none is published for these models.

## Verification and limits

Node tests cover both validation gates, web payloads, default preservation,
provider field mapping, cast order, catalog projection and route rejection
without money or provider effects. Provider requests and database calls in
route tests are mocked. The schema fixture is a trimmed copy of fal's public OpenAPI input schema for
MiniMax speech-2.6-hd, captured 2026-11-19 (no paid call).

No price, prompt cap, idempotency, ledger, migration, webhook, adapter, Worker
binding or client changes. No live provider generation or deployment is verified.
The pre-existing generations route exceeds the 500-line rule (573 before this
change); this work adds only the planned import and guard extension there,
leaving a route decomposition for separate review.
