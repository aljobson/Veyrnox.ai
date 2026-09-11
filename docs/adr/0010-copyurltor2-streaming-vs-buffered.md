# ADR-0010 — `copyUrlToR2` streaming vs buffered

- **Status**: Proposed (2026-09-11)
- **Date**: 2026-09-11
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0000 — Product strategy](0000-product-strategy.md), `docs/PHASE-1.md`

## Context

`packages/adapters/r2.js` exposes `copyUrlToR2(sourceUrl, key)` which is called by the fal adapter to move a generated artifact from fal's CDN into our own R2 bucket. The current implementation does:

```
fetch(sourceUrl) → response.arrayBuffer() → PutObject(Buffer)
```

For image outputs this is fine — most sit well under 10 MB. For long video outputs (fal supports video models with 10+ second clips at 1080p that can approach or exceed 100 MB), buffering the entire body via `arrayBuffer()` inside a workerd runtime is a memory hazard:

- Cloudflare Workers have a **per-request memory ceiling of ~128 MB** on Workers Standard. A 90 MB body plus copies during upload can push us close.
- A `Buffer` full of video is retained until PutObject resolves — that's the whole request lifetime.
- Any concurrency (two big videos in-flight in the same isolate) can OOM the isolate and take unrelated requests with it.

We don't have production telemetry yet on the size distribution of copied objects, but Phase-1's model catalog already includes video models. This is not a hypothetical.

A second wrinkle: R2 speaks the S3 API, and the AWS SigV4 signing scheme requires either a signed body hash (`x-amz-content-sha256: <hex>`) or the literal `UNSIGNED-PAYLOAD` marker. Signing a hash requires seeing the full body first — which defeats streaming. `UNSIGNED-PAYLOAD` is a documented, supported alternative but removes one integrity check that SigV4 would otherwise provide.

## Options considered

### A. Leave as-is, document a hard size cap

Keep the `arrayBuffer` implementation. Add a `Content-Length` check up front; reject or truncate anything larger than N MB (e.g. 50 MB — safely inside workerd limits with headroom).

- **Effort**: half a day (add check, choose N, wire error path).
- **Blast radius**: any video output above N MB fails cleanly at copy time. Ledger refund path (already in Phase-1) handles the user experience.
- **Reversibility**: trivial.
- **Cost**: we deliberately drop long video outputs. Depending on which models Phase-1 exposes at launch, this may effectively delist video from the catalog.

### B. Stream via `ReadableStream` PUT with SigV4 `UNSIGNED-PAYLOAD`

Pipe `response.body` (a `ReadableStream`) directly into an S3 PutObject signed with `x-amz-content-sha256: UNSIGNED-PAYLOAD`. Memory footprint drops to a small transfer buffer.

- **Effort**: 1–2 days (SigV4 signer needs the `UNSIGNED-PAYLOAD` path; existing signer may already handle it — worth checking). Adds one code path in the adapter.
- **Blast radius**: single object size limit is now R2's own (5 GB single-part). Concurrency-wise, isolate memory is bounded independent of object size.
- **Reversibility**: trivial (feature-flag the streaming path).
- **Cost**: `UNSIGNED-PAYLOAD` means SigV4 no longer covers the body against man-in-the-middle tampering *of the request itself*. Since we're the client and the server (R2), and TLS is between them, this is mostly a theoretical loss — but it's a real change to the security posture that should be documented.

### C. Chunked multipart

Same as (B) but explicitly split into 5–15 MB parts using S3 multipart upload (InitiateMultipartUpload / UploadPart / CompleteMultipartUpload). Each part can be signed with a real body hash because parts are small enough to buffer.

- **Effort**: 3–5 days (multipart is a stateful protocol — need to handle abort on failure to avoid orphan parts and R2 storage charges for them).
- **Blast radius**: same object-size ceiling as (B), plus the R2 multipart limit of 10,000 parts. Retries at the *part* level are natural.
- **Reversibility**: trivial (flag).
- **Cost**: highest complexity for a feature we may not need at Phase-1 volume. Multipart shines when object sizes are in the gigabytes; we're in tens-to-hundreds of MB.

## Trade-offs

| Driver / Option | A. Buffered + cap | B. Streamed UNSIGNED-PAYLOAD | C. Multipart |
|---|---|---|---|
| Effort | 0.5 d | 1–2 d | 3–5 d |
| Peak memory per copy | ≤ N MB (chosen cap) | small (transfer buffer) | small (per part) |
| Object size ceiling | N MB | 5 GB (R2 single-part) | 5 TB (R2 multipart) |
| SigV4 body integrity | Full | Not signed (UNSIGNED-PAYLOAD) | Signed per part |
| Failure resume | Full retry | Full retry | Per-part retry |
| Feature coverage today | Drops long video | Full | Overkill |
| Reversibility | Trivial | Trivial (flag) | Trivial (flag) |

## Bench work this ADR identifies (before deciding)

Rather than pick blind, three specific numbers would make this decision easy:

1. **Actual size distribution of fal outputs across the Phase-1 catalog.** A small script that calls each catalog model at default params and records `Content-Length` on the fal output URL. p50, p95, p99. This is a half-day spike.
2. **Workerd memory ceiling with two 100 MB copies in flight in the same isolate.** Can be tested with a fixture URL (or R2-to-R2). Confirms whether (A) with `N = 50` is actually safe or whether one big object per isolate already stresses the limit.
3. **SigV4 signer support for `UNSIGNED-PAYLOAD` in whatever library we're already using.** If already supported, (B) is a same-day change. If not, add ~1 day.

The recommendation below assumes (1) shows p99 above 50 MB (i.e. that some real Phase-1 outputs would be dropped by (A)). If (1) shows p99 well under 50 MB, (A) is defensible for the next 6–12 months.

## Recommendation

**Option B — stream with `UNSIGNED-PAYLOAD` — conditional on the size-distribution bench showing p99 > 50 MB.**

One-line reason: video is already in the catalog, and buffering variable-size media in a memory-constrained runtime is a shape that will bite us in production long before it bites us in staging.

If the bench says outputs are safely small, downgrade to (A) with a documented cap; revisit if the catalog grows.

Reject (C) unless volume grows large enough that resumable per-part retries matter. At Phase-1 volume it is complexity we cannot yet justify.

## Decision

_To be completed by Al._

## Consequences (if B is accepted)

- Document in `packages/adapters/r2.js` (via comment) that PutObject is signed with `UNSIGNED-PAYLOAD` and *why* — future readers will otherwise assume it's an oversight.
- Add integration test covering: 1 KB, 10 MB, and a large fixture (100 MB) through the streaming path.
- SigV4 body integrity was the only server-side protection against a corrupted body-in-transit; TLS still covers the wire. If R2's own object hash is available on the response, log it and compare to the source's `Content-Length` as a sanity check.
- No user-facing behavior change if the bench holds.

## Open questions

- Does the existing SigV4 signer we ship (or the AWS SDK we lazy-import) already support `UNSIGNED-PAYLOAD`, or do we need to hand-roll the header path? A 30-minute check.
- What's the workerd streaming behavior on a slow upstream? If fal serves the source URL slowly, do we hold the isolate open for minutes? A wall-clock timeout at the fetch layer is orthogonal but should be checked in the same change.
- Is there value in verifying the R2-side ETag matches an upstream checksum for content integrity? Depends on whether fal exposes a per-artifact hash.
