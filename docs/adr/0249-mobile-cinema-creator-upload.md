# ADR-0249: Mobile Cinema creator upload, resumable

Status: Implemented behind an unset-by-default build flag; staging device spike S3 remains blocked.

The frozen work order SHA-256 is `fc7d1a94f06b0e01ed8805e2825cc8b73531918ef01259405ba73b367fa7f7de`. Revisions 2–5 override the earlier requirements. All source paths are relative to this checkout. No server, dependency, EAS, deployment or upload-switch changes are included.

## Decision

`EXPO_PUBLIC_CINEMA_DEVICE_UPLOAD_ENABLED === 'true'` enables Your titles and all three creator routes. Closed routes make no request. Existing creator application, profile and analytics behavior remains unchanged. Top-level FILM, SHORT and TRAILER drafts support editing, video upload and submission for review; SERIES management stays on the web.

The transfer runner uses authenticated `api.stream` binary PATCH requests, exactly 5,242,880 bytes except the last part. Every continuation checks the account epoch. The server's transfer offset is authoritative. Pause and backgrounding finish the current part; no request is aborted midway. Relaunch requires a fresh full SHA-256 digest and an explicit Resume tap. A reclaimed local file must be re-picked with matching size and digest. One runner lease per account prevents competing title uploads.

Each title has a distinct storage slot under `veyrnox.cache.v1.cinema-upload.<user>.<content>`, with `{savedAt, record}`. The record contains only content/upload identifiers, size, fingerprint, random staged basename, last displayed offset, start idempotency key, and user-pause preference. Writes serialize with account cleanup and reject stale tickets, including a storage write completing after sign-out. A token refresh for the same owner preserves the epoch.

Files live only under the app cache's `veyrnox-cinema-upload/<user>/<content>/` directory. Orphaned files, interrupted `.partial-*` copies and records older than 24 hours are swept on account adoption and creator-list entry. Preparing folders are protected until their record is written. Sign-out removes all users' Cinema folders; account adoption removes other users' folders. `cleanupFor` is the single staged-upload cleanup table: transient failures retain the copy; conflicting videos require confirmation; terminal states, confirmed cancellation/removal and confirmed final bytes delete it.

Files is the only picker. `copyToCacheDirectory:false` avoids writes to the shared picker cache. Before copying, require known size plus 100 MiB free space. Android uses one native `File.copy()` into a Cinema-owned partial file, with the native stream fallback for pipe-backed providers; size and epoch are checked when it returns. iOS uses 5 MiB read/write blocks with epoch checks after each await. Both rename the completed copy, hash it and persist its record before starting the reservation.

The iOS system import copy is deleted only when its URI is within this app container's temporary Inbox. Provider originals and other features' caches are never deleted. A kill during iOS copying can leave the system import copy until iOS purges its temporary directory. Photos is deliberately excluded by Revision 4. There is no background-upload claim.

Drafts and submissions have the exact server key sets. The rights, safety and malware declarations remain verbatim English with accessibility language metadata. Submission confirms the title and possible future public publication. No publishing, paid actions, Credits, analytics or public-content changes happen here. Content policy, terms, reporting and blocked-people links are on the detail screen.

## Verification and limits

The agreed proof is `cd apps/mobile && npx tsc --noEmit && npx jest --ci && node scripts/gen-en-registry.mjs --check`. Four dedicated test files cover transfer failures and chunk sizes, resume and pause, cleanup, account fences, platform copy behavior, route gates, request bodies and source-text drift. Native behavior still requires the specified physical-device spike.

S3 is blocked until the owner enables staging proxy uploads (O5). No staging configuration was changed. The iPhone/Android 1 GB force-quit, network-switch, checksum, duration and sign-out tests were not performed by this source implementation. The device build flag remains off unless explicitly provided by the build environment.

The known server constraints are unchanged: uncertain PATCH claims can remain stuck (O1); 5 MiB must be received within 10 seconds (O2); reservations expire after one hour (O3); no route proves end-to-end Stream byte equality (O4). Background transfer requires native implementation (O6), and the written App Store 1.2 / Play AI-content submission plan remains required (O7). These are reported limitations, not silently redesigned requirements.
