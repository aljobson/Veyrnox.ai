# ADR-0016 — Data-residency claim corrected; EU-only precondition still open

- **Status**: Accepted (2026-09-12)
- **Date**: 2026-09-12
- **Deciders**: Product owner (sole)
- **Related**: [ADR-0005 §3 — Phase-0 business preconditions](0005-phase-0-business-preconditions.md), [ADR-0006 — EU residency changes auth-provider math](0006-auth-and-db-amendment-eu-residency.md)

## Context

ADR-0005 §3 set **EU-only for user data** as a Phase-0 precondition: Postgres in
Frankfurt, media in an R2 bucket with `location_hint = "weur"`. ADR-0006 then
chose Supabase over Clerk specifically because Supabase offers an EU region at
standard pricing.

The deployment did not follow. The Supabase project wired into production
(`yrqzwqywxfesmbvhzjgj`, named `veyrnox-staging`, baked into `wrangler.jsonc`
and the CSP) is in **us-east-2**. `docs/supabase-staging.md` has said so since
2026-09-10, including the line "must migrate to Frankfurt before Slice 9 exit
(real user signups)". Signups are live.

Meanwhile the Privacy Policy said "Account data and generation metadata are
stored in the European Union. Generated media is stored in EU object storage."
and the GDPR page said "Core data is stored in the European Union." Both were
false for the database at the time of writing, and neither could be verified
for R2 from this repo.

A false residency statement in a privacy policy is worse than a missing one. It
is a representation to data subjects and to any regulator who reads it.

## Options considered

### A. Correct the copy to describe the deployment as it is

Say the database is hosted in the United States, name the transfer safeguards,
and commit to updating the page before any move.

- Effort: under an hour.
- Risk: the pages now contradict ADR-0005 §3, which remains the stated product
  commitment. Anyone comparing the two sees the gap — which is the point.

### B. Migrate to the EU project first, then leave the copy alone

Move the database to `eu-central-1`, repoint config, verify R2 jurisdiction.

- Effort: a day at least. Data migration, secret rotation, CSP and config
  changes, a re-run of the money-spine tests, and downtime or a dual-write
  window.
- Risk: the false statement stays live for the duration.

### C. Correct the copy now, migrate separately

Ship A today; keep the EU migration as its own tracked piece of work.

## Decision

**Option C.** The claim is corrected in this change. The EU-only precondition
from ADR-0005 §3 is **not** withdrawn — it stays open, and the correction is
explicitly temporary: the Privacy Policy now says we will update the page before
a region move takes effect.

What the pages now say:

- The database, holding account data, the credit ledger and generation metadata,
  is currently hosted in the United States.
- Generated media is stored in Cloudflare R2. No region is claimed, because the
  bucket's jurisdiction cannot be verified from this repo.
- Transfers outside the UK or EEA rely on the UK IDTA or the EU SCCs.

## Consequences

- The legal pages are accurate for the first time since they were written.
- The gap between ADR-0005 §3 and the deployment is now visible in the docs
  rather than hidden behind marketing copy.
- Two things still need a decision, in this order:
  1. **Migrate to `eu-central-1`** and restore the EU statement, or formally
     amend ADR-0005 §3 to drop the EU-only precondition. Leaving it open means
     the product is running against a stated precondition it does not meet.
  2. **Verify the R2 bucket's jurisdiction.** ADR-0005 §3 specified `weur`. If
     it was created that way, media is already EU-resident and the copy can say
     so. Nobody has checked.
- This ADR is not legal advice. The wording is factual rather than drafted by a
  solicitor, and a review is worth having before any funding or enterprise
  diligence.

## Correction (2026-09-12, later the same day)

An earlier version of this ADR said a project named `Veyrnox PRODUCTION (live)`
existed in `eu-central-1` "not wired to anything", and treated it as a ready
migration target. That was inferred from the project list alone. Its contents
show it is the **wallet product's** live database — referrals, a waitlist,
device-keyed events and bonus-claim throttles, with thousands of rows and no
Veyrnox.ai tables. Migrating into it would have merged two separate businesses'
data. It must not be used for Veyrnox.ai.

A dedicated project was created instead: `veyrnox-ai-production-eu`
(`xdxdzmsztyzbnzeforxx`, `eu-central-1`). Every migration in
`packages/db/schema/supabase` has been replayed into it and verified at parity
with `us-east-2` — functions, grants, RLS, policies, triggers, cron jobs, and a
byte-identical model catalog. The wallet-product objects that also sit in the
`us-east-2` database (`events`, `funnel_dropoff_alert_log`, `track_event`,
`check_funnel_dropoff_alerts` and an hourly cron) were deliberately not carried
over. The runtime cutover has not happened yet.

## Update (2026-09-13): database cutover done, copy restored

Production cut over to `veyrnox-ai-production-eu` (`xdxdzmsztyzbnzeforxx`,
`eu-central-1`) in #85. The live site's CSP `connect-src` names only that
project, and `wrangler.jsonc` points the Worker at it.

