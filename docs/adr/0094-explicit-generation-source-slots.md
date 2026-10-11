# ADR-0094 — Explicit Library source slots for editor generation

Status: implemented in the completion branch; browser verification and hosted qualification remain separate. No catalog activation, price change, production SQL or paid inference is performed by this change.

## Context

The editor omitted models with an end-frame slot. The gateway accepted Library source IDs as a string array and resolved every image into `image_url`; a second image therefore conflicted with the first instead of becoming Kling's optional end frame. The capability registry already mapped the two internal fields to Fal's correct start/end provider fields. A client cannot safely fix this by supplying provider URLs because ownership, expiry and byte inspection must precede debit.

## Decision

Extend `source_assets` with exact descriptors `{ "asset_id": "<owned job UUID>", "slot": "image" | "endImage" | "video" | "audio" }`. The request remains bounded to two total upload/Library references. Legacy string arrays retain their image-only meaning, including duplicate image rejection. Mixed legacy image and explicit end-frame references remain supported. An asset may occupy both distinct image slots; cache its inspection within the request rather than rejecting a deliberate loop-frame assignment.

Resolve explicit descriptors only for slots declared by the selected active capability record. Duplicate explicit slots, unknown slots, malformed IDs, extra descriptor properties and incompatible MIME types are refused before debit or provider dispatch. Selection of the active, ungated catalog record and provider configuration occurs after the attempt quota check and before source I/O. Strict boolean `consent: true` is required whenever any source is used; unrelated consent-shaped fields do not satisfy it.

Every Library asset is looked up with the authenticated actor through `get_user_asset`, must be stored and unexpired, and passes the existing bounded R2 byte sniff and measured dimension/duration rules. Images accept JPEG, PNG and WebP; video accepts MP4; audio accepts MP3 and WAV. Explicit video/audio sources use existing declared capability slots and retain their size and duration bounds. Legacy callers of `resolveAssetSource` remain image-only. Only the gateway's 15-minute signed URLs become provider inputs. Raw client media URLs are removed or rejected at the request boundary. Jobs record source IDs by internal slot, never signed URLs; the upload cleanup sweep still sees only actual upload keys.

The editor shows required Start frame and optional End frame controls from the public capability view, filters Library choices by exact accepted MIME, sends only ID/slot descriptors and includes role assignments in the idempotency signature. Changing the actor clears source selection and consent. Source changes require the existing rights statement to be checked again. Successful Library-source jobs now invoke the same existing job-level and versioned account-level consent attestation RPCs as upload-source jobs, before submit; their existing failure reporting semantics are retained.

## Provider contract and price boundary

The [Fal Kling 3.0 Pro image-to-video schema](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api), checked 11 October 2026, requires `start_image_url`, accepts optional `end_image_url`, supports provider durations from 3 to 15 seconds and defaults native audio on. This implementation preserves the repository's existing priced 5/10-second choices and `generate_audio: false` pin. It adds neither native audio nor multi-shot/element controls. Credits continue to come from the selected catalog row; no current provider cost is inferred from the schema or hard-coded UI fallback.

The [Fal LatentSync schema](https://fal.ai/models/fal-ai/latentsync/api), checked on the same date, requires separate video and audio inputs. Gateway tests exercise those existing slots with inspected actual MP4/WAV fixtures and the registry's existing 40-second bounds. This does not expand which non-prompt models the editor lists or constitute a paid provider qualification.

## Verification and rollout evidence

On 11 October 2026, 99 focused speech/audio/Auto Short/generation/editor/source regression tests passed. New gateway tests use actual PNG, the repository's original synthetic H.264/AAC MP4 fixture and valid PCM WAV bytes with range reads. They prove proper start/end provider fields, optional and same-image frames, mixed/legacy compatibility, video/audio container and duration inspection, foreign/expired assets, mismatched declared/actual MIME, strict consent, source count/slot limits, active registry ordering, source-ID persistence, consent receipt calls and idempotent no-resubmit behavior. Provider and database transports in these tests are mocked; no paid job is submitted.

The parent task owns integrated Reticle verification of choosing both frames, optional-frame clearing and the pre-submit permission journey. A read-only terminal request to the production public catalog returned HTTP 403; it does not establish whether a model is active. Live signed-in catalog evidence, frontend and gateway deployment, a separately authorized paid start/end output and its actual billed cost remain hosted qualification gaps. Ship the matching frontend/gateway contract together, or the older gateway will reject descriptor objects. Existing feature flags and the other editor rollout observation windows remain unchanged by this decision.


The editor also exposes the existing `kling-avatar-v2` and `latentsync` contracts in a dedicated avatar/lip-sync mode. It requires their owned photo/video plus speech audio slots and displays the existing 10/40-second source limits. Source-driven output omits quantity controls and quotes one current catalog unit. The separate voiceover mode lists only speech-classified live catalog models and preserves the existing text/voice/dialogue contracts. This is additional UI access to established gateway routes; no new model, provider, price, catalog migration or paid verification is introduced.


Safe public input metadata now includes each registry's numeric `max`. This fixes the existing normalization mismatch where `useCatalog` requested the prompt bound but the public registry view omitted it, displaying 2000 characters for speech paths limited to 1000. Exact public-shape and editor/gateway bound tests retain the true model limits without publishing provider fields, prices or pinned values.
