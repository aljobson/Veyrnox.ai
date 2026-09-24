# ADR-0044 — Reserved, bounded, immutable source uploads

Date: 2026-09-24
Status: Proposed; migration 0129 and activation pending

## Decision

With UPLOAD_INTEGRITY_ENABLED=true, each presigned upload first reserves one
of ten account slots and its exact declared bytes, with a 200 MiB aggregate
ceiling. The user's row lock serializes concurrent reservations. Existing
unreserved R2 objects count toward both limits. Reservation failures issue no
URL. Storage metadata has forced RLS and service-only operations; money is
unchanged. Failed signing conservatively retains the slot until cleanup.

SigV4 binds Content-Length, Content-Type and If-None-Match: *. The browser's
File body supplies Content-Length; the returned headers supply the conditional
write. R2 rejects a different length or replacement of an existing object.
Content sniffing and duration/dimension validation still happen before provider
submission. These controls bound storage and prevent content replacement;
they do not assert that a declared media type is truthful.

Cleanup releases reservations only after successful R2 deletion. Unused URLs
are deleted and released after 24 hours too. Failed cleanup retains budget.
Consumed files are not selected until their job is at least 16 minutes old:
the source was signed before job creation, so the 15-minute write URL has
expired before deletion can make the key writable again. Release itself also
refuses reservations whose write-expiry safety window remains open.

## Rollout requirements

The implementation is dormant until the server flag is enabled. Required order:

1. Merge, then apply owner-approved migration 0129 through apply-migrations.
2. Verify the production bucket CORS permits Content-Type and If-None-Match
   from the exact site origin, with PUT allowed. Preserve existing GET/HEAD
   rules and preview policy. The browser controls Content-Length; do not try
   to set that forbidden request header in JavaScript.
3. On an isolated staging bucket, use a browser File upload to verify success,
   reject a different byte count/signature, and verify a second PUT to the same
   key returns 412. Verify the declared MIME/sniffing rejection still works.
4. Enable the flag in a separate reviewed configuration change and confirm the
   sweeper succeeds. Existing open tabs may need reload to send the new header.
5. Wait at least 15 minutes for old, weaker URLs to expire before claiming the
   content-replacement finding closed. Preserve reservations during rollback;
   never delete metadata while stored bytes may remain.

Do not enable only the flag without CORS verification and the database change.
Local signature tests independently recompute SigV4; they are not a substitute
for the real R2/browser compatibility check. The current request quota remains
independent and active.

Cloudflare documents conditional PutObject support:
https://developers.cloudflare.com/r2/api/s3/api/
