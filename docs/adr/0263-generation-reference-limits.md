# ADR-0263: Ordered generation references with verified model limits

Date: 2026-10-25
Status: Implemented behind a disabled flag; database migration and release proof pending.

## Decision

`MULTI_REFERENCE_ENABLED` uses the late-flag pattern: it is absent from `wrangler.jsonc` to preserve the production variable budget. Absent or anything other than the exact string `"true"` means off. The owner may set it later through the dashboard/secret only after review. With it off every media slot accepts one file. With it on, a slot accepts its verified `max` (1–3, default 1), exposed as `capabilities.media[slot].maxFiles`. A count above one requires an array field and HTTPS documentation for both the count (`verification`) and price (`priceVerification`), plus a valid calendar date (`verifiedAt`). `effectiveMaxFiles` fails closed to one if any evidence is missing or invalid; an exhaustive registry test checks every capability, including additional provider records. `list` determines provider shape independently: an existing list field still receives a one-element array when the flag is off. No model price, activation status, credit calculation or refund formula changes.

The owner requested up to three of each kind, subject to real endpoint support. Three videos or audio references cannot be promised for the current scalar endpoints. No endpoint receives a higher limit inferred from a sibling model. The documented first/last-frame operation also remains distinct from a provider's multimodal reference operation.

## Endpoint audit

This is the checkout's complete media-slot registry, including staged/inactive models, matched to catalog IDs in migrations. It is not a live production-catalog snapshot. Documents were read on 2026-10-25. Counts below are enabled limits; all are one per slot with the flag off. The raised image-edit limit also carries `verification`, `priceVerification` and `verifiedAt` in the registry.

