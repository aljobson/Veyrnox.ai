# ADR-0021 — Generated media moves to the EU-jurisdiction R2 bucket

- **Status**: Accepted (2026-09-13). Code merged in #116. **Cut over 2026-09-13 10:44:53 UTC; old copies deleted.** Runbook complete.
- **Date**: 2026-09-13
- **Deciders**: Product owner
- **Related**: [ADR-0005 §3](0005-phase-0-business-preconditions.md) (EU-only user data), [ADR-0008](0008-asset-retention-policy-and-sweep.md) (retention sweep), [ADR-0016](0016-data-residency-claim-correction.md) (residency claims and the bucket correction)

## Context

ADR-0005 §3 requires user data, including generated media, to stay in the EU. The database moved to `eu-central-1` in #85. Media did not.

Verified on 2026-09-13 (ADR-0016 update and correction):

- `packages/adapters/r2.js` signs against `https://<account>.r2.cloudflarestorage.com`, so production cannot be writing to a jurisdiction-restricted bucket.
- Production's Worker has `R2_BUCKET` = **`veyrnox-staging-media`**: default jurisdiction, location hint `WEUR`, 8 objects (43.4 MB), matching production's 8 live asset rows. A location hint is best-effort placement; only a jurisdictional restriction guarantees objects are stored and processed in the EU.
- An empty **`veyrnox-media` in the EU jurisdiction** exists (created 2026-07-03, `EEUR`).
- A separate `veyrnox-media` in the default jurisdiction (112 objects, 109 MB) is not production's live bucket. It belongs to the `veyrnox-gbp-gemini` Worker (a Google Business Profile / marketing tool), bound as `MEDIA_BUCKET` with a public `r2.dev` URL.
- Cloudflare: a jurisdiction bucket is reachable only through `https://<account>.<jurisdiction>.r2.cloudflarestorage.com`, and a bucket-scoped R2 API token names the jurisdiction (`<account>_eu_<bucket>` vs `<account>_default_<bucket>`).
- The browser only uses presigned URLs in `<img>`, `<video>` and links, which the CSP already allows from any `https:` host.

An earlier version of this ADR assumed production used `veyrnox-media` and planned a cutover that only set `R2_JURISDICTION=eu`. With `R2_BUCKET` = `veyrnox-staging-media`, that would have pointed the Worker at an EU `veyrnox-staging-media` that does not exist, failing every upload and presigned download. The attempt stopped before changing anything.

## Decision

