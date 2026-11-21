# ADR-0373: Measured video shape for Smart Cut

Status: Accepted for implementation; migration not applied.

## Decision

The stored file's MP4 headers are the source of truth for video shape. Requested model ratios are suggestions, not measurements. Smart Cut compares two-decimal width/height values using the existing server tolerance of 3%, always against the first selected clip. Labels are descriptive and never establish compatibility. Unknown shapes do not block; the server remains authoritative at submit.

Migration 0577 adds nullable width/height and an unreadable timestamp to assets. Measurements are write-once, including readable files with invalid headers. Transient read failures remain retryable on a later visit. Only a job owning exactly one asset in total has a canonical measured shape. Multi-asset jobs expose `shape_ambiguous` and both clients ignore even live playback metadata for compatibility decisions.

Measurements happen lazily for visible Library videos and completed Create results, in requests of at most 12 IDs with four concurrent reads and a four-second response budget. The service-role RPCs verify ownership, stored state, deletion, expiry, moderation hold and canonical ownership again at write time. There is no bulk backfill, cron, environment variable, settlement change, ledger or balance write. `job_stored` and provider completion paths remain untouched. An unapplied migration returns an empty successful measurement response; client attempts are deduplicated and failures stop the measurement queue.

Create compares the selected model option with the account's newest measured finished video. It offers a compatible option only when the model supports one. Nothing automatically changes the chosen ratio or blocks generation. Finished results can disclose a difference from the specifically requested ratio. No auto-cropping, padding or reshaping is introduced.

## Verification

Shared vectors cover near-equal portrait sizes, incompatible portrait ratios, unknown and ambiguous anchors, order changes, and identical labels with incompatible dimensions. API tests cover bounded reads, timeout, missing migration, strict input validation and the existing asset-link limiter. SQL replay and device/browser acceptance remain host validation steps. Number 0373 is free in this checkout and the locally available origin/main; live GitHub verification was unavailable in the builder sandbox.