| Catalog model | Provider endpoint / evidence | Slot limits when enabled | Finding |
| --- | --- | --- | --- |
| bria-bg-remove | [fal-ai/bria/background/remove](https://fal.ai/models/fal-ai/bria/background/remove/api) | image 1 | Scalar `image_url`. |
| topaz-upscale | [fal-ai/topaz/upscale/image](https://fal.ai/models/fal-ai/topaz/upscale/image/api) | image 1 | Scalar `image_url`; existing pixel cap retained. |
| bria-expand | [fal-ai/bria/expand](https://fal.ai/models/fal-ai/bria/expand/api) | image 1 | Scalar `image_url`. |
| latentsync | [fal-ai/latentsync](https://fal.ai/models/fal-ai/latentsync/api) | video 1, audio 1 | Scalar `video_url` and `audio_url`. |
| mmaudio-v2-video | [fal-ai/mmaudio-v2](https://fal.ai/models/fal-ai/mmaudio-v2/api) | video 1 | Scalar `video_url`. |
| topaz-upscale-video | [fal-ai/topaz/upscale/video](https://fal.ai/models/fal-ai/topaz/upscale/video/api) | video 1 | Scalar `video_url`; staged price verification remains separate. |
| kling-avatar-v2 | [fal-ai/kling-video/ai-avatar/v2/standard](https://fal.ai/models/fal-ai/kling-video/ai-avatar/v2/standard/api) | image 1, audio 1 | Scalar portrait and speech. |
| nano-banana-pro-edit | [fal-ai/nano-banana-pro/edit](https://fal.ai/models/fal-ai/nano-banana-pro/edit/api) | image 3 | `image_urls` supports up to 14; product cap 3. [Price](https://fal.ai/models/fal-ai/nano-banana-pro/edit) is per output image at the pinned resolution, not per reference. Existing 2K, one-output, no-web-search settings remain. |
| kling-3.0-i2v | [fal-ai/kling-video/v3/pro/image-to-video](https://fal.ai/models/fal-ai/kling-video/v3/pro/image-to-video/api) | image 1, endImage 1 | Separate scalar start/end frames. |
| zonos2-voice-clone | [fal-ai/zonos2](https://fal.ai/models/fal-ai/zonos2/api) | audio 1 | Scalar `reference_audio_url`. |
| demucs-stems | [fal-ai/demucs](https://fal.ai/models/fal-ai/demucs/api) | audio 1 | Scalar `audio_url`; stem feature flag unchanged. |
| kling-3.0-i2v-kie | [market:kling-3.0/video](https://docs.kie.ai/market/kling/kling-3-0) | image 1 | The endpoint’s second image is a last frame, not another reference. Keep the existing single start-image operation and planner capacity at one; no generic multi-reference increase. Existing pro, sound-off, single-shot settings retained. |
| seedance-2.0-fast-byteplus | [byteplus:seedance-2.0-fast](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api?redirect=1) | image 1 | Existing first-frame operation. Switching to reference-image roles/multimodal billing has not been verified. |
| seedance-2.0-mini-byteplus | [byteplus:seedance-2.0-mini](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api?redirect=1) | image 1 | Same first-frame operation; higher-count operation/pricing unverified. |
| seedance-2.0-byteplus | [byteplus:seedance-2.0](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api?redirect=1) | image 1 | Same first-frame operation; higher-count operation/pricing unverified. |
| seedance-2.5-byteplus | [byteplus:seedance-2.5](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api?redirect=1) | image 1 | Same first-frame operation; higher-count operation/pricing unverified. |
| seedance-1.0-pro-fast-byteplus | [byteplus:seedance-1.0-pro-fast](https://docs.byteplus.com/en/docs/modelark/create-video-generation-task-api?redirect=1) | image 1 | Same first-frame operation. |
| nano-banana-pro-edit-grsai | [grsai:nano-banana-pro-edit](https://grsai.ai/dashboard/documents/nano-banana) | image 1 | Existing `urls` list kept. Public documentation shell did not expose a verifiable count; no increase. |
| veo-3.1-lite-kie | [veo:veo3_lite](https://docs.kie.ai/veo3-api/generate-veo-3-video) | image 1 | Current one-image adapter operation retained; higher counts/tier-price parity not established. |
| veo-3.1-fast-kie | [veo:veo3_fast](https://docs.kie.ai/veo3-api/generate-veo-3-video) | image 1 | Same limitation. |
| veo-3.1-kie | [veo:veo3](https://docs.kie.ai/veo3-api/generate-veo-3-video) | image 1 | Same limitation. |
| seedance-2.0-fast | [bytedance/seedance-2.0-fast on OpenRouter](https://openrouter.ai/bytedance/seedance-2.0-fast) | image 1 | Existing first-frame adapter operation retained. Higher-count reference support and pricing not established. |
| face-retouch | [fal-ai/image-editing/retouch](https://fal.ai/models/fal-ai/image-editing/retouch/api) | image 1 | Scalar `image_url`. |
| face-enhance | [fal-ai/image-editing/face-enhancement](https://fal.ai/models/fal-ai/image-editing/face-enhancement/api) | image 1 | Scalar `image_url`. |
| face-relight | [fal-ai/iclight-v2](https://fal.ai/models/fal-ai/iclight-v2/api) | image 1 | Scalar `image_url`; existing staged pricing status unchanged. |
| face-makeup | [fal-ai/image-apps-v2/makeup-application](https://fal.ai/models/fal-ai/image-apps-v2/makeup-application/api) | image 1 | Scalar `image_url`. |
| face-age | [fal-ai/image-apps-v2/age-modify](https://fal.ai/models/fal-ai/image-apps-v2/age-modify/api) | image 1 | Scalar `image_url`. |

No paid provider probes were run. A confirmed staging credential and numerical spend ceiling were not supplied. The incomplete higher-count audits above are an explicit remaining work-order limitation; the proposed deviation is to preserve their existing one-file contract until staging evidence is available. No unverified cap was raised.

## Request and persisted schema

The new request is one ordered array:

```json
{"references":[
  {"slot":"image","origin":"upload","key":"uploads/OWNER/FILE.png"},
  {"slot":"image","origin":"asset","asset_id":"11111111-1111-4111-8111-111111111111"},
  {"slot":"image","origin":"upload","key":"uploads/OWNER/OTHER.png"}
]}
```

Slots are `image`, `endImage`, `video`, `audio`; `endImage` counts as image. At most nine descriptors, three per kind, and the model's effective per-slot count are accepted. Legacy `source_key`, `source_keys`, `source_assets` still work, converted in upload-then-asset order. Unified and legacy fields cannot be mixed. Each file passes ownership, sniffed MIME, real size, dimensions and duration checks. The aggregate file-size bound is 200 MiB, below the theoretical 420 MiB sum of individual limits; two full-size videos fit, three do not. An authoritative total from Content-Range (206) or Content-Length (200) is required; an unknown total fails with `source_size_unknown`, never the sniffed prefix length. JSON request bodies are bounded at 128 KiB. Existing inputs remain capped at 8 Ki UTF-16 units of JSON text, including ten Clip Editor clips, dialogue scripts, 300-character narration and 2000-character prompts. Even fully escaped input needs at most 48 KiB, leaving envelope/reference headroom; a maximal dialogue regression also exercises escaped Unicode and whitespace beyond 64 KiB. Signed provider URLs are never reference identities.

`jobs.inputs.references` stores these exact ordered descriptors with canonical user inputs. It needs no column. Provider arrays are assembled in descriptor order for each slot. The upload sweeper reads both this list and old scalar `source_keys` maps, validates and de-duplicates upload keys, and never deletes Library assets. Two bounded top-level queries select legacy `inputs->source_keys=not.is.null` and `inputs=cs.` followed by the URL-encoded JSON `{"references":[{"origin":"upload"}]}`. Rows and keys are deduplicated. If the references query fails, legacy cleanup continues and reports `referenceQueryFailed`; asset-only jobs cannot fill the reference page.

Migration `0396_multi_reference_identity.sql` replaces the private paid/free admission functions from 0274. Under the existing lock, identical model + canonical inputs replay; reordered, replaced or otherwise changed references return `IDEMPOTENCY_CONFLICT` / HTTP 409 `idempotency_conflict` before another debit/free allowance. Legacy scalar reference maps normalize to descriptors, then compare as a multiset only when the stored request used a map. Slots, origins, identities and duplicate counts must match; map iteration never invents a cross-origin order. New stored reference lists retain strict order comparison. `preset_id` is attribution, excluded from identity. Chat compares thread, options, a hash of canonical user text and source identities, excluding search costs/results and attachment execution metadata. For pre-deploy chat jobs only, a missing stored `request_hash` is a wildcard. Model, thread, options and reference identity still compare; hashes stored by new jobs must match, including when an incoming request omits the hash. Legacy jobs cannot verify text that was never hashed. New identical chat retries tolerate changed search cost. Unrelated ledger reasons keep their prior behavior.

The separate fal durable-dispatch path (0243) is outside this canonical reference conflict contract and keeps its existing strict model/input/payload replay comparison. The route precondition requires source-free text-to-image requests; unified references are converted into the same checked upload/asset lists as legacy requests before this branch. A route test with both origins and legacy forms proves references cannot reach `admit_fal_dispatch`. Its SQL guard and replay function are unchanged (MR-013 route-precondition option).

### Admission diff and retry audit (MR-R3-004)

All `packages/db/schema/supabase/*.sql` definitions were searched. The last definitions before 0396 are both in `0274_generation_hold_admission.sql` (earlier definitions are in 0240). The paid function adds exactly two seven-line identity guards: its existing-job replay and unique-violation replay. The free function adds one five-line guard at its existing-job replay. Removing these three additions leaves each complete declaration/body byte-identical to 0274. `tests/multiReferenceMigration.test.mjs` discovers the latest prior definitions and enforces this comparison. Locks, account holds, rate checks, spend order, allowance calls, ledger writes, balance updates and grants are unchanged. New private helpers implement only canonical identity and the legacy/chat compatibility comparisons.

The retry paths were checked separately. `admitFalDispatch` passes the same `jobInputs` and deterministic `shapePayload` on each retry; a test captures both RPC calls and proves exact equality. 0243's existing payload comparison handles its server-pinned image size; it returns existing jobs before calling paid/free admission. Reference-bearing requests remain excluded by the route test. Clip Editor stores `{edit: resolved.edit}`, containing stable owned object keys, cuts, aspect, audio offset, captions and output length, rather than expiring URLs. A repeated route request re-inspects the same immutable asset and sends an identical `p_inputs` with no second provider call. Real-DB tests cover identical/changed edits on paid/free paths. Chat execution-cost drift is excluded, while stored request hashes bind user inputs; pre-deploy missing hashes retain their documented wildcard. No reviewed legitimate retry changes the compared user identity; edits, new file identities or reference order changes are intentional conflicts.

Kie dispatch validates the stored reference count against `hardMaxFiles`, the verified catalog contract, independently of the live admission flag. Closing admission cannot invalidate an already accepted payload solely due to the flag. Kling-kie's hard maximum is one start image; two-element first/last frame arrays are rejected with the flag both on and off. No dedicated end-frame operation is introduced.

The function migration must be deployed before relying on replay conflicts. It has not been applied by this change.

## Clients, recovery and cache

Web Create, chat media, editor generation, Oddlings and feature studios render each slot's references with add/remove/reorder and a model limit notice. Consent resets on changes and applies to the complete submitted list. Planners choose the model fitting the most files and disclose unused files. Mobile has a separate upload controller/progress/cancel state per reference and preserves arrays in feature/device handoffs. Mobile selection remains one file per picker invocation; users add more rows up to the advertised limit.

Web recovery preserves ordered Library references and one `needsUpload` placeholder per local source; it does not persist local file contents. Failed Library reopenings remain visible as incomplete. Incomplete references in optional as well as required slots block submission and consent readiness; serialization preflights all placeholders before any upload. Create and chat map `source_reattach_required` to the existing localized reattach message. Existing scalar drafts load. Feature-to-Create handoffs preserve uploaded keys and Library IDs. Eleven locales have the new limit/reorder strings. The Vey product inventory is regenerated.

The public catalog cache key includes contract version and effective flag. Cached/fallback responses are normalized to current limits, including disabling after an enabled cache was populated. A disabled cache used during an enable-time outage stays conservatively at one until a fresh catalog read.

## Verification and release constraints

Focused tests exercise payload shape with the flag on/off, mixed-origin order, count/size/type/per-file limits, cache transitions, draft recovery, handoffs, web rendering, mobile controls, MCP and cleanup. The SQL integration test invokes the actual migration in an isolated schema inside a rolled-back transaction against `DATABASE_URL` and covers paid/free identical/reordered/replaced/model-changed retries and chat search-cost differences; it explicitly skips when `DATABASE_URL` is absent. `ledger-tests.yml` runs it with the CI PostgreSQL service after replaying migrations. No local PostgreSQL binaries are required.

The agreed `npm test` proof must run through the owner's shared build-slot wrapper. This sandbox denies its lock file, so full proof remains blocked. The independent reviewer must run that command and the database integration test in an environment permitting the lock, with `DATABASE_URL` pointing to a disposable test database. Neither the application nor migration was published, pushed or committed. The flag can only be enabled on the owner's word after review and proof.

Single-file SourcePickers and editor controls preserve the existing DOM and labels. Multi-file limits use pluralized messages and are shown only above one. New clients consistently serialize unified `references`, including single-reference requests; legacy source fields remain accepted. The audio-stems assertion tests this deliberate new-client contract while provider payloads remain unchanged.

Create and mobile map each multi-reference refusal code to actionable shared `app.create.error.*` copy in all eleven catalogs. Unknown byte size is described as a file problem rather than an image-format problem. Existing request-conflict copy is reused.
