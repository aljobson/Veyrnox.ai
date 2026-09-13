# ADR-0021 — Generated media moves to the EU-jurisdiction R2 bucket

- **Status**: Accepted (2026-09-13) — code in this change; cutover per the runbook below
- **Date**: 2026-09-13
- **Deciders**: Product owner
- **Related**: [ADR-0005 §3](0005-phase-0-business-preconditions.md) (EU-only user data), [ADR-0008](0008-asset-retention-policy-and-sweep.md) (retention sweep), [ADR-0016](0016-data-residency-claim-correction.md) (residency claims)

## Context

ADR-0005 §3 requires user data, including generated media, to stay in the EU. The database moved to `eu-central-1` in #85. Media did not.

Verified on 2026-09-13 (ADR-0016 update):

- `packages/adapters/r2.js` signs against `https://<account>.r2.cloudflarestorage.com`, so production writes to `veyrnox-media` in the **default jurisdiction** (location hint `WEUR`). A location hint is best-effort placement; only a jurisdictional restriction guarantees objects are stored and processed in the EU.
- An empty `veyrnox-media` bucket already exists in the **EU jurisdiction** (created 2026-07-03).
- Cloudflare: a jurisdiction bucket is reachable only through `https://<account>.<jurisdiction>.r2.cloudflarestorage.com`, and a bucket-scoped R2 API token names the jurisdiction (`<account>_eu_<bucket>` vs `<account>_default_<bucket>`).
- Production had 6 live assets; the browser only uses presigned URLs in `<img>`, `<video>` and links, which the CSP already allows from any `https:` host.

## Decision

- `r2.js` takes an optional `R2_JURISDICTION` (`eu` only). It selects the jurisdiction endpoint for put, delete and presigned GET. Any other value reads as not configured, so uploads refuse up front instead of guessing a host.
- The bucket name stays `veyrnox-media`; the cutover changes only `R2_JURISDICTION`.
- `R2_JURISDICTION` is set with `wrangler secret put`, not in `wrangler.jsonc` `vars`. It is not secret, but a secret survives every Workers Builds deploy and can be flipped at cutover time independently of a merge; merging this change alone changes nothing.

## Cutover runbook

1. **Credentials.** Confirm the Worker's R2 API token (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) covers the EU bucket: either an all-buckets token, or a bucket-scoped token that includes `veyrnox-media` in the `eu` jurisdiction. If not, create one that does and `wrangler secret put` both values first.
2. **Copy live media.** For every `assets.r2_key` in production whose `expires_at` is in the future, copy the object from the default bucket to the EU bucket under the same key:
   `wrangler r2 object get veyrnox-media/<key> --file <tmp> --remote`
   `wrangler r2 object put veyrnox-media/<key> --file <tmp> --content-type <mime_type> --jurisdiction eu --remote`
   Keys are unchanged, so no database row changes.
3. **Flip.** `wrangler secret put R2_JURISDICTION` with value `eu`. New uploads and every presigned URL now use the EU bucket.
4. **Catch up.** Repeat step 2 for assets created between step 2 and step 3.
5. **Verify.** Generate one asset and download it; open one pre-cutover asset from the library. Both must load from `<account>.eu.r2.cloudflarestorage.com`.
6. **Copy.** Update the Privacy Policy and GDPR page to say generated media is stored in the EU (Cloudflare R2 EU jurisdiction), and record ADR-0005 §3 as met for media.
7. **Old bucket.** The default-jurisdiction `veyrnox-media` keeps its copies (111 objects at verification, many from before the database cutover or from staging). Deleting it is a separate, owner-approved step once the EU bucket has served for a full retention cycle check.

Rollback before step 7: `wrangler secret delete R2_JURISDICTION` returns every request to the default bucket, which still holds the pre-cutover copies. Assets created after step 3 exist only in the EU bucket and would need copying back.

## Consequences

- ADR-0005 §3 is met for media once step 6 lands; until then ADR-0016's Western Europe wording stands.
- The retention sweep (ADR-0008) deletes from whichever bucket `R2_JURISDICTION` selects. Objects left in the old bucket are outside its reach; step 7 covers them.
- Staging (`veyrnox-staging-media`) has no EU twin and keeps running without `R2_JURISDICTION`.
