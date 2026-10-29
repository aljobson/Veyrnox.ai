# Pinned FAL payload validation

Migration 0243 added a byte-length check after image-size pinning and before paid debit or free allowance admission. Migration 0406 expands that durable inputs, payload and outbox boundary to 262,144 bytes so a fully escaped 30,000-character prompt and its pinned companion fields fit. An oversized final payload returns `INVALID_INPUTS` before financial effects; the admission helper maps this to 400 `invalid_inputs` and publishes no queue message.

The 0406 forward migration updates `admit_fal_dispatch`, `provider_spend_admit_model` and `fal_dispatch_payload_check` while preserving replay, policy, capacity, private-helper and grant contracts. It is replay-safe: running it again leaves functions and constraints at 262,144 bytes. Valid payloads with exactly 262,144 stored JSONB bytes still admit and replay once.

The disposable-PostgreSQL suite applies 0406 twice, checks capacity policy preservation and execution grants, admits 30,000 escaped control characters through both durable admission paths, accepts exact-boundary JSONB, and rejects the next byte without debit, free claim or supplier-spend reservation. CI runs it after the existing reserved-only suite.

These local tests use a disposable localhost database and roll back fixtures. The older rollback-only probe intentionally expects the pre-0243 outbox constraint error and is historical evidence; do not use it as the post-0243 acceptance assertion.

## Current staging probe

`scripts/check-fal-pinned-payload-staging.sql` requires the 0406 guard, a dedicated inactive fixture model, an idle dispatch/reservation baseline and disabled capacity. It checks paid/free ASCII and UTF-8 payloads that fit the incoming byte cap but exceed the 262,144-byte stored cap after image-size pinning. It also admits exactly 262,144 stored bytes and replays the same job with one paid debit or free claim. Successful admissions are undone by a dedicated subtransaction rollback marker; the whole request ends with `ROLLBACK`. No outbox work becomes visible to the consumer and no provider calls are made.

`scripts/check-fal-admission-rollback-staging.sql` is the smaller refusal-only probe. It now expects the current pre-debit `INVALID_INPUTS` result rather than the historical outbox constraint failure.

## Historical staging acceptance, 10 October 2026

PR #787 squash-merged as `d830d222f5e58ab8238891eb6429cae1984d4d5c`. Its unchanged migration `0243_fal_pinned_payload_validation` was applied once to staging project `yrqzwqywxfesmbvhzjgj` after merge. Readback confirmed the final-size guard and preserved EXECUTE grants: service_role allowed; anon/authenticated denied. The capacity policy and admission control matched their pre-migration values.

The 0243-era operator probe checked the then-current 16,384-byte boundary. That run is historical evidence only; the checked-in scripts now target 0406 and 262,144 bytes.

The probe passed first on disposable local PostgreSQL (substituting only its fixture user ID), then unchanged on staging. Persisted readback at `2026-10-10T06:42:17.277559Z` confirmed capacity disabled, admission unpaused, fixture model inactive with its controlled endpoint restored, fixture balance/free balance/subscription balance `6/6/0`, zero active reservations, zero READY/STARTED/UNKNOWN dispatches and zero probe jobs. The staging migration ledger had exactly one entry for 0243. Policy limits remained two outstanding jobs, ten daily admissions and 300,000 micro-USD daily budget, with no provider account configured.

Production apply run [38031604263](https://github.com/aljobson/Veyrnox.ai/actions/runs/38031604263) was waiting for owner approval after merge. This staging exercise did not approve it or apply any production migration. Production changes remain behind the protected `apply-migrations` workflow (ADR-0023).

The owner subsequently approved **0243 only**, and run 38031604263 applied only that migration and passed its ledger check. Production readback at `2026-10-10T06:56:10.776810Z` found exactly one 0243 entry, the same function definition hash as validated staging (`d9ed6cd956e1fbe2b59f8b9744beb23d`), and preserved execution grants. Capacity remained disabled with its original policy, admission remained unpaused, and active reservations/pending dispatches were both zero. This schema installation did not activate production dispatch.

Post-probe monitor [38031856861](https://github.com/aljobson/Veyrnox.ai/actions/runs/38031856861) passed its actual queue/database health check. Dispatch and dead-letter queue backlog were both zero; oldest-message age was unavailable. The retained database artifact at `2026-10-10T06:42:31.263Z` reported all thirteen recovery counts and all five reconciliation drift counts zero, with no unhealthy tasks or issues. This is a clean point-in-time result; continuous monitoring and the remaining provider failure/recovery gates still apply before production activation.

Reticle verification was skipped for this operator SQL probe because it has no browser UI surface. Deployed database behavior was verified directly on staging; the admission-helper HTTP mapping was verified locally against PostgreSQL.
