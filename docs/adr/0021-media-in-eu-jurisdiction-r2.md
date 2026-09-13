# ADR-0021 — Generated media moves to the EU-jurisdiction R2 bucket

- **Status**: Accepted (2026-09-13). Code merged in #116. **Cutover blocked** on the decisions below.
- **Date**: 2026-09-13
- **Deciders**: Product owner
- **Related**: [ADR-0005 §3](0005-phase-0-business-preconditions.md) (EU-only user data), [ADR-0008](0008-asset-retention-policy-and-sweep.md) (retention sweep), [ADR-0016](0016-data-residency-claim-correction.md) (residency claims and the bucket correction)

## Context

ADR-0005 §3 requires user data, including generated media, to stay in the EU. The database moved to `eu-central-1` in #85. Media did not.

Verified on 2026-09-13 (ADR-0016 update and correction):

- `packages/adapters/r2.js` signs against `https://<account>.r2.cloudflarestorage.com`, so production cannot be writing to a jurisdiction-restricted bucket.
- Production's Worker has `R2_BUCKET` = **`veyrnox-staging-media`**: default jurisdiction, location hint `WEUR`, 8 objects (43.4 MB), matching production's 8 live asset rows. A location hint is best-effort placement; only a jurisdictional restriction guarantees objects are stored and processed in the EU.
- An empty **`veyrnox-media` in the EU jurisdiction** exists (created 2026-07-03, `EEUR`).
- A separate `veyrnox-media` in the default jurisdiction (112 objects, 109 MB) is not production's live bucket.
- Cloudflare: a jurisdiction bucket is reachable only through `https://<account>.<jurisdiction>.r2.cloudflarestorage.com`, and a bucket-scoped R2 API token names the jurisdiction (`<account>_eu_<bucket>` vs `<account>_default_<bucket>`).
- The browser only uses presigned URLs in `<img>`, `<video>` and links, which the CSP already allows from any `https:` host.

An earlier version of this ADR assumed production used `veyrnox-media` and planned a cutover that only set `R2_JURISDICTION=eu`. With `R2_BUCKET` = `veyrnox-staging-media`, that would have pointed the Worker at an EU `veyrnox-staging-media` that does not exist, failing every upload and presigned download. The attempt stopped before changing anything.

## Decision

- `r2.js` takes an optional `R2_JURISDICTION` (`eu` only). It selects the jurisdiction endpoint for put, delete and presigned GET. Any other value reads as not configured, so uploads refuse up front instead of guessing a host. (Merged in #116; unset in production, so behaviour is unchanged.)
- `R2_BUCKET` and `R2_JURISDICTION` are both Worker secrets set with `wrangler secret put`, so the cutover can be done independently of a deploy.
- A cutover changes **both** `R2_BUCKET` and `R2_JURISDICTION` together. Setting either alone points the Worker at a bucket that does not hold production's media.

## Decisions needed before cutover

1. **Target bucket.** Recommended: the existing empty EU-jurisdiction `veyrnox-media`, so production and staging stop sharing a name. The alternative is a new EU bucket.
2. **Staging's bucket.** Check whether the staging Worker also uses `veyrnox-staging-media`. If it does, staging and production media are mixed today, and the copy in step 2 must select production's keys only (it does, by reading production's `assets` table).
3. **Credentials.** Confirm the Worker's R2 API token (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) covers the target: an all-buckets token, or a bucket-scoped token that includes the target bucket in the `eu` jurisdiction. If not, create one and `wrangler secret put` both values first.

## Cutover runbook

Using the recommended target, EU `veyrnox-media`:

1. **Credentials** confirmed per decision 3.
2. **Copy live media.** For every production `assets.r2_key` whose `expires_at` is in the future, copy from the current bucket to the target under the same key, and check the downloaded size equals `assets.size_bytes`:
   `wrangler r2 object get veyrnox-staging-media/<key> --file <tmp> --remote`
   `wrangler r2 object put veyrnox-media/<key> --file <tmp> --content-type <mime_type> --jurisdiction eu --remote`
   Keys are unchanged, so no database row changes.
3. **Flip both secrets, back to back.** `wrangler secret put R2_BUCKET` = `veyrnox-media`, then `wrangler secret put R2_JURISDICTION` = `eu`. Each `secret put` deploys a new version, so between the two the Worker briefly targets the wrong bucket; do them in immediate succession, or upload one version with both.
4. **Catch up.** Repeat step 2 for assets created between step 2 and step 3.
5. **Verify.** Generate one asset and download it; open one pre-cutover asset from the library. Both must load from `<account>.eu.r2.cloudflarestorage.com/veyrnox-media/...`.
6. **Copy.** Update the Privacy Policy and GDPR page to say generated media is stored in the EU (Cloudflare R2 EU jurisdiction), and record ADR-0005 §3 as met for media.
7. **Old copies.** `veyrnox-staging-media` keeps production's pre-cutover copies. Deleting them is a separate, owner-approved step, and must not remove staging's own objects if decision 2 finds the bucket shared.

Rollback before step 7: set `R2_BUCKET` back to `veyrnox-staging-media` and `wrangler secret delete R2_JURISDICTION`. Assets created after step 3 exist only in the EU bucket and would need copying back.

## Consequences

- ADR-0005 §3 is met for media once step 6 lands; until then ADR-0016's Western Europe wording stands.
- The retention sweep (ADR-0008) deletes from whichever bucket the Worker targets. Pre-cutover copies left in `veyrnox-staging-media` are outside its reach; step 7 covers them.
- The default-jurisdiction `veyrnox-media` (112 objects) is unrelated to this cutover and was not examined.
