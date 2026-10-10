# ADR-0020 amendment 1: GrsAI output delivery recovery

Date: 2026-10-10. Status: accepted for the owner-requested production fix.

## Evidence

The live empty-room Film Studio test delivered four of eight reference images.
Four GrsAI edits remained SUCCEEDED with no asset, while their completion events
were marked processed. The UI continued showing them as running.

A further owned-reference diagnostic, job
`3e5eaada-4a32-471d-8a3d-40c22691262e`, was polled at 19:05 UTC and likewise
became SUCCEEDED without an asset. The production Worker log tail recorded
`R2 copy source host not allowed: file8.aitohumanize.com`. The existing GrsAI
allowlist contains only the previously observed file1, file5 and file6 hosts.

## Decision

Add only the observed exact host `file8.aitohumanize.com`. Retain HTTPS-only
downloads, refusal of redirects and unknown siblings/lookalikes, byte limits,
media sniffing and hashing, and no provider credentials on CDN requests.

A rejected GrsAI copy must remain unprocessed and return `asset_store_failed`
so the bounded cron can retry delivery. This never submits another paid image.

For the previously processed events, permit completion recovery only when the
authenticated provider read succeeds and both the caller's snapshot and a fresh
database read still say SUCCEEDED. Scope that read to the job ID, GrsAI provider
and provider task ID. Stored, failed/refunded, cancelled or missing jobs remain
duplicates with no copy or financial side effects.

No database migration or ledger mutation is introduced. Existing idempotent
job storage and the stuck-job failure/refund backstop remain authoritative.
The repair does not automatically approve Film Studio reference boards.

## Validation

Regression coverage proves delivery from the exact added host, no CDN auth,
redirect/lookalike refusal, recovery of stranded processed events, and refusal
to copy from a stale SUCCEEDED snapshot after a stored or failed transition.
Production acceptance requires actual stored image files and a full Film Studio
journey with reviewed outputs; a provider-success status alone is insufficient.
