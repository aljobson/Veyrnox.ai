# Staging admission rollback acceptance — 10 October 2026

Executed `scripts/check-fal-admission-rollback-staging.sql` against staging project `yrqzwqywxfesmbvhzjgj`. This is an operator SQL probe with no DDL, no commit and no provider or queue publication. It uses the existing dedicated fixture user/model from the controlled dispatch exercise. The fixture balance is locked before policy locks; transaction-local model and policy changes are invisible to other sessions and end in ROLLBACK. It is distinct from a persistent operator policy activation.

## Real failure boundary

The supplied JSONB payload has a 16,350-character ASCII prompt. Its unpinned JSONB representation fits the RPC's 16,384-byte input cap. Adding the required image size pushes it over the outbox CHECK cap. The current admission function reaches the real outbox insert after creating the job and paid debit or free claim; the database raises `23514` on `fal_dispatch_payload_check`.

Both paid and free cases caught that exact constraint failure inside a subtransaction. After each, the probe asserted unchanged total/Free/Subscription balances, job count, ledger count, allowance-claim count, outbox count and reservation count. Both passed. The complete outer transaction rolled back the temporary model/capacity settings. Independent readback confirmed capacity disabled, null provider account, original model `flux-2-pro`, admission pause false, inactive fixture model, fixture balance six and zero probe jobs. No schema migration, deployment flag, provider spend or customer credit changed.

The two earlier synthetic/no-submit refunded intents were first closed using exact-row preconditions, as recorded in [the dispatch exercise](staging-fal-fault-exercise.md#terminal-fixture-closure--10-october-2026). Their retained evidence had been counting as two unresolved unreserved jobs. Closing them did not refund or alter ledger entries and does not establish terminality for real ambiguous provider work.

[Post-exercise staging health run 38029741997](https://github.com/aljobson/Veyrnox.ai/actions/runs/38029741997) passed at `2026-10-10T06:05:52.678Z`: both queues empty, all thirteen recovery counts zero, no unhealthy tasks/issues and all five reconciliation drift counts zero.

## Result and limits

The admission rollback gate has direct staging evidence for paid debit and free-claim rollback when the outbox insert fails. Reservation-insert failure remains covered by the existing local injected-trigger acceptance suite, not this deployed probe. No concurrent admission load or network acknowledgement loss was exercised here.

A validation improvement remains: the RPC checks payload bytes before adding image size, so this boundary raises a database exception. `admitFalDispatch` maps RPC exceptions to uncertain-admission 503; it does not distinguish this proven rollback from transport uncertainty. A forward migration could validate the pinned payload before financial effects. The probe does not establish whether the public route's model-specific input limits allow this exact long prompt. This finding is separate from the proven rollback behavior; no SQL function was changed by this PR.

Provider-signed redelivery, provider transport uncertainty, sustained capacity measurements and the full clean monitoring window remain independent rollout requirements. Production activation is still pending their reviewed evidence.
