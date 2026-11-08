# ADR-0334 — Create Best Cut: uploads and no-speech settlement

Status: implemented behind disabled flags; database and device acceptance remain unverified.
Date: 2026-11-07.
Related: ADR-0330, ADR-0331, ADR-0332; frozen Plan C SHA256 `c482db9c073f7c486daef78284a053e03b2d494309a1ab4d61161186c91e25dc`.

## Admission and identity

`bestCut` is an absent-by-default key in `EDITOR_RUNTIME_FLAGS`; it adds no Worker binding. `speechCut` is also required. The separate `quote?capability=best-cut` advertises supported source kinds. Legacy quote semantics are unchanged. Rollback does not disable reads, receipt recovery, or replay of already admitted work.

The new preflight accepts 1–10 source descriptors and returns `{clips:[{cached,credits}]}` without a debit. Uploads must have an owner-prefixed canonical key, a create-only upload reservation, the existing integrity switch enabled, and the existing fail-closed admission gate available. QuickTime `.mov` joins the existing 100 MiB MP4 allowance and the reservation allowlist. The aggregate reservation allowance remains 200 MiB per account and 20 uploads.

A signed 16-byte GET range supplies object metadata plus the container signature (the existing R2 adapter has no HEAD helper). The complete object is streamed through SHA256 under a byte ceiling and deadline, with ETag `If-Match`; the bounded existing duration probe uses the same ETag. Client hashes, URLs and declared durations are not authoritative. Identity is `(user_id, sha256, size, schema_version)`, independent of temporary upload key. Upload analysis readers do not require live bytes. Job sources keep the existing asset-liveness checks.

Migration 0455 is additive and idempotent. It makes asset references nullable for upload rows, adds source metadata and a receipt capability, and extends existing RPCs. It adds no price row and no new ledger writer. Apply only through the approved migration workflow. Number availability was checked against local refs; live PR checking was unavailable during implementation and must be repeated before integration.

## Settlement and concurrency

`accepts_no_speech` belongs to each receipt. Both request types can join one provider job in either order. Zero-word results use the existing failure/refund RPC to settle as `completed_no_speech`; capable receipts return `completed, speech:false` with no analysis, while legacy and analysis-ID reads return failed/refunded. Job locking makes completion, refund, callback replay and timeout one-shot. Receipt reads report the amount attributable to that receipt; cache and in-flight join receipts report zero.

Each user has a quota row. Admission serializes on the existing user advisory and balance locks, locks the quota, and refuses when outstanding reservations plus today's settled silent results reach ten. Only fresh work reserves; replay, cache and joins do not. Successful speech and definitive failures release capacity; silence consumes it once. The UTC date resets settled usage, while reservations survive midnight. Account erasure deletes the quota and transcripts. Existing retention cleanup removes analyses after 30 days.

An approved zero amount requires `cacheOnly:true`. Under the admission lock, expired cache that would require a debit returns `price_changed`; it cannot silently charge. The phone shows a maximum before upload, exact catalogue-derived totals after preflight, and requires another tap after a price change.

## Phone and local editing

Camera-roll imports call `editorDeviceMedia.copy` using `l-<UUID>` identities and project/account ownership. They never call the import helper that starts project backup. A sheet-local map relates media ID, upload source, receipt key and analysis for retries. Scripts and free-text notes never enter a request. Notes select an explicit local preset; free text is not interpreted.

The deterministic planner validates transcripts, groups utterances, aligns script lines by LCS, ranks takes, removes conservative repeats and pauses, and compiles a frame-aligned plan. Script ordering may move source time backwards; output time is monotonic and source intervals remain non-overlapping. Cases that cannot fit ten sections without dropping/reordering lines fail closed. A bounded alignment work budget also fails closed on pathological transcripts. Output is capped at 60 seconds, with explicit review before applying a tail trim.

The compiler uses the editor's closed commands (`remove`, `insertMedia`, `trim`, `move`, `addText`) to produce one timeline, and records one Undo entry. A new empty project establishes the imported raw timeline as its Undo baseline. An existing project keeps its actual pre-apply timeline. Before/After uses an independent read-only preview with no document writes. Ordinary successful runs apply automatically; tail-trimmed results require review.

Captions preserve provider-timed words, including Arabic text and CJK grapheme groups, without inventing intra-word timings. Fully cut or partially cut words are omitted. One word per layer is preferred, grouping two or three if needed to fit the existing 150-text-item limit. Extremely dense text that still cannot fit is omitted with a notice. Unknown-language clips get silence editing only and no automatic captions. Native Arabic shaping remains a device acceptance requirement.

## Privacy and deferred work

The full selected file is uploaded, including any retained EXIF/location metadata; no stripping is claimed. Consent says: “Temporary transcription uploads are scheduled for deletion after 24 hours; cleanup may take longer.” Transcripts are kept up to 30 days. Account deletion removes transcripts; there is no new delete-transcripts action. Library originals and project backups follow their existing lifecycles. No-speech refund means zero net charge, not that bytes remain on the device.

`EXPO_PUBLIC_BEST_CUT_ENABLED` remains unset. `EXPO_PUBLIC_BEST_CUT_DEVICE_SPEECH_ENABLED` is a seam only, with a default `SpeechGate.check(uri)` returning `unknown`. There is no new native module, iOS speech permission, EAS build or production configuration change. A real native gate needs model-availability handling, platform disclosure and a new store build.

B-roll is design-only: local keyword/script matching against media metadata can precede optional on-device Vision labels (new native build). A server alternative would upload opt-in thumbnails and require separate consent and pricing. Estimate: 2–3 sessions for matching/labels; a server vision request class might cost $0.002–0.01 per 10–20 sampled frames, to be quoted and verified separately. Notes-to-LLM, larger editor limits and transcript deletion UI remain follow-ups.

## Inspection residuals and owner-visible deviations (2026-11-08)

- **Legacy speech wrapper.** `speech_analysis_request` now wraps `speech_analysis_request_v2`, so Library-clip analyses from the existing speech sheet also take a no-speech gate reservation (shared 10/day cap, `SPEECH_GATE_COOLDOWN`) and a silent clip re-requested within 30 days replays its refunded result instead of a fresh attempt. Legacy responses keep their old shape (failed + refunded). Accepted; acceptance tests cover legacy and Best Cut joining the same source in both orders.
- **Replay guard.** A new receipt records `source_ref`; replay compares `source_ref` and capability. For job sources the older asset-id + sha256 digest comparison is no longer repeated on replay. Narrow risk (bytes of a Library asset changing under one job id and one key).
- **Upload cost.** `preflight` and `start` each stream and hash an uploaded clip (<= 100 MiB). Preflight is metered one clip per call under the read quota. A short-lived verified-identity cache between the two calls is a follow-up if Worker CPU or egress shows up in production.
- **QuickTime.** `video/quicktime` is allowlisted for uploads only so camera-roll `.mov` clips can be sent for transcription. The generation resolver refuses it (`source_type_unsupported`), the connector (MCP) upload list omits it, and a QuickTime-brand file declared as `video/mp4` still passes the magic-number check as before.
- **Reservation release.** Gate reservations are released by `speech_analysis_fail` / `speech_analysis_complete`; stuck analyses are failed by `sweep_speech_analyses` (pg_cron every 5 minutes, 15-minute timeout, migration 0451).
- **Not built here:** free reuse of a cached camera-roll analysis without re-uploading (needs a non-debiting upload path; a clip already analysed still needs one upload while the balance is above zero), script lines spoken across two utterances (matched per utterance only), erasing copied camera-roll files when a clip is removed, reusing an empty "Best cut" project, and the on-device speech gate (seam only).
