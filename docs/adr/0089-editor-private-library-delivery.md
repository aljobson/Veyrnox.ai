# ADR-0089: private editor renders and explicit Publish handoff

## Decision

An editor export may be saved as a private Library video without a generated source take. The existing Film Studio master pipeline remains restricted to its authorized generated take, dimensions, rate and duration.

Migration 0285 creates owner-scoped `editor_library_renders`. Reservation and removal run with the caller's JWT through explicit invoker wrappers and private operations. RLS is forced, browser roles can read their own rows and cannot write tables or assert inspection outcomes. Storage keys are derived from owner and random render UUIDs. A stable request key and immutable SHA-256, label and byte size make retries safe.

The Worker inspects the exact immutable object before marking it stored: bounded MP4 structure and packets, H.264 video, optional AAC audio, actual hash and declared byte size, up to 25 MiB, ten minutes, 4096 pixels per edge and the editor's supported frame rates. This is format inspection; it is not a malware or content-moderation verdict. The UI requires an explicit rights confirmation before any upload. No new price, generation, ledger mutation or publication is involved.

Quarantine expires after 24 hours; stored videos expire after 90 days. Remove or Auth deletion immediately revokes new Library/API reads. Previously issued signed GET links remain valid for at most 15 minutes or until the object is reaped; downloaded bytes remain on devices. Reaping waits until the original signed PUT is no longer valid, so a late request cannot recreate an already-deleted object. The existing `asset_reap_queue` deletes due objects. Per-owner reservations have a 100-item/200-MiB cap; upload-request throttling applies through the existing limiter.

`EDITOR_LIBRARY_EXPORTS_ENABLED` stays false in production until 0285 is approved, applied and has a complete clean 24-hour reconciliation window. This personal Library path does not require the project-saving feature flag; origin, identity and RLS checks remain mandatory.

An explicit Prepare in Publish action uses the existing Social Upload reservation, write-once transfer and format-inspection pipeline. Its URL carries only an opaque upload ID. The composer resolves it from the current actor's verified uploads, then requires the user to choose connected destinations, caption, visibility and Post now or Schedule post. It does not create a post during handoff. Existing upload and network rollout gates still apply. Unsupported video destinations are stated honestly rather than inferred from platform logos.

## Verification

Focused API tests cover disabled gates, caller-token forwarding, bounded immutable uploads, hash/packet inspection, owned reads, safe error projection and no publication calls. Disposable local Postgres checks cover RLS/ACLs, idempotency and conflicts, quota/rate limits, account deletion, delayed removal and expiry. Signed-in staging verification found and corrected a blob-fetch CSP failure by retaining the export's Blob directly. It then demonstrated private reservation/upload/inspection, Library readback and loaded playback, followed by an owned inspected upload selected in Publish without posting. Hosted test-fixture removal awaits owner confirmation; the new expiry cron has a successful run. Application receipts and precise evidence are in [the staging qualification record](../editor/COMPLETION-STAGING-2026-10-11.md). Production activation remains gated.