- `r2.js` takes an optional `R2_JURISDICTION` (`eu` only). It selects the jurisdiction endpoint for put, delete and presigned GET. Any other value reads as not configured, so uploads refuse up front instead of guessing a host. (Merged in #116; unset in production, so behaviour is unchanged.)
- `R2_BUCKET` and `R2_JURISDICTION` are both Worker secrets set with `wrangler secret put`, so the cutover can be done independently of a deploy.
- A cutover changes **both** `R2_BUCKET` and `R2_JURISDICTION` together. Setting either alone points the Worker at a bucket that does not hold production's media.

## Decisions needed before cutover

1. **Target bucket — decided 2026-09-13: a new EU bucket, `veyrnox-ai-media`.** Chosen over the existing empty EU `veyrnox-media` because a default-jurisdiction `veyrnox-media` already serves `veyrnox-gbp-gemini`; two same-named buckets for two products invites the mistake ADR-0016 records. Created 2026-09-13 with `wrangler r2 bucket create veyrnox-ai-media --jurisdiction eu` (location `EEUR`). The empty EU `veyrnox-media` is unused.
2. **Staging's bucket — answered 2026-09-13: not shared.** Checked through the Cloudflare API across every Worker in the account (secret names and bindings only, no secret values):
   - Only `veyrnox-ai` has R2 credentials (`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`). `wrangler.jsonc` defines no staging environment, and no other Worker has R2 credentials or a binding to `veyrnox-staging-media` (`veyrnox-staging-staging` has no configuration; the rest belong to other products).
   - The staging database's one asset (created 2026-09-11, before the #85 database cutover) is in `veyrnox-staging-media` at its recorded size: `veyrnox-ai` wrote it while it still used the us-east-2 database.

   So `veyrnox-staging-media` holds production's live assets plus that one pre-cutover object, not a live staging environment's media. Copying by production's `assets` table selects exactly production's objects. Cloudflare Pages projects and other Cloudflare accounts were not checked.
3. **Credentials.** Confirm the Worker's R2 API token (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) covers the target: an all-buckets token, or a bucket-scoped token that includes the target bucket in the `eu` jurisdiction. If not, create one and `wrangler secret put` both values first.

## Cutover runbook

Target: EU `veyrnox-ai-media`.

1. **Credentials** confirmed per decision 3.
2. **Copy live media — done 2026-09-13.** For every production `assets.r2_key` whose `expires_at` is in the future, copy from the current bucket to the target under the same key, check the source size equals `assets.size_bytes`, then read the copy back from the EU bucket and compare it byte for byte:
   `wrangler r2 object get veyrnox-staging-media/<key> --file <tmp> --remote`
   `wrangler r2 object put veyrnox-ai-media/<key> --file <tmp> --content-type <mime_type> --jurisdiction eu --remote`
   `wrangler r2 object get veyrnox-ai-media/<key> --file <check> --jurisdiction eu --remote`
   All 8 live assets were copied and verified. Keys are unchanged, so no database row changes. Production still reads and writes `veyrnox-staging-media` until step 3.
3. **Flip both secrets, back to back.** `wrangler secret put R2_BUCKET` = `veyrnox-ai-media`, then `wrangler secret put R2_JURISDICTION` = `eu`. Each `secret put` deploys a new version, so between the two the Worker briefly targets the wrong bucket; do them in immediate succession, or upload one version with both.
   **Done 10:44:53 UTC** with `wrangler secret bulk` (both secrets in one version, `02a9ab98`), after confirming the previous deployment was built after #116 merged. The owner confirmed the R2 token covers all buckets.
4. **Catch up.** Repeat step 2 for assets created after the step 2 copy (2026-09-13, 8 assets) and before step 3.
   **Done:** no assets or jobs were created between the step 2 copy and step 3.
5. **Verify.** Generate one asset and download it; open one pre-cutover asset from the library. Both must load from `<account>.eu.r2.cloudflarestorage.com/veyrnox-ai-media/...`.
   **Done:** the owner reported both checks working. The first production generation after the cutover (a fal video submitted 11:22:39 UTC) reached `STORED`; its asset is in `veyrnox-ai-media` (EU) at its recorded `size_bytes` and not in the default-jurisdiction `veyrnox-media`, and presigned asset requests (`GET /api/v1/jobs/:id/asset`) returned OK in the Worker logs. No R2 errors were logged after the cutover.
6. **Copy.** Update the Privacy Policy and GDPR page to say generated media is stored in the EU (Cloudflare R2 EU jurisdiction), and record ADR-0005 §3 as met for media.
   **Done** in this change. ADR-0005 §3 (EU-only user data) is now met for media as well as the database.
7. **Old copies.** `veyrnox-staging-media` keeps production's pre-cutover copies and the one pre-#85 object. Deleting them is a separate, owner-approved step.
   **Done 2026-09-13 ~11:06 UTC.** The owner deleted all 9 objects (the 8 production assets and the pre-#85 object) with `wrangler r2 object delete`. Checked afterwards: a direct `get` of each of the 9 keys in `veyrnox-staging-media` returns "The specified key does not exist", and all 8 production assets are present in `veyrnox-ai-media` (EU) at their recorded size. The empty bucket was then deleted (`wrangler r2 bucket delete veyrnox-staging-media`), after checking no Worker binding or Pages project referenced it. No production jobs had run since the cutover, so nothing was lost.

Rollback before step 7: set `R2_BUCKET` back to `veyrnox-staging-media` and `wrangler secret delete R2_JURISDICTION`. Assets created after step 3 exist only in the EU bucket and would need copying back. Step 7 is done and `veyrnox-staging-media` no longer exists, so a rollback now needs that bucket recreated and every asset copied back from `veyrnox-ai-media` first.

## Consequences

- ADR-0005 §3 is met for media once step 6 lands; until then ADR-0016's Western Europe wording stands.
- The retention sweep (ADR-0008) deletes from whichever bucket the Worker targets. Pre-cutover copies left in `veyrnox-staging-media` are outside its reach; step 7 covers them.
- The default-jurisdiction `veyrnox-media` (112 objects) belongs to `veyrnox-gbp-gemini` and is untouched by this cutover; its contents were not examined.