The Privacy Policy and GDPR page now say the database is hosted in the European
Union (Frankfurt, Germany). They still claim no region for Cloudflare R2: the
bucket's jurisdiction remains unverified (Consequence 2 above). ADR-0005 §3 is
met for the database only.

The `us-east-2` project (`yrqzwqywxfesmbvhzjgj`) is now staging. Whether it
still holds any real user's data from before the cutover has not been checked
here; if it does, that data should be deleted or the pages should mention it.

## Update (2026-09-13): R2 location verified

Checked with `wrangler r2 bucket list` / `wrangler r2 bucket info` and the S3
endpoint in `packages/adapters/r2.js`:

- Production media is written to a **default-jurisdiction** bucket with
  location `WEUR`. `r2.js` signs against
  `https://<account>.r2.cloudflarestorage.com`, which cannot reach a
  jurisdiction-restricted bucket, and production recorded new assets through it
  the same day. (This bullet first named `veyrnox-media` as that bucket; it is
  `veyrnox-staging-media`. See the correction below.)
- `WEUR` is a location hint: Cloudflare places the bucket in Western Europe on
  a best-effort basis and reports the placement, but only a jurisdictional
  restriction guarantees objects are stored and processed in the EU.
- A second `veyrnox-media` exists in the **EU jurisdiction** (created
  2026-07-03, location `EEUR`) with 0 objects. Nothing uses it.
- `veyrnox-media` in the default jurisdiction (created 2026-09-05, `WEUR`,
  111 objects / 109 MB) and `veyrnox-staging-media` (default jurisdiction,
  `WEUR`, no EU twin) both exist.

The Privacy Policy and GDPR page now say generated media is stored in
Cloudflare R2 in Western Europe, and claim no EU restriction. ADR-0005 §3
(EU-only user data) is therefore met for the database but **not** for media.
Moving media into the EU-jurisdiction bucket is tracked in its own ADR.

## Correction (2026-09-13, later the same day): production's media bucket

The update above said production writes to `veyrnox-media`. That was inferred
from the S3 endpoint alone; the Worker's `R2_BUCKET` value was never checked
(it is a secret, so only its name is visible).

Evidence from the ADR-0021 cutover attempt, which stopped before changing
anything:

- None of production's 8 live `assets.r2_key` values exists in the
  default-jurisdiction `veyrnox-media` ("The specified key does not exist" for
  all 8).
- One of those keys was found in `veyrnox-staging-media` at the size recorded in
  `assets.size_bytes`. That bucket holds exactly 8 objects (43.4 MB), matching
  production's 8 asset rows (about 46 MB, 43.4 MiB).

So production's Worker has `R2_BUCKET` = `veyrnox-staging-media`, inferred from
the matching objects. The default-jurisdiction `veyrnox-media` is not
production's live media bucket; what its 112 objects are was not checked.

The legal pages are unaffected: `veyrnox-staging-media` is also
default-jurisdiction with location `WEUR`, so "stored in Cloudflare R2 in
Western Europe" remains accurate, and ADR-0005 §3 is still unmet for media.

Open: a production Worker writing to a bucket named for staging suggests the
staging Worker may use the same bucket, mixing staging and production media.
That has not been checked.


## Update (2026-09-13): no customer data left in the us-east-2 project

Checked `yrqzwqywxfesmbvhzjgj` (now staging) using counts and one-way email
hashes only; no addresses, prompts or media were read.

- 4 accounts, all internal or test: 1 on `@test.veyrnox.ai` (an acceptance-test
  leftover with no login) and 3 on company domains (veyrnox.ai, veyrnox.com,
  21stclick.co.uk). None on any other domain, none anonymous, no Apple or
  Google sign-ins. Last job 2026-09-11.
- None of the 4 exists in production (hashes compared), so no one was carried
  over in the cutover.
- Personal data about those accounts: 13 job prompts, 4 fal webhook payloads,
  1 asset row, and 4 login sessions with IP address and user agent. Supabase
  Storage and the wallet-product tables (`events`, `funnel_dropoff_alert_log`)
  are empty.

No real user's data from before the cutover remains, so the Privacy Policy and
GDPR page need no mention of the `us-east-2` project.

The 4 sessions were still valid logins on staging (last active 2026-09-12). All
4 were ended and their refresh tokens revoked; the accounts themselves were
left in place.

## Update (2026-09-13): media moved to the EU

Production cut over to the EU-jurisdiction bucket `veyrnox-ai-media` at
10:44:53 UTC (ADR-0021). The Privacy Policy and GDPR page now say generated
media is stored in the European Union, in Cloudflare R2 with an EU
jurisdictional restriction. ADR-0005 §3 is met for both the database and
media.

Production's pre-cutover copies remain in `veyrnox-staging-media`
(default jurisdiction, `WEUR`) until their owner-approved deletion
(ADR-0021 step 7).

