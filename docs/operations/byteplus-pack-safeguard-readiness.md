# BytePlus pack safeguard readiness — 2026-09-28

Status: specification and source investigation only. No quota collector,
production enforcement, migration or 24-hour health verification is complete.
BytePlus must remain inactive until these are implemented and verified.

## Verified local facts

ADR-0058 requires a warning below 48 hours of trailing usage and deactivation
on pack exhaustion. There is no pack-balance task in worker.js or recovery
assessment today. Migration 0145 currently contains the latest
refresh_recovery_health definition; recheck main before modifying it.

Four staged rows use pack costs: Seedance 2.0 Fast, Mini, 2.0 and 2.5.
Seedance 1.0 Pro Fast uses PAYG in scripts/verify-byteplus-endpoints.mjs and
must not be disabled merely because a 2.x resource pack is missing.
The adapter reads completion_tokens, but the common completion path does not
persist those tokens as a provider-usage ledger. Customer credit debits are
not a substitute for provider token usage.

## Quota source investigation

The official [Usage & Diagnostics reference](https://docs.byteplus.com/en/docs/ModelArk/usage-and-diagnostics)
documents arkcli usage balance --type free-quota, optionally filtered by
model, and mentions ListModelChargeItems. It describes both free inference
quota and resource-package balances. This is a candidate source, not proof
that it identifies paid Seedance pack balances, expiries and applicability.
The same reference distinguishes delayed usage statistics from next-day
settlement. No live response or credential scope has been verified here.

The local project credential directory has KIE and staging R2 files, but no
BytePlus credential file. arkcli is not installed on this machine. The
existing Chrome BytePlus tab could not be inspected because browser control
timed out. No credential, pack purchase, console setting or account access
was created or changed.

## Data required before implementation

Capture a redacted authenticated response or documented API schema proving:

- Correct account, region, model and charge-item mapping for each paid pack.
- Token units, remaining quantity, start/expiry times and purchased-pack identity.
- Pagination/completeness, timestamp of the balance and its maximum reporting lag.
- Whether free/promotional quota and paid packs are distinguishable, and how
  overlapping packs are consumed without counting the same pool twice.
- Account-wide consumption, including calls outside Veyrnox, or a dedicated
  allocation whose entire consumption Veyrnox can reserve and reconcile.

Neither account cash nor a free-trial quota should pass this check. An empty,
partial, stale or malformed response must not be interpreted as healthy.

## Proposed enforcement, pending source validation

1. Read quota with least-privilege billing credentials and fixed provider hosts.
   Validate and persist a timestamped per-pool snapshot through a service-only
   RPC; reject older snapshots arriving out of order.
2. Evaluate only packs usable by the selected model and billing item. Exclude
   expired or not-yet-active packs. Forecast consumption against each expiry;
   do not count a pack expiring shortly as 48 hours of coverage.
3. Warn when valid coverage is below 48 hours of measured trailing usage.
   Define the lookback window and cold-start reserve using verified billed
   token observations. Zero traffic cannot prove adequate capacity.
4. Block submissions before customer debit when evidence is absent/stale or
   insufficient for the requested job. Reserve worst-case token consumption
   atomically across concurrent submissions, including outstanding jobs and
   reporting lag. The bound must come from the actual model billing contract.
   A daily check alone cannot guarantee the pack rate between observations.
5. Deactivate only affected pack-priced rows on confirmed exhaustion, with
   audited, idempotent state transitions. Never auto-reactivate on purchase;
   restore availability through a reviewed activation migration.
6. Register byteplus_pack_balance in the task CHECK, Worker observation and
   recovery assessor. Carry the latest full recovery snapshot body forward,
   preserving Cinema and all other existing health checks.

If the vendor cannot provide a bounded-lag quota source and a reliable job
reservation bound, do not claim guaranteed pack-rate enforcement. Keep rows
inactive or revise the pricing/activation decision through an ADR.

## Required acceptance cases

Test exact 48-hour boundary, expired and overlapping packs, separate model
pools, stale/partial data, zero traffic, out-of-order reads, concurrent jobs,
external usage, exhaustion and idempotent deactivation. Prove other providers
and the PAYG BytePlus row are unchanged, and existing jobs can still complete
and refund. Run against isolated Postgres, then observe the authenticated
collector and recovery health green for 24 hours before activation.
