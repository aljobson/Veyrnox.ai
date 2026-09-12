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
